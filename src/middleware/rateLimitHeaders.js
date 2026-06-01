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

module.exports = { buildRateLimitHeaders };
