'use strict';

/**
 * Admin Webhook Routes
 * GET  /admin/webhooks/dead-letter          — list permanently failed deliveries
 * POST /admin/webhooks/dead-letter/:id/replay — manually replay a dead-letter entry
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../../middleware/apiKey');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { requireAdmin } = require('../../middleware/rbac');
const { WebhookService } = require('../../services/WebhookService');

/**
 * GET /admin/webhooks/dead-letter
 * List permanently failed webhook deliveries.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/dead-letter', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const entries = await WebhookService.listDeadLetters({ limit, offset });
    res.json({ success: true, count: entries.length, data: entries });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/webhooks/dead-letter/:id/replay
 * Re-schedule a dead-letter entry as a fresh retry attempt.
 */
router.post('/dead-letter/:id/replay', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.webhook), asyncHandler(async (req, res, next) => {
  try {
    await WebhookService.replayDeadLetter(parseInt(req.params.id, 10));
    res.json({ success: true, data: { replayed: true, id: parseInt(req.params.id, 10) } });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
    next(err);
  }
}));

module.exports = router;
