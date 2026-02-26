/**
 * Build standard rate limit HTTP headers
 *
 * @param {number} limit - Maximum requests allowed in the time window
 * @param {number} remaining - Number of requests remaining in current window
 * @param {number} resetTime - Unix timestamp (seconds) when the rate limit resets
 * @returns {Object} Object containing X-RateLimit-* headers
 */
function buildRateLimitHeaders(limit, remaining, resetTime) {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetTime)
  };
}

module.exports = {
  buildRateLimitHeaders
};
