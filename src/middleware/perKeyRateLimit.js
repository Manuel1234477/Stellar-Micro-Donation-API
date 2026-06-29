'use strict';

const { getRateLimitStore } = require('./RateLimitStore');

const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 60;

let _store = null;
function getStore() {
  if (!_store) _store = getRateLimitStore();
  return _store;
}

/**
 * Build standard rate-limit response headers.
 *
 * @param {number} limit        - Total request ceiling for the window
 * @param {number} remaining    - Requests remaining in the current window
 * @param {number} resetUnixSec - Window reset time as a Unix timestamp in **seconds**
 * @returns {Object} Header name → string value map
 */
function buildRateLimitHeaders(limit, remaining, resetUnixSec) {
  const resetStr = String(Math.ceil(Number(resetUnixSec)));
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': resetStr,
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': resetStr,
  };
}

const perKeyRateLimit = async (req, res, next) => {
  const keyInfo = req.apiKey;
  if (!keyInfo || keyInfo.isLegacy || !keyInfo.id) return next();

  const limit = keyInfo.rateLimitPerMinute || keyInfo.rateLimit || DEFAULT_RATE_LIMIT;
  const windowSeconds = keyInfo.rateLimitWindowSeconds || DEFAULT_WINDOW_SECONDS;

  const result = await getStore().incrementAndCheck(keyInfo.id, limit, windowSeconds);
  // result.resetAt is in milliseconds; convert to seconds for the header contract
  res.set(buildRateLimitHeaders(limit, result.remaining, Math.ceil(result.resetAt / 1000)));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded.', retryAfter },
    });
  }

  return next();
};

/**
 * Synchronous per-key rate-limit check used by the legacy-API-key path in
 * rbac.js, which consumes the result inline (no await). Delegates to the
 * configured store and normalises the shape to include `limit`.
 *
 * The default in-memory store returns synchronously. If an async store (e.g.
 * Redis) is configured, this synchronous entry point cannot block on it, so it
 * fails open (allows the request) rather than throwing in the auth path — the
 * async `perKeyRateLimit` middleware still enforces limits for DB-backed keys.
 *
 * @param {string} key
 * @param {number} [limit] request ceiling; defaults to the module constant
 * @param {number} [windowSeconds] window length in seconds; defaults to the module constant
 * @returns {{ allowed: boolean, limit: number, remaining: number, resetAt: number }}
 */
function checkRateLimit(key, limit = DEFAULT_RATE_LIMIT, windowSeconds = DEFAULT_WINDOW_SECONDS) {
  const result = getStore().incrementAndCheck(key, limit, windowSeconds);
  if (result && typeof result.then === 'function') {
    // Async store: cannot resolve synchronously here — fail open.
    return { allowed: true, limit, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
  return {
    allowed: result.allowed,
    limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}

function clearStore() {
  const s = getStore();
  if (typeof s.clear === 'function') s.clear();
}

function _setStore(store) { _store = store; }

module.exports = perKeyRateLimit;
module.exports.buildRateLimitHeaders = buildRateLimitHeaders;
module.exports.checkRateLimit = checkRateLimit;
module.exports.clearStore = clearStore;
module.exports._setStore = _setStore;
module.exports.DEFAULT_RATE_LIMIT = DEFAULT_RATE_LIMIT;
module.exports.DEFAULT_WINDOW_SECONDS = DEFAULT_WINDOW_SECONDS;
