'use strict';

const express = require('express');
const router = express.Router();

const i18nController = require('../../controllers/i18nController');
const { requireAdmin } = require('../../middleware/auth');
const retentionService = require('../../services/retentionService');
const logger = require('../../utils/logger');

// ---------------------------------------------------------------------------
// i18n admin routes
// ---------------------------------------------------------------------------

router.get('/i18n/locales', requireAdmin, i18nController.listLocales);
router.get('/i18n/translations/:locale', requireAdmin, i18nController.getTranslations);
router.put('/i18n/translations/:locale', requireAdmin, i18nController.updateTranslations);
router.post('/i18n/translations/:locale/validate', requireAdmin, i18nController.validateTranslations);
router.post('/i18n/cache/clear', requireAdmin, i18nController.clearCache);

// ---------------------------------------------------------------------------
// Retention status
// ---------------------------------------------------------------------------

router.get('/retention', requireAdmin, async (req, res, next) => {
  try {
    const status = await retentionService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    logger.error('Failed to fetch retention status', { error: err.message });
    next(err);
  }
});

module.exports = router;