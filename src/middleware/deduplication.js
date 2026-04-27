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


const DEDUP_WINDOW_MS = process.env.DEDUP_WINDOW_MS ? parseInt(process.env.DEDUP_WINDOW_MS, 10) : 30000;
const DEFAULT_OPTIONS = {
  ttlMs: DEDUP_WINDOW_MS,
  methods: ['POST', 'PATCH'],
};


/**
 * Compute a SHA-256 fingerprint for a request using API key, endpoint, and sorted body JSON
 * @param {Object} req - Express request object
 * @returns {string} Hex digest fingerprint
 */
function computeFingerprint(req) {
  const apiKeyId = req.headers['x-api-key'] || '';
  const endpoint = req.originalUrl || req.url || req.path;
  let sortedBody = '';
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0) {
    sortedBody = JSON.stringify(sortObject(req.body));
  }
  const input = apiKeyId + '|' + endpoint + '|' + sortedBody;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function sortObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObject);
  } else if (obj && typeof obj === 'object') {
    return Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = sortObject(obj[key]);
      return acc;
    }, {});
  }
  return obj;
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
    // Only apply to POST and PATCH (not GET)
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
