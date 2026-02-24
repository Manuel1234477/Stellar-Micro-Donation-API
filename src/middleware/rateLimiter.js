/**
 * Rate Limiter Middleware
 * Enforces per-API key rate limiting for donation endpoints
 */

const RequestCounter = require('./RequestCounter');
const { buildRateLimitError, buildMissingApiKeyError } = require('./rateLimitErrors');
const { buildRateLimitHeaders } = require('./rateLimitHeaders');
const { rateLimitConfig } = require('../config/rateLimit');

/**
 * Create rate limiter middleware
 * @param {Object} options - Configuration options
 * @param {number} options.limit - Maximum requests per window (default: from config)
 * @param {number} options.windowMs - Time window in milliseconds (default: from config)
 * @param {number} options.cleanupIntervalMs - Cleanup interval (default: from config)
 * @returns {Function} Express middleware function
 */
function rateLimiter(options = {}) {
  const limit = options.limit || rateLimitConfig.limit;
  const windowMs = options.windowMs || rateLimitConfig.windowMs;
  const cleanupIntervalMs = options.cleanupIntervalMs || rateLimitConfig.cleanupIntervalMs;

  // Create request counter with automatic cleanup
  const counter = new RequestCounter(windowMs, cleanupIntervalMs);

  return function(req, res, next) {
    // Extract API key from header
    const apiKey = req.get('X-API-Key');

    // Check if API key is missing or empty
    if (!apiKey || apiKey.trim() === '') {
      return res.status(401).json(buildMissingApiKeyError());
    }

    // Get current count for this API key
    const currentCount = counter.getCount(apiKey);

    // Check if limit exceeded
    if (currentCount >= limit) {
      const timeUntilReset = counter.getTimeUntilReset(apiKey);
      const resetTime = Math.ceil((Date.now() + timeUntilReset) / 1000); // Unix timestamp in seconds
      const resetAt = new Date(Date.now() + timeUntilReset);

      // Add rate limit headers
      const headers = buildRateLimitHeaders(limit, 0, resetTime);
      res.set(headers);

      return res.status(429).json(buildRateLimitError(limit, resetAt));
    }

    // Increment counter
    const newCount = counter.increment(apiKey);
    const remaining = Math.max(0, limit - newCount);
    const timeUntilReset = counter.getTimeUntilReset(apiKey);
    const resetTime = Math.ceil((Date.now() + timeUntilReset) / 1000);

    // Add rate limit headers
    const headers = buildRateLimitHeaders(limit, remaining, resetTime);
    res.set(headers);

    // Allow request to proceed
    next();
  };
}

module.exports = rateLimiter;
