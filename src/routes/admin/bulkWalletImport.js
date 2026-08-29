/**
 * Admin Bulk Wallet Import Routes (Issue #1538)
 *
 * Endpoints:
 *   POST /admin/wallets/bulk-import         - Upload CSV/JSON and start asynchronous import job
 *   GET  /admin/wallets/bulk-import/:jobId  - Poll progress and results for an import job
 */

'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireAdmin } = require('../../middleware/rbac');
const { bulkImportRateLimiter } = require('../../middleware/rateLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const BulkWalletImportService = require('../../services/BulkWalletImportService');

const bulkWalletImportService = new BulkWalletImportService();

function getBulkMaxBytes() {
  const parsed = parseInt(process.env.BULK_IMPORT_MAX_SIZE_BYTES || '1048576', 10);
  return isNaN(parsed) ? 1048576 : parsed;
}

function getBulkMaxRows() {
  const parsed = parseInt(process.env.BULK_IMPORT_MAX_ROWS || '1000', 10);
  return isNaN(parsed) ? 1000 : parsed;
}

/**
 * POST /admin/wallets/bulk-import
 * Asynchronously imports wallets from a CSV/JSON file.
 */
router.post(
  '/',
  requireAdmin(),
  bulkImportRateLimiter,
  (req, res, next) => {
    const maxBytes = getBulkMaxBytes();
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes },
    });
    upload.single('file')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = (maxBytes / (1024 * 1024)).toFixed(2);
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds the maximum allowed size of ${maxMB} MB (${maxBytes} bytes).`,
            details: { max_size_bytes: maxBytes },
          },
        });
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FILE', message: 'A file upload is required (field: "file")' },
      });
    }

    let rows;
    try {
      const mimeType = req.file.mimetype || (req.file.originalname?.endsWith('.json') ? 'application/json' : 'text/csv');
      rows = bulkWalletImportService.parseFile(req.file.buffer, mimeType);
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        error: { code: 'PARSE_ERROR', message: `File parse error: ${parseErr.message}` },
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'EMPTY_FILE', message: 'Uploaded file contains no data records' },
      });
    }

    const maxRows = getBulkMaxRows();
    if (rows.length > maxRows) {
      return res.status(422).json({
        success: false,
        error: {
          code: 'ROW_LIMIT_EXCEEDED',
          message: `File contains ${rows.length} rows which exceeds the maximum of ${maxRows}.`,
          details: { submitted: rows.length, limit: maxRows },
        },
      });
    }

    const batchSize = req.body?.batchSize || process.env.BULK_IMPORT_BATCH_SIZE;
    const actorId = req.apiKey?.id || req.user?.id || 'admin';

    const job = bulkWalletImportService.createJob({
      rows,
      batchSize,
      apiKeyId: actorId,
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId: job.jobId,
        status: job.status,
        total: job.total,
        message: 'Bulk wallet import job queued. Poll /admin/wallets/bulk-import/:jobId to check progress.',
      },
    });
  })
);

/**
 * GET /admin/wallets/bulk-import/:jobId
 * Retrieve the status and progress of an import job.
 */
router.get(
  '/:jobId',
  requireAdmin(),
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const job = bulkWalletImportService.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: { code: 'JOB_NOT_FOUND', message: `Import job '${jobId}' not found` },
      });
    }

    return res.status(200).json({
      success: true,
      data: job,
    });
  })
);

module.exports = router;
