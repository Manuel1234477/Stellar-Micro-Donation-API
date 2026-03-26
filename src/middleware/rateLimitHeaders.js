function buildRateLimitHeaders(limit, remaining, resetTime) {
  return {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetTime),
  };
}

module.exports = { buildRateLimitHeaders };
