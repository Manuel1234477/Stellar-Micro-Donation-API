'use strict';

/**
 * Admin Webhook Routes
 * GET  /admin/webhooks                      — list all registered webhooks
 * GET  /admin/webhooks/:id/deliveries       — paginated delivery history
 * POST /admin/webhooks/:id/retry            — manually retry last failed delivery
 * PATCH /admin/webhooks/:id                 — disable a webhook
 * GET  /admin/webhooks/dead-letter          — list permanently failed deliveries
 * POST /admin/webhooks/dead-letter/:id/replay — manually replay a dead-letter entry
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../../middleware/apiKey');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { requireAdmin} = require('../../middleware/rbac');
const WebhookService = require('../../services/WebhookService');
const Database = require('../../utils/database');
const { validateSchema } = require('../../middleware/schemaValidation');
const { validateLimit } = require('../../utils/pagination');

const updateWebhookStatusSchema = validateSchema({
  body: {
    fields: {
      status: { type: 'string', required: true, enum: ['active', 'disabled'] },
    }
  }
});

/**
 * GET /admin/webhooks
 * List all registered webhooks with metrics.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const limitResult = validateLimit(req.query.limit, { defaultValue: 50 });
    if (!limitResult.valid) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: limitResult.error } });
    }
    const limit = limitResult.value;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    const webhooks = await Database.all(
      `SELECT id, url, events, is_active, created_at FROM webhooks 
       ORDER BY created_at DESC 
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    
    // Enrich with metrics
    const enriched = await Promise.all(webhooks.map(async (w) => {
      const deliveries = await Database.all(
        `SELECT status, delivered_at FROM webhook_delivery_history 
         WHERE webhook_id = ? 
         ORDER BY delivered_at DESC 
         LIMIT 100`,
        [w.id]
      );
      
      const last24h = Date.now() - 24 * 60 * 60 * 1000;
      const recent24h = deliveries.filter(d => new Date(d.delivered_at).getTime() > last24h);
      const failures24h = recent24h.filter(d => d.status === 'failed').length;
      const successRate7d = deliveries.length > 0 
        ? ((deliveries.filter(d => d.status === 'success').length / deliveries.length) * 100).toFixed(1)
        : 100;
      
      return {
        id: w.id,
        url: w.url.substring(0, 20) + (w.url.length > 20 ? '...' : ''),
        events: (() => { try { return JSON.parse(w.events); } catch { return []; } })(),
        status: w.is_active ? 'active' : 'disabled',
        lastDeliveryAt: deliveries.length > 0 ? deliveries[0].delivered_at : null,
        failureCount24h: failures24h,
        successRate7d: parseFloat(successRate7d)
      };
    }));
    
    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /admin/webhooks/:id/deliveries
 * Get paginated delivery history for a webhook.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/:id/deliveries', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    const limitResult = validateLimit(req.query.limit, { defaultValue: 50 });
    if (!limitResult.valid) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: limitResult.error } });
    }
    const limit = limitResult.value;
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);

    // Verify webhook exists
    const webhook = await Database.get('SELECT id FROM webhooks WHERE id = ?', [webhookId]);
    if (!webhook) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }
    
    const deliveries = await Database.all(
      `SELECT id, event, status, status_code, error_message, attempt, delivered_at 
       FROM webhook_delivery_history 
       WHERE webhook_id = ? 
       ORDER BY delivered_at DESC 
       LIMIT ? OFFSET ?`,
      [webhookId, limit, offset]
    );
    
    const enriched = deliveries.map(d => ({
      deliveryId: d.id,
      event: d.event,
      status: d.status,
      responseCode: d.status_code,
      responseTimeMs: null, // Not tracked in current schema
      attemptCount: d.attempt,
      deliveredAt: d.delivered_at,
      errorMessage: d.error_message
    }));
    
    res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/webhooks/:id/retry
 * Manually retry the last failed delivery for a webhook.
 */
router.post('/:id/retry', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.webhook), asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    
    // Verify webhook exists
    const webhook = await Database.get('SELECT id FROM webhooks WHERE id = ?', [webhookId]);
    if (!webhook) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }
    
    // Find last failed delivery
    const lastFailed = await Database.get(
      `SELECT id, event, payload FROM webhook_delivery_history 
       WHERE webhook_id = ? AND status = 'failed' 
       ORDER BY delivered_at DESC 
       LIMIT 1`,
      [webhookId]
    );
    
    if (!lastFailed) {
      return res.status(404).json({ success: false, error: { code: 'NO_FAILED_DELIVERY', message: 'No failed delivery found for this webhook' } });
    }
    
    // Schedule retry
    const payload = (() => { try { return JSON.parse(lastFailed.payload); } catch { return lastFailed.payload; } })();
    await WebhookService.scheduleRetry({
      webhookId,
      event: lastFailed.event,
      payload,
      attempt: 0
    });
    
    res.json({ success: true, data: { retried: true, deliveryId: lastFailed.id } });
  } catch (err) {
    next(err);
  }
}));

/**
 * PATCH /admin/webhooks/:id
 * Update webhook status (disable/enable).
 * Body: { status: "disabled" | "active" }
 */
router.patch('/:id', requireApiKey, requireAdmin(), updateWebhookStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.webhook), asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    const { status } = req.body;
    
    // Verify webhook exists
    const webhook = await Database.get('SELECT id FROM webhooks WHERE id = ?', [webhookId]);
    if (!webhook) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    }
    
    const isActive = status === 'active' ? 1 : 0;
    await Database.run('UPDATE webhooks SET is_active = ? WHERE id = ?', [isActive, webhookId]);
    
    res.json({ success: true, data: { id: webhookId, status } });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /admin/webhooks/dead-letter
 * List permanently failed webhook deliveries.
 * Query params: limit (default 50), offset (default 0)
 */
router.get('/dead-letter', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const limitResult = validateLimit(req.query.limit, { defaultValue: 50 });
    if (!limitResult.valid) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: limitResult.error } });
    }
    const limit = limitResult.value;
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
