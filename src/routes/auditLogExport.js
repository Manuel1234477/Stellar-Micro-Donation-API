/**
 * Audit Log Export Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for audit log export operations
 * OWNER: Compliance Team
 * DEPENDENCIES: AuditLogExportService, AuditLogService, middleware (auth, RBAC)
 * 
 * Provides endpoints for exporting audit logs with date range filtering,
 * JSON/CSV format support, and async generation for large exports.
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/rbac');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { validateSchema } = require('../middleware/schemaValidation');
const AuditLogService = require('../services/AuditLogService');
const AuditLogExportService = require('../services/AuditLogExportService');
const log = require('../utils/log');

/**
 * Schema for audit log export request
 */
const auditLogExportSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  },
  query: {
    fields: {
      startDate: {
        type: 'string',
        required: false,
        nullable: true
      },
      endDate: {
        type: 'string',
        required: false,
        nullable: true
      },
      action: {
        type: 'string',
        required: false,
        nullable: true
      },
      format: {
        type: 'string',
        required: false,
        enum: ['json', 'csv'],
        default: 'json'
      }
    }
  }
});

/**
 * Schema for export status request
 */
const exportStatusSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 },
      exportId: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

/**
 * GET /api-keys/:id/audit-log
 * Export audit logs for a specific API key
 */
router.get('/:id/audit-log', requireAdmin(), auditLogExportSchema, async (req, res, next) => {
  try {
    const apiKeyId = req.params.id;
    const { startDate, endDate, action, format = 'json' } = req.query;

    // Validate API key exists
    const apiKeysModel = require('../models/apiKeys');
    const apiKey = await apiKeysModel.getApiKeyById(apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found', ERROR_CODES.API_KEY_NOT_FOUND);
    }

    // Initiate export
    const result = await AuditLogExportService.initiateExport(apiKeyId, {
      startDate,
      endDate,
      action,
      format
    });

    // Log the export request
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.API_KEY_MANAGEMENT,
      action: 'AUDIT_LOG_EXPORT_REQUESTED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/api-keys/${apiKeyId}/audit-log`,
      details: {
        apiKeyId,
        startDate,
        endDate,
        action,
        format,
        recordCount: result.recordCount,
        async: result.async
      }
    });

    // Return response based on sync/async
    if (result.async) {
      res.status(202).json({
        success: true,
        data: result
      });
    } else {
      // For sync exports, return content directly
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv' : 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${apiKeyId}-${Date.now()}.${format}"`);
      res.send(result.content);
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api-keys/:id/audit-log/export/:exportId
 * Get status of an async export
 */
router.get('/:id/audit-log/export/:exportId', requireAdmin(), exportStatusSchema, async (req, res, next) => {
  try {
    const apiKeyId = req.params.id;
    const exportId = req.params.exportId;

    // Get export status
    const status = await AuditLogExportService.getExportStatus(apiKeyId, exportId);

    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api-keys/:id/audit-log/export/:exportId/download
 * Download completed export
 */
router.get('/:id/audit-log/export/:exportId/download', requireAdmin(), exportStatusSchema, async (req, res, next) => {
  try {
    const apiKeyId = req.params.id;
    const exportId = req.params.exportId;

    // Get export status
    const status = await AuditLogExportService.getExportStatus(apiKeyId, exportId);

    if (status.status !== AuditLogExportService.EXPORT_STATUS.COMPLETED) {
      throw new ValidationError(
        `Export is not ready. Current status: ${status.status}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    // In production, retrieve from file storage
    // For now, regenerate the export
    const exportRecord = await AuditLogExportService.getExportRecord(exportId);
    
    const logs = await AuditLogExportService.queryAuditLogs(apiKeyId, {
      startDate: exportRecord.startDate,
      endDate: exportRecord.endDate,
      action: exportRecord.actionFilter,
      limit: 100000
    });

    let content;
    if (exportRecord.format === AuditLogExportService.EXPORT_FORMAT.CSV) {
      content = AuditLogExportService.convertToCSV(logs);
      res.setHeader('Content-Type', 'text/csv');
    } else {
      content = AuditLogExportService.convertToJSON(logs);
      res.setHeader('Content-Type', 'application/json');
    }

    res.setHeader('Content-Disposition', `attachment; filename="audit-log-${apiKeyId}-${exportId}.${exportRecord.format}"`);
    res.send(content);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api-keys/:id/audit-log/exports
 * List all exports for an API key
 */
router.get('/:id/audit-log/exports', requireAdmin(), async (req, res, next) => {
  try {
    const apiKeyId = req.params.id;
    const { limit = 50, offset = 0 } = req.query;

    // Validate API key exists
    const apiKeysModel = require('../models/apiKeys');
    const apiKey = await apiKeysModel.getApiKeyById(apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found', ERROR_CODES.API_KEY_NOT_FOUND);
    }

    // Get exports
    const exports = await AuditLogExportService.getExports(apiKeyId, {
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });

    res.json({
      success: true,
      data: {
        exports,
        count: exports.length,
        apiKeyId
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api-keys/:id/audit-log/stats
 * Get audit log statistics for an API key
 */
router.get('/:id/audit-log/stats', requireAdmin(), async (req, res, next) => {
  try {
    const apiKeyId = req.params.id;
    const { startDate, endDate } = req.query;

    // Validate API key exists
    const apiKeysModel = require('../models/apiKeys');
    const apiKey = await apiKeysModel.getApiKeyById(apiKeyId);
    if (!apiKey) {
      throw new NotFoundError('API key not found', ERROR_CODES.API_KEY_NOT_FOUND);
    }

    // Get statistics
    const stats = await AuditLogService.getStatistics({
      userId: apiKeyId,
      startDate,
      endDate
    });

    // Get total count
    const totalCount = await AuditLogExportService.countAuditLogs(apiKeyId, {
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: {
        apiKeyId,
        totalCount,
        statistics: stats,
        dateRange: {
          startDate,
          endDate
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
