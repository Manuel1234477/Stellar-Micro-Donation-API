const { buildRateLimitHeaders } = require('../src/middleware/rateLimitHeaders');

describe('buildRateLimitHeaders', () => {
  test('should return all three required headers', () => {
    const limit = 100;
    const remaining = 50;
    const resetTime = 1705315800;

    const headers = buildRateLimitHeaders(limit, remaining, resetTime);

    expect(headers).toHaveProperty('X-RateLimit-Limit');
    expect(headers).toHaveProperty('X-RateLimit-Remaining');
    expect(headers).toHaveProperty('X-RateLimit-Reset');
  });

  test('should convert values to strings', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);

    expect(typeof headers['X-RateLimit-Limit']).toBe('string');
    expect(typeof headers['X-RateLimit-Remaining']).toBe('string');
    expect(typeof headers['X-RateLimit-Reset']).toBe('string');
  });

  test('should set correct header values', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);

    expect(headers['X-RateLimit-Limit']).toBe('100');
    expect(headers['X-RateLimit-Remaining']).toBe('50');
    expect(headers['X-RateLimit-Reset']).toBe('1705315800');
  });

  test('should handle zero remaining requests', () => {
    const headers = buildRateLimitHeaders(100, 0, 1705315800);

    expect(headers['X-RateLimit-Remaining']).toBe('0');
  });

  test('should handle different limit values', () => {
    const headers = buildRateLimitHeaders(200, 150, 1705315900);

    expect(headers['X-RateLimit-Limit']).toBe('200');
    expect(headers['X-RateLimit-Remaining']).toBe('150');
    expect(headers['X-RateLimit-Reset']).toBe('1705315900');
  });
});
