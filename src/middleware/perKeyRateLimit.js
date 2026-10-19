'use strict';

/**
 * Per-API-key rate limiting.
 *
 * Counts through the shared store in src/services/rateLimitStores (#1777), so
 * limits are shared across instances when RATE_LIMIT_STORE=redis.
 * Header helpers live in ./rateLimitHeaders (no import back from there).
 */

const { getRateLimitStore } = require('../services/rateLimitStores');
const { buildRateLimitHeaders, calculateRetryAfter } = require('./rateLimitHeaders');

const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 60;
const KEY_PREFIX = 'rl:apikey:';

let _storeOverride = null;
function getStore() {
  return _storeOverride || getRateLimitStore();
}

const perKeyRateLimit = async (req, res, next) => {
  const keyInfo = req.apiKey;
  if (!keyInfo || keyInfo.isLegacy || !keyInfo.id) return next();

  const limit = keyInfo.rateLimitPerMinute || keyInfo.rateLimit || DEFAULT_RATE_LIMIT;
  const windowSeconds = keyInfo.rateLimitWindowSeconds || DEFAULT_WINDOW_SECONDS;

  const result = await getStore().incrementAndCheck(KEY_PREFIX + keyInfo.id, limit, windowSeconds);
  // result.resetAt is epoch ms; buildRateLimitHeaders converts it to seconds
  res.set(buildRateLimitHeaders(limit, result.remaining, result.resetAt));

  if (!result.allowed) {
    const retryAfter = calculateRetryAfter(result.resetAt);
    res.set('Retry-After', retryAfter);
    return res.status(429).json({
      success: false,
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded.', retryAfter: Number(retryAfter) },
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
  const result = getStore().incrementAndCheck(KEY_PREFIX + key, limit, windowSeconds);
  if (result && typeof result.then === 'function') {
    // Async store (Redis): this synchronous path cannot wait for it. Fail open
    // and swallow the eventual result; the store logs its own errors.
    result.catch(() => {});
    return { allowed: true, limit, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
  return {
    allowed: result.allowed,
    limit,
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}

/** Clear in-memory counters (tests). No-op for shared stores. */
function clearStore() {
  const s = getStore();
  if (typeof s.clear === 'function') s.clear();
}

/** Override the store (tests). Pass null to go back to the shared store. */
function _setStore(store) { _storeOverride = store; }

module.exports = perKeyRateLimit;
module.exports.buildRateLimitHeaders = buildRateLimitHeaders;
module.exports.checkRateLimit = checkRateLimit;
module.exports.clearStore = clearStore;
module.exports._setStore = _setStore;
module.exports.DEFAULT_RATE_LIMIT = DEFAULT_RATE_LIMIT;
module.exports.DEFAULT_WINDOW_SECONDS = DEFAULT_WINDOW_SECONDS;
