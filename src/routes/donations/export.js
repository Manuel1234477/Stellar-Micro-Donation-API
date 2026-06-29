/**
 * Donations Sub-Router — Export Operations
 *
 * Handles all donation export endpoints:
 *   POST /donations/export                        — queue async export job (admin)
 *   GET  /donations/export/:jobId                 — check job status (admin)
 *   GET  /donations/export/:jobId/download        — download completed export (admin)
 *   GET  /donations/export                        — streaming export (DEPRECATED)
 */

'use strict';

const express = require('express');
const router = express.Router();

const requireApiKey = require('../../middleware/apiKey');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const asyncHandler = require('../../utils/asyncHandler');

// ─── POST /donations/export ───────────────────────────────────────────────────

/**
 * POST /donations/export
 * Queue an async donation export job. Requires admin role.
 * Supports filters: format, startDate, endDate, status, senderPublicKey, recipientPublicKey
 * Issue #123
 */
router.post('/export', requireApiKey, checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const DonationExportService = require('../../services/DonationExportService');
    const { format = 'csv', startDate, endDate, status, senderPublicKey, recipientPublicKey } = req.body;

    const result = await DonationExportService.queueExportJob(req.apiKey.id, {
      format,
      startDate,
      endDate,
      status,
      senderPublicKey,
      recipientPublicKey,
    });

    return res.status(202).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/export/:jobId ─────────────────────────────────────────────

/**
 * GET /donations/export/:jobId
 * Get status of an async export job. Requires admin role.
 * Issue #123
 */
router.get('/export/:jobId', requireApiKey, checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const DonationExportService = require('../../services/DonationExportService');
    const status = await DonationExportService.getJobStatus(req.params.jobId);

    return res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/export/:jobId/download ────────────────────────────────────

/**
 * GET /donations/export/:jobId/download
 * Download a completed export file. Requires admin role and a valid signed URL token.
 * Issue #123
 */
router.get('/export/:jobId/download', requireApiKey, checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const DonationExportService = require('../../services/DonationExportService');
    const { token, expires } = req.query;

    if (!token || !expires) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_PARAMS', message: 'token and expires parameters are required' },
      });
    }

    const { filePath, format } = await DonationExportService.verifyAndGetDownload(
      req.params.jobId,
      token,
      expires
    );

    const fs = require('fs');

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: { code: 'FILE_NOT_FOUND', message: 'Export file not found' },
      });
    }

    const contentType = format === 'csv' ? 'text/csv' : 'application/json';
    const fileName = `donations-${req.params.jobId}.${format}`;

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/export (DEPRECATED) ──────────────────────────────────────

/**
 * GET /donations/export
 * Stream donations as CSV or JSON (DEPRECATED).
 * @deprecated Use POST /donations/export for async export instead. Issue #919.
 */
router.get('/export', requireApiKey, checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const { format = 'csv', startDate, endDate, status, senderPublicKey, recipientPublicKey } = req.query;

  if (!['csv', 'json'].includes(format)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_FORMAT', message: 'format must be csv or json' } });
  }

  const db = require('../../utils/database');
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

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return (s.includes('"') || s.includes(',') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }

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

module.exports = router;
