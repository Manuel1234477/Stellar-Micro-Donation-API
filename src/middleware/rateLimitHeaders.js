/**
 * Rate Limit Headers
 *
 * Canonical home of the rate-limit header helpers. Both perKeyRateLimit.js and
 * rateLimiter.js import from here; this module imports neither, which keeps
 * the rate-limit modules free of circular dependencies (#1777).
 * See docs/RATE_LIMIT_COMPOSITION.md for the full layer description.
 */

'use strict';

/**
 * Build IETF RateLimit-* and legacy X-RateLimit-* headers.
 *
 * @param {number} limit
 * @param {number} remaining
 * @param {number|string} resetAt - Epoch milliseconds (converted to seconds) or a preformatted value
 * @returns {Object<string, string>}
 */
function buildRateLimitHeaders(limit, remaining, resetAt) {
  const resetSeconds = typeof resetAt === 'number' ? Math.ceil(resetAt / 1000) : resetAt;
  return {
    // IETF standard headers
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': String(resetSeconds),
    // Legacy X-RateLimit-* headers for backward compatibility
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetSeconds),
  };
}

/**
 * Seconds until `resetTime`, at least 1.
 *
 * @param {number|string|Date} resetTime
 * @returns {string}
 */
function calculateRetryAfter(resetTime) {
  if (!resetTime) return '1';
  const ms = new Date(resetTime) - Date.now();
  return String(Math.max(1, Math.ceil(ms / 1000)));
}

module.exports = { buildRateLimitHeaders, calculateRetryAfter };
