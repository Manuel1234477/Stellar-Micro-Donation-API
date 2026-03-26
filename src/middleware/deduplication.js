/**
 * Request Deduplication Middleware
 *
 * RESPONSIBILITY: Content-based deduplication for requests without idempotency keys
 * OWNER: Backend Team
 * DEPENDENCIES: Cache utility, crypto
 *
 * Detects duplicate requests by fingerprinting method + path + body + API key,
 * caching successful responses for a configurable TTL (default 30s), and replaying
 * them for duplicate requests with an X-Deduplicated: true header.
 */

const crypto = require('crypto');
const Cache = require('../utils/cache');
const log = require('../utils/log');

const DEFAULT_OPTIONS = {
  ttlMs: 30000,
  methods: ['POST', 'PUT', 'PATCH'],
};

/**
 * Compute a SHA-256 fingerprint for a request
 * @param {Object} req - Express request object
 * @returns {string} Hex digest fingerprint
 */
function computeFingerprint(req) {
  const body = req.body ? JSON.stringify(req.body) : '';
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const apiKey = req.headers['x-api-key'] || '';
  const input = `${req.method}:${req.path}:${bodyHash}:${apiKey}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Create deduplication middleware with configurable options
 * @param {Object} [options]
 * @param {number} [options.ttlMs=30000] - Cache TTL in milliseconds
 * @param {string[]} [options.methods=['POST','PUT','PATCH']] - HTTP methods to deduplicate
 * @returns {Function} Express middleware
 */
function createDeduplicationMiddleware(options = {}) {
  const { ttlMs, methods } = { ...DEFAULT_OPTIONS, ...options };
  const methodSet = new Set(methods);

  return function deduplicationMiddleware(req, res, next) {
    // Only apply to configured mutation methods
    if (!methodSet.has(req.method)) {
      return next();
    }

    // Skip if idempotency key is present — that system handles deduplication
    if (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) {
      return next();
    }

    try {
      const fingerprint = computeFingerprint(req);
      const cacheKey = `dedup:${fingerprint}`;

      // Check for cached response
      const cached = Cache.get(cacheKey);
      if (cached) {
        log.debug('DEDUPLICATION', 'Returning cached response for duplicate request', {
          fingerprint: fingerprint.substring(0, 16),
          method: req.method,
          path: req.path,
        });
        res.set('X-Deduplicated', 'true');
        return res.status(cached.statusCode).json(cached.body);
      }

      // Intercept res.json() to cache successful responses
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        res.json = originalJson; // restore to prevent double-interception
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            Cache.set(cacheKey, { statusCode: res.statusCode, body }, ttlMs);
            log.debug('DEDUPLICATION', 'Cached response', {
              fingerprint: fingerprint.substring(0, 16),
              statusCode: res.statusCode,
            });
          }
        } catch (err) {
          log.warn('DEDUPLICATION', 'Failed to cache response', {
            error: err.message,
            fingerprint: fingerprint.substring(0, 16),
          });
        }
        return originalJson(body);
      };

      next();
    } catch (err) {
      log.error('DEDUPLICATION', 'Deduplication middleware error', {
        error: err.message,
        path: req.path,
        method: req.method,
      });
      next();
    }
  };
}

module.exports = { createDeduplicationMiddleware, computeFingerprint };
