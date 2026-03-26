/**
 * Per-API-Key Rate Limiting Middleware
 * Sliding window algorithm using in-memory store (Redis-compatible interface).
 */

const DEFAULT_RATE_LIMIT = 100;
const DEFAULT_WINDOW_SECONDS = 60;

// In-memory store: keyId -> array of request timestamps (ms)
const store = new Map();

function buildRateLimitHeaders(limit, remaining, resetAt) {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  };
}

function checkRateLimit(keyId, limit, windowSeconds) {
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const cutoff = now - windowMs;

  if (!store.has(keyId)) store.set(keyId, []);
  const timestamps = store.get(keyId).filter(t => t > cutoff);

  const remaining = limit - timestamps.length;
  const resetAt = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs;

  if (remaining <= 0) {
    store.set(keyId, timestamps);
    return { allowed: false, limit, remaining: 0, resetAt };
  }

  timestamps.push(now);
  store.set(keyId, timestamps);
  return { allowed: true, limit, remaining: remaining - 1, resetAt };
}

// Exposed for testing
function clearStore() {
  store.clear();
}

const perKeyRateLimit = (req, res, next) => {
  const keyInfo = req.apiKey;
  // Skip for legacy/unauthenticated keys
  if (!keyInfo || keyInfo.isLegacy || !keyInfo.id) return next();

  const limit = keyInfo.rateLimit || DEFAULT_RATE_LIMIT;
  const windowSeconds = keyInfo.rateLimitWindowSeconds || DEFAULT_WINDOW_SECONDS;

  const result = checkRateLimit(keyInfo.id, limit, windowSeconds);
  const headers = buildRateLimitHeaders(result.limit, result.remaining, result.resetAt);
  res.set(headers);

  if (!result.allowed) {
    res.set('Retry-After', String(Math.ceil((result.resetAt - Date.now()) / 1000)));
    return res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded. Please retry after the reset time.',
        retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
      },
    });
  }

  return next();
};

module.exports = perKeyRateLimit;
module.exports.buildRateLimitHeaders = buildRateLimitHeaders;
module.exports.checkRateLimit = checkRateLimit;
module.exports.clearStore = clearStore;
module.exports.DEFAULT_RATE_LIMIT = DEFAULT_RATE_LIMIT;
module.exports.DEFAULT_WINDOW_SECONDS = DEFAULT_WINDOW_SECONDS;
