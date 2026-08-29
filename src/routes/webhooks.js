/**
 * Webhook Routes
 * POST /webhooks                    - Register a webhook
 * GET  /webhooks                    - List webhooks
 * DELETE /webhooks/:id              - Remove a webhook
 * POST /webhooks/:id/rotate-secret  - Rotate the HMAC secret for a webhook
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const requireApiKey = require('../middleware/apiKey');
const WebhookService = require('../services/WebhookService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { requireAdmin } = require('../middleware/rbac');

/**
 * Middleware that verifies the X-Webhook-Signature header on incoming webhook payloads.
 * The signature must be `sha256=<HMAC-SHA256(secret, rawBody)>`.
 * Requires `express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })` upstream.
 *
 * @param {Function} getSecret - Async function that receives req and returns the plaintext secret
 * @returns {import('express').RequestHandler}
 */
function verifyWebhookSignature(getSecret) {
  return asyncHandler(async (req, res, next) => {
    const header = req.headers['x-webhook-signature'];
    if (!header) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Missing X-Webhook-Signature header' },
      });
    }

    const rawBody = req.rawBody || '';
    let secret;
    try {
      secret = await getSecret(req);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Could not resolve webhook secret' },
      });
    }

    const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`);
    const received = Buffer.from(header);

    // Constant-time comparison to prevent timing attacks
    const valid =
      expected.length === received.length &&
      crypto.timingSafeEqual(expected, received);

    if (!valid) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Invalid webhook signature' },
      });
    }

    next();
  });
}

/**
 * POST /webhooks
 * Register a new webhook endpoint.
 * Body: { url, events: string[], secret? }
 */
router.post('/', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.webhook), asyncHandler(async (req, res, next) => {
  try {
    const { url, events, tlsSkipVerify } = req.body;
    // secret is always generated server-side; caller-supplied secrets are ignored
    const webhook = await WebhookService.register({
      url,
      events,
      tlsSkipVerify: !!tlsSkipVerify,
      apiKeyId: req.apiKeyId || null,
      requestId: req.headers['x-request-id'] || req.id || null,
      ipAddress: req.ip || null,
    });
    res.status(201).json({ success: true, data: webhook });
  } catch (err) {
    if (err.status === 400 || err.statusCode === 400) {
      return res.status(400).json({
        success: false,
        error: {
          code: err.code || err.errorCode || 'VALIDATION_ERROR',
          message: err.message,
        },
      });
    }
    next(err);
  }
}));

/**
 * GET /webhooks
 * List registered webhooks (secrets omitted) with cursor pagination.
 * Query params: limit (default 20, max 100), cursor, direction, snapshotAt
 */
router.get('/', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const pagination = parseCursorPaginationQuery(req.query);
    const result = await WebhookService.list({
      cursor: pagination.cursor,
      direction: pagination.direction,
      limit: pagination.limit,
      snapshotAt: pagination.snapshotAt,
    });
    res.json({ success: true, data: result.items, count: result.items.length, pagination: result.meta });
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
 * Get delivery history for a specific webhook with cursor pagination.
 * Query params: limit (default 20, max 100), cursor, direction, snapshotAt
 */
router.get('/:id/deliveries', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    if (isNaN(webhookId)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid webhook ID' } });
    }

    const pagination = parseCursorPaginationQuery(req.query);
    const result = await WebhookService.WebhookService.getDeliveryHistory(webhookId, {
      cursor: pagination.cursor,
      direction: pagination.direction,
      limit: pagination.limit,
      snapshotAt: pagination.snapshotAt,
    });
    res.json({ success: true, data: result.items, count: result.items.length, pagination: result.meta });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /webhooks/:id/rotate-secret
 * Generate a new HMAC-SHA256 signing secret for the webhook.
 * The new secret is returned once and cannot be retrieved again.
 */
router.post('/:id/rotate-secret', requireApiKey, asyncHandler(async (req, res, next) => {
  try {
    const webhookId = parseInt(req.params.id, 10);
    if (isNaN(webhookId)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid webhook ID' } });
    }
    const result = await WebhookService.WebhookService.rotateSecret(webhookId);
    res.json({ success: true, data: result });
  } catch (err) {
    if (err.status === 404) return res.status(404).json({ success: false, error: { message: err.message } });
    next(err);
  }
}));

/**
 * GET /webhooks/dead-letters
 * List dead-letter entries (admin only). Issue #1144.
 */
router.get('/dead-letters', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const items = await WebhookService.WebhookService.listDeadLetters({ limit, offset });
    const { getDlqMetrics } = require('../services/WebhookService');
    res.json({ success: true, data: items, count: items.length, metrics: getDlqMetrics() });
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
module.exports.verifyWebhookSignature = verifyWebhookSignature;
