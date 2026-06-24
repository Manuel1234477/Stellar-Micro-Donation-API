'use strict';

const { getRateLimitStore } = require('./RateLimitStore');

const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 60;

let _store = null;
function getStore() {
  if (!_store) _store = getRateLimitStore();
  return _store;
}

function buildRateLimitHeaders(limit, remaining, resetAt) {
  const resetUnix = String(Math.ceil(resetAt / 1000));
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': resetUnix,
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': resetUnix,
  };
}

const perKeyRateLimit = async (req, res, next) => {
  const keyInfo = req.apiKey;
  if (!keyInfo || keyInfo.isLegacy || !keyInfo.id) return next();

  const limit = keyInfo.rateLimitPerMinute || keyInfo.rateLimit || DEFAULT_RATE_LIMIT;
  const windowSeconds = keyInfo.rateLimitWindowSeconds || DEFAULT_WINDOW_SECONDS;

  const result = await getStore().incrementAndCheck(keyInfo.id, limit, windowSeconds);
  res.set(buildRateLimitHeaders(limit, result.remaining, result.resetAt));

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

function clearStore() {
  const s = getStore();
  if (typeof s.clear === 'function') s.clear();
}

function _setStore(store) { _store = store; }

module.exports = perKeyRateLimit;
module.exports.buildRateLimitHeaders = buildRateLimitHeaders;
module.exports.clearStore = clearStore;
module.exports._setStore = _setStore;
module.exports.DEFAULT_RATE_LIMIT = DEFAULT_RATE_LIMIT;
module.exports.DEFAULT_WINDOW_SECONDS = DEFAULT_WINDOW_SECONDS;
