function buildRateLimitHeaders(limit, remaining, resetTime) {
  const resetUnix = String(Math.ceil(Number(resetTime)));
  return {
    'RateLimit-Limit': String(limit),
    'RateLimit-Remaining': String(Math.max(0, remaining)),
    'RateLimit-Reset': resetUnix,
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': resetUnix,
  };
}

function calculateRetryAfter(resetTime) {
  if (!resetTime) return '1';
  const ms = new Date(resetTime) - Date.now();
  return String(Math.max(1, Math.ceil(ms / 1000)));
}

module.exports = { buildRateLimitHeaders, calculateRetryAfter };
