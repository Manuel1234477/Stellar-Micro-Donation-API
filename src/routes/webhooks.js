/**
 * Webhook Routes
 * POST /webhooks   - Register a webhook
 * GET  /webhooks   - List webhooks
 * DELETE /webhooks/:id - Remove a webhook
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const WebhookService = require('../services/WebhookService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

/**
 * POST /webhooks
 * Register a new webhook endpoint.
 * Body: { url, events: string[], secret? }
 */
router.post('/', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.webhook), asyncHandler(async (req, res, next) => {
  try {
    const { url, events, secret } = req.body;
    const webhook = await WebhookService.register({
      url,
      events,
      secret,
      apiKeyId: req.apiKeyId || null,
    });
    res.status(201).json({ success: true, data: webhook });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ success: false, error: { message: err.message } });
    next(err);
  }
}));

/**
 * GET /webhooks
 * List all registered webhooks (secrets omitted).
 */
router.get('/', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const webhooks = await WebhookService.list();
    res.json({ success: true, data: webhooks, count: webhooks.length });
  } catch (err) {
    next(err);
  }
}));

/**
 * DELETE /webhooks/:id
 * Remove a webhook by ID.
 */
router.delete('/:id', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    await WebhookService.remove(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: { message: err.message } });
    next(err);
  }
}));

/**
 * GET /webhooks/:id/deliveries
 * Get delivery history for a specific webhook.
 * Query params: limit (default: 50), offset (default: 0)
 */
router.get('/:id/deliveries', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    if (isNaN(webhookId)) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Invalid webhook ID' } 
      });
    }

    const deliveries = await WebhookService.WebhookService.getDeliveryHistory(webhookId, { limit, offset });
    res.json({ 
      success: true, 
      data: deliveries, 
      count: deliveries.length,
      pagination: { limit, offset }
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /webhooks/dead-letters/:id/replay
 * Manually trigger a retry for a dead-letter webhook.
 */
router.post('/dead-letters/:id/replay', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const deadLetterId = parseInt(req.params.id, 10);
    
    if (isNaN(deadLetterId)) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Invalid dead-letter ID' } 
      });
    }

    await WebhookService.WebhookService.replayDeadLetter(deadLetterId);
    res.json({ 
      success: true, 
      message: 'Dead-letter webhook scheduled for retry' 
    });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: { message: err.message } });
    next(err);
  }
}));

module.exports = router;
