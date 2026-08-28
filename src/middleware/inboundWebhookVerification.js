/**
 * Inbound Webhook Signature Verification Middleware (Issue #1524)
 *
 * Generic, per-route-configurable middleware that verifies HMAC-SHA256 signatures
 * on inbound webhooks from third-party sources (payment processors, compliance
 * providers, etc). Supports multiple simultaneous named sources, each with its
 * own secret and signature header name (e.g. Stripe-Signature, X-Hub-Signature-256).
 *
 * Requires the raw request body to be available (e.g. via
 * express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })) since
 * signatures are computed over the exact bytes sent by the source, not the
 * re-serialized JSON.
 *
 * Usage:
 *   const { registerWebhookSource, verifyInboundWebhook } = require('../middleware/inboundWebhookVerification');
 *
 *   registerWebhookSource('stripe', {
 *     secret: process.env.STRIPE_WEBHOOK_SECRET,
 *     headerName: 'stripe-signature',
 *     signaturePrefix: '',
 *   });
 *
 *   router.post('/webhooks/inbound/stripe', verifyInboundWebhook('stripe'), handler);
 */

'use strict';

const crypto = require('crypto');
const { safeEqual } = require('../utils/safeEqual');
const log = require('./../utils/log');

/** name -> { secret, headerName, signaturePrefix } */
const sources = new Map();

/**
 * Register (or overwrite) a named inbound webhook source.
 *
 * @param {string} name - Unique identifier for the source (e.g. 'stripe', 'compliance-provider')
 * @param {object} options
 * @param {string} options.secret - Shared HMAC secret for this source
 * @param {string} options.headerName - Header carrying the signature (case-insensitive), e.g. 'stripe-signature'
 * @param {string} [options.signaturePrefix=''] - Prefix before the hex digest in the header value (e.g. 'sha256=' for GitHub-style headers)
 */
function registerWebhookSource(name, { secret, headerName, signaturePrefix = '' }) {
  if (!name || !secret || !headerName) {
    throw new Error('registerWebhookSource requires name, secret, and headerName');
  }
  sources.set(name, { secret, headerName: headerName.toLowerCase(), signaturePrefix });
}

function getWebhookSource(name) {
  return sources.get(name);
}

/**
 * Express middleware factory. Verifies the inbound webhook signature for the
 * named, previously-registered source.
 *
 * @param {string} sourceName - Name passed to registerWebhookSource
 * @returns {import('express').RequestHandler}
 */
function verifyInboundWebhook(sourceName) {
  return function inboundWebhookVerificationMiddleware(req, res, next) {
    const source = sources.get(sourceName);
    if (!source) {
      log.error('INBOUND_WEBHOOK', 'Unknown webhook source configured on route', { sourceName, path: req.path });
      return res.status(500).json({
        success: false,
        error: { code: 'WEBHOOK_SOURCE_NOT_CONFIGURED', message: 'Webhook source is not configured' },
      });
    }

    const headerValue = req.headers[source.headerName];
    if (!headerValue) {
      log.security('INBOUND_WEBHOOK', 'Missing inbound webhook signature header', {
        sourceName,
        headerName: source.headerName,
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        success: false,
        error: { code: 'MISSING_WEBHOOK_SIGNATURE', message: `Missing ${source.headerName} header` },
      });
    }

    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : '');
    const expected =
      source.signaturePrefix +
      crypto.createHmac('sha256', source.secret).update(rawBody).digest('hex');

    const received = Array.isArray(headerValue) ? headerValue[0] : String(headerValue);
    const valid = safeEqual(received, expected);

    if (!valid) {
      log.security('INBOUND_WEBHOOK', 'Invalid inbound webhook signature', {
        sourceName,
        headerName: source.headerName,
        path: req.path,
        ip: req.ip,
      });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Invalid webhook signature' },
      });
    }

    req.webhookSource = sourceName;
    next();
  };
}

/** Test/administrative helper to clear registered sources. */
function _clearWebhookSources() {
  sources.clear();
}

module.exports = {
  registerWebhookSource,
  getWebhookSource,
  verifyInboundWebhook,
  _clearWebhookSources,
};
