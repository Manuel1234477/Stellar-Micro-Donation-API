const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { validateSchema } = require('../middleware/schemaValidation');
const { requireTier, checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const ExportService = require('../services/ExportService');
const DonationExportService = require('../services/DonationExportService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { ValidationError, NotFoundError } = require('../utils/errors');
const { escapeField: csvEscape } = require('../utils/csvSerializer');
const fs = require('fs');

const createExportSchema = validateSchema({
  body: {
    fields: {
      type: { type: 'string', required: true, enum: ['donations', 'wallets', 'audit_logs'] },
      format: { type: 'string', required: true, enum: ['csv', 'json'] },
      startDate: { type: 'dateString', required: false, nullable: true },
      endDate: { type: 'dateString', required: false, nullable: true },
    },
    validate: (body) => {
      if (body.startDate && body.endDate && new Date(body.startDate) > new Date(body.endDate)) {
        return 'startDate must not be after endDate';
      }
      return null;
    },
  },
});

const exportIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true },
    },
  },
});

/**
 * GET /exports/donations
 * Synchronous donation export generating CSV or JSON.
 */
router.get('/donations', requireApiKey, asyncHandler(async (req, res) => {
  const { format = 'csv', startDate, endDate, status, senderPublicKey, recipientPublicKey } = req.query;

  if (!['csv', 'json'].includes(format)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_FORMAT', message: 'format must be csv or json' } });
  }

  const db = require('../utils/database');
  const BATCH_SIZE = 1000;
  const CSV_HEADERS = ['id', 'amount', 'senderPublicKey', 'recipientPublicKey', 'memo', 'status', 'timestamp', 'transactionHash'];

  let query = `
    SELECT t.id, t.amount,
           sender.publicKey AS senderPublicKey,
           receiver.publicKey AS recipientPublicKey,
           t.memo, t.status, t.timestamp, t.stellar_tx_id AS transactionHash
    FROM transactions t
    LEFT JOIN users sender ON t.senderId = sender.id
    LEFT JOIN users receiver ON t.receiverId = receiver.id
    WHERE 1=1
  `;
  const params = [];
  if (startDate)          { query += ' AND t.timestamp >= ?'; params.push(startDate); }
  if (endDate)            { query += ' AND t.timestamp <= ?'; params.push(endDate); }
  if (status)             { query += ' AND t.status = ?'; params.push(status); }
  if (senderPublicKey)    { query += ' AND sender.publicKey = ?'; params.push(senderPublicKey); }
  if (recipientPublicKey) { query += ' AND receiver.publicKey = ?'; params.push(recipientPublicKey); }
  query += ' ORDER BY t.timestamp DESC';

  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="donations-${ts}.csv"`);
    res.write(CSV_HEADERS.join(',') + '\n');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.write('[');
  }

  let offset = 0;
  let firstRow = true;

  for (;;) {
    const rows = await db.all(query + ` LIMIT ${BATCH_SIZE} OFFSET ${offset}`, params);
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      if (format === 'csv') {
        res.write(CSV_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n');
      } else {
        res.write((firstRow ? '' : ',') + JSON.stringify(row));
        firstRow = false;
      }
    }
    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (format === 'json') res.write(']');
  res.end();
}));

/**
 * POST /exports/donations
 * Schedule asynchronous donation export with background worker.
 * Returns HTTP 202 with export job ID immediately.
 */
router.post('/donations', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.bulk), asyncHandler(async (req, res, next) => {
  try {
    const { format = 'csv', startDate, endDate, status, senderPublicKey, recipientPublicKey, email } = req.body;
    const apiKeyId = req.apiKey ? req.apiKey.id : (req.user ? req.user.id : 'anonymous');

    const result = await DonationExportService.queueExportJob(apiKeyId, {
      format,
      startDate,
      endDate,
      status,
      senderPublicKey,
      recipientPublicKey,
      email: email || (req.user && req.user.email),
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId: result.jobId,
        status: result.status,
      },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /exports/:jobId/status
 * Poll export job status (queued/processing/ready/failed) and download URL.
 */
router.get('/:jobId/status', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const jobStatus = await DonationExportService.getJobStatus(req.params.jobId);
    const normalizedStatus = jobStatus.status === 'completed' ? 'ready' : jobStatus.status;

    return res.json({
      success: true,
      data: {
        jobId: jobStatus.jobId,
        status: normalizedStatus,
        progress: jobStatus.progress,
        downloadUrl: jobStatus.downloadUrl,
        urlExpiresAt: jobStatus.urlExpiresAt,
        error: jobStatus.error,
        createdAt: jobStatus.createdAt,
        updatedAt: jobStatus.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error.status === 404) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Export job not found' },
      });
    }
    next(error);
  }
}));

/**
 * POST /exports
 * Initiate asynchronous export generation.
 * Requires 'pro' tier or higher.
 */
router.post('/', requireApiKey, requireTier('pro'), createExportSchema, payloadSizeLimiter(ENDPOINT_LIMITS.bulk), asyncHandler(async (req, res, next) => {
  try {
    const { type, format, startDate, endDate } = req.body;
    const exportId = await ExportService.initiateExport({
      type,
      format,
      dateRange: { startDate, endDate },
      requestedBy: req.user ? req.user.id : null,
    });

    res.status(202).json({
      success: true,
      data: { exportId, jobId: exportId, status: 'pending' },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/export
 * Queue an asynchronous donation export job and return 202 with a job id.
 * Requires 'pro' tier or higher.
 */
router.post('/donations/export', requireApiKey, requireTier('pro'), createExportSchema, payloadSizeLimiter(ENDPOINT_LIMITS.bulk), asyncHandler(async (req, res, next) => {
  try {
    const { format, startDate, endDate } = req.body;
    const jobId = await ExportService.initiateExport({
      type: 'donations',
      format,
      dateRange: { startDate, endDate },
      requestedBy: req.user ? req.user.id : null,
    });

    res.status(202).json({
      success: true,
      data: { jobId, exportId: jobId, status: 'pending' },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /exports/:id
 * Retrieve export status.
 */
router.get('/:id', requireApiKey, exportIdSchema, asyncHandler(async (req, res, next) => {
  try {
    // If it's a donation export job ID (e.g. export-...)
    if (req.params.id.startsWith('export-')) {
      const jobStatus = await DonationExportService.getJobStatus(req.params.id);
      return res.json({ success: true, data: jobStatus });
    }

    const result = await ExportService.getExportStatus(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: error.errorCode || 'NOT_FOUND', message: error.message },
      });
    }
    return next(error);
  }
}));

/**
 * GET /exports/:id/download
 * Return a signed download URL or stream file for completed exports.
 */
router.get('/:id/download', requireApiKey, exportIdSchema, asyncHandler(async (req, res, next) => {
  try {
    if (req.params.id.startsWith('export-')) {
      const { token, expires } = req.query;
      if (!token || !expires) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_PARAMS', message: 'token and expires parameters are required' },
        });
      }

      const { filePath, format } = await DonationExportService.verifyAndGetDownload(
        req.params.id,
        token,
        expires
      );

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: { code: 'FILE_NOT_FOUND', message: 'Export file not found' },
        });
      }

      const contentType = format === 'csv' ? 'text/csv' : 'application/json';
      const fileName = `donations-${req.params.id}.${format}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      return fs.createReadStream(filePath).pipe(res);
    }

    const url = await ExportService.getSignedDownloadUrl(req.params.id);
    res.json({ success: true, data: { downloadUrl: url } });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return res.status(404).json({
        success: false,
        error: { code: error.errorCode || 'NOT_FOUND', message: error.message },
      });
    }
    if (error instanceof ValidationError) {
      return res.status(400).json({
        success: false,
        error: { code: error.errorCode || 'INVALID_REQUEST', message: error.message },
      });
    }
    return next(error);
  }
}));

module.exports = router;
