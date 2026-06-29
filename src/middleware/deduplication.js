/**
 * Request Deduplication Middleware
 *
 * RESPONSIBILITY: Content-based deduplication for requests without idempotency keys.
 *
 * Primary path: state is persisted in the `dedup_cache` DB table so it survives
 * process restarts and is visible across instances (migration 018).
 *
 * Fallback path: when the DB table does not yet exist (e.g. before the first
 * migration run, or in unit-test setups that don't wire a full DB), an in-process
 * Map is used instead. This keeps the middleware functional in all environments
 * while the primary DB-backed path handles production correctness.
 */

const crypto = require('crypto');
const Database = require('../utils/database');
const log = require('../utils/log');

const DEDUP_WINDOW_MS = process.env.DEDUP_WINDOW_MS ? parseInt(process.env.DEDUP_WINDOW_MS, 10) : 30000;
const DEFAULT_OPTIONS = {
  ttlMs: DEDUP_WINDOW_MS,
  methods: ['POST', 'PATCH'],
};

// In-memory fallback used when the dedup_cache table does not exist yet
const _memCache = new Map();
const MEM_CACHE_MAX_SIZE = parseInt(process.env.DEDUP_MEM_CACHE_MAX_SIZE, 10) || 5000;
const MEM_CACHE_CLEANUP_INTERVAL_MS = parseInt(process.env.DEDUP_MEM_CACHE_CLEANUP_INTERVAL_MS, 10) || 60000;
let _memCleanupTimer = null;

function _memGet(key) {
  const item = _memCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) { _memCache.delete(key); return null; }
  return item.value;
}

function _memSet(key, value, ttlMs) {
  _memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (_memCache.size > MEM_CACHE_MAX_SIZE) {
    const oldest = _memCache.keys().next().value;
    if (oldest) _memCache.delete(oldest);
  }
}

/**
 * Remove expired entries from the in-memory dedup fallback cache.
 * @returns {number} Number of entries removed
 */
function _memCleanup() {
  const now = Date.now();
  let removed = 0;
  for (const [key, item] of _memCache) {
    if (now > item.expiresAt) {
      _memCache.delete(key);
      removed++;
    }
  }
  return removed;
}

/**
 * Start periodic background cleanup for the in-memory dedup fallback cache.
 */
function startMemCacheCleanup() {
  if (_memCleanupTimer) return;
  _memCleanupTimer = setInterval(_memCleanup, MEM_CACHE_CLEANUP_INTERVAL_MS);
  if (_memCleanupTimer.unref) _memCleanupTimer.unref();
}

/**
 * Stop the background dedup memory cache cleanup timer.
 */
function stopMemCacheCleanup() {
  if (_memCleanupTimer) {
    clearInterval(_memCleanupTimer);
    _memCleanupTimer = null;
  }
}

/**
 * Compute a SHA-256 fingerprint for a request using API key, endpoint, and sorted body JSON.
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
 * Create deduplication middleware with configurable options.
 * @param {Object} [options]
 * @param {number} [options.ttlMs=30000] - Cache TTL in milliseconds
 * @param {string[]} [options.methods=['POST','PATCH']] - HTTP methods to deduplicate
 * @returns {Function} Express middleware
 */
function createDeduplicationMiddleware(options = {}) {
  const { ttlMs, methods } = { ...DEFAULT_OPTIONS, ...options };
  const methodSet = new Set(methods);

  return async function deduplicationMiddleware(req, res, next) {
    if (!methodSet.has(req.method)) return next();

    // Skip if idempotency key is present — that system handles deduplication
    if (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) {
      return next();
    }

    const fingerprint = computeFingerprint(req);
    const apiKeyId = req.apiKey?.id || null;
    const cacheKey = `dedup:${fingerprint}`;

    // ── Primary: DB-backed dedup ─────────────────────────────────────────────
    let useMemFallback = false;

    try {
      const cached = await Database.get(
        `SELECT status_code, body FROM dedup_cache
         WHERE fingerprint = ?
           AND (apiKeyId = ? OR (apiKeyId IS NULL AND ? IS NULL))
           AND expires_at > datetime('now')`,
        [fingerprint, apiKeyId, apiKeyId]
      );

      if (cached) {
        log.debug('DEDUPLICATION', 'Returning cached response (DB) for duplicate request', {
          fingerprint: fingerprint.substring(0, 16),
          method: req.method,
          path: req.path,
        });
        res.set('X-Deduplicated', 'true');
        return res.status(cached.status_code).json(JSON.parse(cached.body));
      }
    } catch (err) {
      if (err.message && err.message.includes('no such table')) {
        useMemFallback = true;
      } else {
        log.warn('DEDUPLICATION', 'DB cache read failed', { error: err.message });
        useMemFallback = true;
      }
    }

    // ── Fallback: in-memory dedup ────────────────────────────────────────────
    if (useMemFallback) {
      const memCached = _memGet(cacheKey);
      if (memCached) {
        log.debug('DEDUPLICATION', 'Returning cached response (memory) for duplicate request', {
          fingerprint: fingerprint.substring(0, 16),
        });
        res.set('X-Deduplicated', 'true');
        return res.status(memCached.statusCode).json(memCached.body);
      }

      const originalJson = res.json.bind(res);
      res.json = function (body) {
        res.json = originalJson;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          _memSet(cacheKey, { statusCode: res.statusCode, body }, ttlMs);
        }
        return originalJson(body);
      };
      return next();
    }

    // ── Intercept res.json() to persist the response for subsequent duplicates ─
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      res.json = originalJson;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const expiresAt = new Date(Date.now() + ttlMs).toISOString();
        Database.run(
          `INSERT OR REPLACE INTO dedup_cache
           (fingerprint, apiKeyId, status_code, body, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
          [fingerprint, apiKeyId, res.statusCode, JSON.stringify(body), expiresAt]
        ).catch(err => {
          log.warn('DEDUPLICATION', 'Failed to persist response', {
            error: err.message,
            fingerprint: fingerprint.substring(0, 16),
          });
        });
      }
      return originalJson(body);
    };

    next();
  };
}

module.exports = { createDeduplicationMiddleware, computeFingerprint, startMemCacheCleanup, stopMemCacheCleanup };
