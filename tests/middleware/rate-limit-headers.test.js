'use strict';

const { buildRateLimitHeaders, calculateRetryAfter } = require('../../src/middleware/rateLimitHeaders');

// ─── buildRateLimitHeaders ─────────────────────────────────────────────────────

describe('buildRateLimitHeaders', () => {
  test('should return all three required legacy headers', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    expect(headers).toHaveProperty('X-RateLimit-Limit');
    expect(headers).toHaveProperty('X-RateLimit-Remaining');
    expect(headers).toHaveProperty('X-RateLimit-Reset');
  });

  test('should return all three IETF-standard headers', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    expect(headers).toHaveProperty('RateLimit-Limit');
    expect(headers).toHaveProperty('RateLimit-Remaining');
    expect(headers).toHaveProperty('RateLimit-Reset');
  });

  test('should return exactly 6 headers (IETF + legacy)', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    expect(Object.keys(headers)).toHaveLength(6);
  });

  test('should convert values to strings', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    for (const val of Object.values(headers)) {
      expect(typeof val).toBe('string');
    }
  });

  test('should set correct header values', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    expect(headers['X-RateLimit-Limit']).toBe('100');
    expect(headers['X-RateLimit-Remaining']).toBe('50');
    expect(headers['X-RateLimit-Reset']).toBe('1705315800');
  });

  test('IETF and legacy header values should match', () => {
    const headers = buildRateLimitHeaders(100, 50, 1705315800);
    expect(headers['RateLimit-Limit']).toBe(headers['X-RateLimit-Limit']);
    expect(headers['RateLimit-Remaining']).toBe(headers['X-RateLimit-Remaining']);
    expect(headers['RateLimit-Reset']).toBe(headers['X-RateLimit-Reset']);
  });

  test('should handle zero remaining requests', () => {
    const headers = buildRateLimitHeaders(100, 0, 1705315800);
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['RateLimit-Remaining']).toBe('0');
  });

  test('should clamp negative remaining to zero', () => {
    const headers = buildRateLimitHeaders(100, -5, 1705315800);
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['RateLimit-Remaining']).toBe('0');
  });

  test('should handle different limit values', () => {
    const headers = buildRateLimitHeaders(200, 150, 1705315900);
    expect(headers['X-RateLimit-Limit']).toBe('200');
    expect(headers['X-RateLimit-Remaining']).toBe('150');
    expect(headers['X-RateLimit-Reset']).toBe('1705315900');
  });

  test('should accept Date object as resetTime (stores ms value)', () => {
    const resetDate = new Date(1705315800 * 1000);
    const headers = buildRateLimitHeaders(10, 5, resetDate);
    // Number(Date) returns milliseconds; the implementation stores that directly
    expect(headers['RateLimit-Reset']).toBe(String(resetDate.getTime()));
  });
});

// ─── calculateRetryAfter ──────────────────────────────────────────────────────

describe('calculateRetryAfter', () => {
  test('should return a string', () => {
    const result = calculateRetryAfter(Date.now() + 30000);
    expect(typeof result).toBe('string');
  });

  test('should return at least "1" for future times', () => {
    const future = Date.now() + 60000;
    const result = calculateRetryAfter(future);
    expect(parseInt(result, 10)).toBeGreaterThanOrEqual(1);
  });

  test('should return "1" (min) for past or current times', () => {
    const past = Date.now() - 5000;
    const result = calculateRetryAfter(past);
    expect(result).toBe('1');
  });

  test('should return "1" for undefined resetTime', () => {
    expect(calculateRetryAfter(undefined)).toBe('1');
  });

  test('should return "1" for null resetTime', () => {
    expect(calculateRetryAfter(null)).toBe('1');
  });

  test('should return positive integer string for future Date object', () => {
    const future = new Date(Date.now() + 45000);
    const result = calculateRetryAfter(future);
    const val = parseInt(result, 10);
    expect(val).toBeGreaterThanOrEqual(1);
    expect(String(val)).toBe(result);
  });

  test('should calculate approximately correct seconds', () => {
    const future = Date.now() + 30500; // ~30.5 seconds
    const result = calculateRetryAfter(future);
    const val = parseInt(result, 10);
    // Should ceil to 31
    expect(val).toBeGreaterThanOrEqual(30);
    expect(val).toBeLessThanOrEqual(32);
  });

  test('should return string representation of integer (no decimals)', () => {
    const future = Date.now() + 12345;
    const result = calculateRetryAfter(future);
    expect(result).not.toContain('.');
  });
});
