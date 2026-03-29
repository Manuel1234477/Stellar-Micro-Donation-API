const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { validateSchema } = require('../middleware/schemaValidation');
const { requireTier } = require('../middleware/rbac');
const ExportService = require('../services/ExportService');
const { ValidationError, NotFoundError } = require('../utils/errors');

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
      id: { type: 'integerString', required: true },
    },
  },
});

/**
 * POST /exports
 * Initiate asynchronous export generation.
 * Requires 'pro' tier or higher.
 */
router.post('/', requireApiKey, requireTier('pro'), createExportSchema, async (req, res, next) => {
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
      data: { exportId, status: 'pending' },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /exports/:id
 * Retrieve export status.
 */
router.get('/:id', requireApiKey, exportIdSchema, async (req, res, next) => {
  try {
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
});

/**
 * GET /exports/:id/download
 * Return a signed download URL for completed exports.
 */
router.get('/:id/download', requireApiKey, exportIdSchema, async (req, res, next) => {
  try {
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
});

module.exports = router;
