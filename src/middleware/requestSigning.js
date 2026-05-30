/**
 * Request Signing Middleware (Issue #66)
 *
 * When REQUIRE_REQUEST_SIGNING=true, all state-changing requests (POST, PUT, PATCH, DELETE)
 * must include X-Signature, X-Timestamp, and X-Nonce headers.
 *
 * Signing scheme: HMAC-SHA256(signingSecret, method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + bodyHash)
 *
 * The signing secret is taken from the authenticated API key's key_secret column.
 * For global enforcement the secret falls back to REQUEST_SIGNING_SECRET env var.
 */

'use strict';

const crypto = require('crypto');
const { getDefaultStore } = require('../utils/nonceStore');
const log = require('../utils/log');

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_WINDOW_SECONDS = parseInt(process.env.REQUEST_SIGNING_WINDOW_SECONDS || '300', 10);

/**
 * Compute HMAC-SHA256 over the canonical string.
 * Canonical: METHOD\npath\ntimestamp\nnonce\nbodyHash
 */
function computeSignature(secret, method, path, timestamp, nonce, rawBody) {
  const bodyHash = crypto.createHash('sha256').update(rawBody || '').digest('hex');
  const canonical = [method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n');
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

/**
 * Constant-time string comparison.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Returns the signing secret for the current request.
 * Prefers the per-API-key secret; falls back to the global env var.
 */
function getSecret(req) {
  return (req.apiKey && req.apiKey.keySecret) || process.env.REQUEST_SIGNING_SECRET || null;
}

/**
 * Express middleware factory.
 * @param {object} [options]
 * @param {boolean} [options.enabled] - Override REQUIRE_REQUEST_SIGNING env var
 * @param {number}  [options.windowSeconds] - Override REQUEST_SIGNING_WINDOW_SECONDS
 */
function createRequestSigningMiddleware(options = {}) {
  const enabled =
    options.enabled !== undefined
      ? options.enabled
      : process.env.REQUIRE_REQUEST_SIGNING === 'true';

  const windowSeconds = options.windowSeconds || DEFAULT_WINDOW_SECONDS;

  return async function requestSigningMiddleware(req, res, next) {
    if (!enabled) return next();
    if (!STATE_CHANGING_METHODS.has(req.method)) return next();

    const timestamp = req.get('x-timestamp');
    const signature = req.get('x-signature');
    const nonce = req.get('x-nonce');

    // All three headers are required
    if (!timestamp || !signature || !nonce) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'SIGNATURE_REQUIRED',
          message: 'X-Signature, X-Timestamp, and X-Nonce headers are required',
        },
      });
    }

    // Validate timestamp window
    const tsSeconds = Number(timestamp);
    if (!Number.isFinite(tsSeconds)) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Invalid X-Timestamp value' },
      });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const age = nowSeconds - tsSeconds;
    if (age > windowSeconds || age < -30) {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Request timestamp expired or too far in the future' },
      });
    }

    // Resolve signing secret
    const secret = getSecret(req);
    if (!secret) {
      log.warn('REQUEST_SIGNING', 'No signing secret available; rejecting signed request', { path: req.path });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'No signing secret configured for this API key' },
      });
    }

    // Verify signature
    const fullPath = req.originalUrl || req.url;
    const rawBody = req.rawBody || '';
    const expected = computeSignature(secret, req.method, fullPath, timestamp, nonce, rawBody);

    if (!safeEqual(signature, expected)) {
      log.warn('REQUEST_SIGNING', 'Signature mismatch', { path: req.path });
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_SIGNATURE', message: 'Signature mismatch' },
      });
    }

    // Nonce replay check
    try {
      const nonceStore = getDefaultStore();
      const { seen } = await nonceStore.check(nonce);
      if (seen) {
        log.warn('REQUEST_SIGNING', 'Replayed nonce rejected', { path: req.path });
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_SIGNATURE', message: 'Nonce has already been used (replay detected)' },
        });
      }
    } catch (err) {
      log.error('REQUEST_SIGNING', 'Nonce store error', { error: err.message });
      // Fail open on nonce store errors to avoid blocking legitimate requests
    }

    next();
  };
}

module.exports = { createRequestSigningMiddleware, computeSignature };
