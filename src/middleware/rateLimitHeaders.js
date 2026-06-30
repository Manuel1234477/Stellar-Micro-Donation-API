/**
 * Rate Limit Headers — re-export shim
 *
 * The canonical `buildRateLimitHeaders` implementation lives in
 * `perKeyRateLimit.js`, which owns the per-authenticated-key sliding-window
 * logic and sets these headers directly on each response.
 *
 * This module re-exports the function so that any future consumers can import
 * from either location without introducing a duplicate implementation.
 * See docs/RATE_LIMIT_COMPOSITION.md for the full layer description.
 */

const { buildRateLimitHeaders } = require('./perKeyRateLimit');

function calculateRetryAfter(resetTime) {
  if (!resetTime) return '1';
  const ms = new Date(resetTime) - Date.now();
  return String(Math.max(1, Math.ceil(ms / 1000)));
}

module.exports = { buildRateLimitHeaders, calculateRetryAfter };
