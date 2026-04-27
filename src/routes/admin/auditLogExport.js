/**
 * Admin Audit Log Export Routes (Extended) - Issue #604
 *
 * RESPONSIBILITY: Async audit log export with date range filtering and signed download URLs
 * OWNER: Compliance Team
 * DEPENDENCIES: AuditLogExportService, middleware (auth, admin RBAC)
 *
 * Endpoints:
 *   POST /admin/audit-logs/export          - Queue async export job
 *   GET  /admin/audit-logs/export/:jobId/status   - Poll job status
 *   GET  /admin/audit-logs/export/:jobId/download - Get signed download URL
 */

/**
 * @openapi
 * tags:
 *   - name: AuditLogExport
 *     description: Compliance audit log export with async jobs and signed URLs
 *
 * /admin/audit-logs/export:
 *   post:
 *     tags: [AuditLogExport]
 *     summary: Queue an async audit log export job
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               startDate:
 *                 type: string
 *                 format: date-time
 *               endDate:
 *                 type: string
 *                 format: date-time
 *               eventType:
 *                 type: string
 *               format:
 *                 type: string
 *                 enum: [json, csv]
 *                 default: json
 *     responses:
 *       202:
 *         description: Export job queued
 *       400:
 *         description: Validation error
 *
 * /admin/audit-logs/export/{jobId}/status:
 *   get:
 *     tags: [AuditLogExport]
 *     summary: Poll export job status
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job status
 *       404:
 *         description: Job not found
 *
 * /admin/audit-logs/export/{jobId}/download:
 *   get:
 *     tags: [AuditLogExport]
 *     summary: Get signed download URL for completed export
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *     responses:
 *       200:
 *         description: Signed download URL
 *       202:
 *         description: Export not yet complete
 *       404:
 *         description: Job not found
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/rbac');
const AuditLogExportService = require('../../services/AuditLogExportService');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../../utils/errors');

/**
 * POST /admin/audit-logs/export
 * Queue an async audit log export job with date range and event type filters.
 */
router.post('/', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate, eventType, format = 'json' } = req.body;

    if (!['json', 'csv'].includes(format)) {
      throw new ValidationError('format must be json or csv', null, ERROR_CODES.INVALID_REQUEST);
    }

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      throw new ValidationError('startDate must be before endDate', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Use a system-level key ID for admin exports
    const apiKeyId = (req.user && req.user.id) || 'admin';

    const result = await AuditLogExportService.queueExportJob(apiKeyId, {
      startDate: startDate || null,
      endDate: endDate || null,
      eventType: eventType || null,
      format
    });

    return res.status(202).json({
      success: true,
      data: {
        jobId: result.jobId,
        status: result.status,
        message: 'Export job queued. Poll /status to check progress.'
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/audit-logs/export/:jobId/status
 * Poll the status of an async export job.
 */
router.get('/:jobId/status', requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const status = await AuditLogExportService.getJobStatus(jobId);
    return res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/audit-logs/export/:jobId/download
 * Return a signed URL for downloading a completed export.
 * Returns 202 if the job is not yet complete.
 */
router.get('/:jobId/download', requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { jobId } = req.params;
    const { format } = req.query;

    const result = await AuditLogExportService.getSignedDownloadUrl(jobId, { format });

    if (result.pending) {
      return res.status(202).json({
        success: true,
        data: { jobId, status: result.status, message: 'Export not yet complete' }
      });
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
