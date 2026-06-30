/**
 * Rate Limit Headers Integration Tests
 * Feature: emit-standard-rate-limit-headers
 *
 * PURPOSE
 * ───────
 * Verifies that the per-key rate limiter emits both IETF-standard RateLimit-*
 * headers and legacy X-RateLimit-* headers on every response, and that 429
 * responses include the Retry-After header.
 *
 * The global limiters (donationRateLimiter, etc.) skip in NODE_ENV=test via
 * their `skip` function, so we test via perKeyRateLimit which uses a keyed store.
 */

'use strict';

const express = require('express');
const request = require('supertest');

const { buildRateLimitHeaders, calculateRetryAfter } = require('../../src/middleware/rateLimitHeaders');

// ─── buildRateLimitHeaders + calculateRetryAfter integration ─────────────────

describe('Rate Limit Headers — Integration via buildRateLimitHeaders', () => {
  /**
   * Build a minimal app that manually calls buildRateLimitHeaders on each
   * response — simulating what perKeyRateLimit does.
   */
  function buildHeaderApp({ limit = 10, remaining = 7, resetAt = Date.now() + 30000, exhausted = false } = {}) {
    const app = express();
    app.use(express.json());

    app.get('/test', (req, res) => {
      res.set(buildRateLimitHeaders(limit, remaining, resetAt));

      if (exhausted) {
        res.set('Retry-After', calculateRetryAfter(resetAt));
        return res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded.' },
        });
      }

      return res.json({ success: true });
    });

    return app;
  }

  describe('Successful response headers', () => {
    it('should include IETF RateLimit-Limit header', async () => {
      const app = buildHeaderApp({ limit: 100 });
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    it('should include IETF RateLimit-Remaining header', async () => {
      const app = buildHeaderApp({ remaining: 42 });
      const res = await request(app).get('/test');
      expect(res.headers['ratelimit-remaining']).toBe('42');
    });

    it('should include IETF RateLimit-Reset header', async () => {
      const resetAt = Date.now() + 60000;
      const app = buildHeaderApp({ resetAt });
      const res = await request(app).get('/test');
      const headerVal = parseInt(res.headers['ratelimit-reset'], 10);
      expect(headerVal).toBeGreaterThan(0);
    });

    it('should include legacy X-RateLimit-Limit header', async () => {
      const app = buildHeaderApp({ limit: 50 });
      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-limit']).toBe('50');
    });

    it('should include legacy X-RateLimit-Remaining header', async () => {
      const app = buildHeaderApp({ remaining: 25 });
      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-remaining']).toBe('25');
    });

    it('should include legacy X-RateLimit-Reset header', async () => {
      const app = buildHeaderApp();
      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('IETF and legacy header values should match', async () => {
      const app = buildHeaderApp({ limit: 100, remaining: 80 });
      const res = await request(app).get('/test');
      expect(res.headers['ratelimit-limit']).toBe(res.headers['x-ratelimit-limit']);
      expect(res.headers['ratelimit-remaining']).toBe(res.headers['x-ratelimit-remaining']);
      expect(res.headers['ratelimit-reset']).toBe(res.headers['x-ratelimit-reset']);
    });

    it('should clamp negative remaining to 0', async () => {
      const app = buildHeaderApp({ remaining: -3 });
      const res = await request(app).get('/test');
      expect(res.headers['ratelimit-remaining']).toBe('0');
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
    });
  });

  describe('429 response headers', () => {
    it('should include IETF RateLimit headers on 429 response', async () => {
      const app = buildHeaderApp({ exhausted: true, remaining: 0 });
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBe('0');
      expect(res.headers['ratelimit-reset']).toBeDefined();
    });

    it('should include legacy X-RateLimit headers on 429 response', async () => {
      const app = buildHeaderApp({ exhausted: true, remaining: 0 });
      const res = await request(app).get('/test');
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBe('0');
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should include Retry-After header on 429 response', async () => {
      const resetAt = Date.now() + 30000;
      const app = buildHeaderApp({ exhausted: true, resetAt });
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      const val = parseInt(res.headers['retry-after'], 10);
      expect(val).toBeGreaterThanOrEqual(1);
    });

    it('Retry-After value should be a positive integer string', async () => {
      const app = buildHeaderApp({ exhausted: true, resetAt: Date.now() + 45000 });
      const res = await request(app).get('/test');
      const raw = res.headers['retry-after'];
      expect(/^\d+$/.test(raw)).toBe(true);
    });

    it('Retry-After should be a positive integer matching approx seconds until reset', async () => {
      const resetAt = Date.now() + 60000;
      const app = buildHeaderApp({ exhausted: true, resetAt });
      const res = await request(app).get('/test');
      const retryAfter = parseInt(res.headers['retry-after'], 10);
      // Should be roughly 60 seconds (with ±2s tolerance)
      expect(retryAfter).toBeGreaterThanOrEqual(58);
      expect(retryAfter).toBeLessThanOrEqual(62);
    });

    it('should NOT include Retry-After on 200 response', async () => {
      const app = buildHeaderApp({ exhausted: false });
      const res = await request(app).get('/test');
      expect(res.status).toBe(200);
      expect(res.headers['retry-after']).toBeUndefined();
    });
  });
});

// ─── perKeyRateLimit integration ──────────────────────────────────────────────

describe('Rate Limit Headers — perKeyRateLimit middleware', () => {
  let perKeyRateLimit;
  let clearStore;

  beforeEach(() => {
    // Fresh require each time to reset store state
    jest.resetModules();
    const mod = require('../../src/middleware/perKeyRateLimit');
    perKeyRateLimit = mod;
    clearStore = mod.clearStore;
  });

  afterEach(() => {
    if (clearStore) clearStore();
  });

  function buildKeyedApp(keyId = 'test-key-abc', limit = 10) {
    const app = express();
    app.use(express.json());

    // Simulate req.apiKey being set by auth middleware
    app.use((req, _res, next) => {
      req.apiKey = { id: keyId, isLegacy: false, rateLimitPerMinute: limit };
      next();
    });

    app.use(perKeyRateLimit);
    app.get('/test', (_req, res) => res.json({ success: true }));
    return app;
  }

  it('should include IETF RateLimit-Limit on successful response', async () => {
    const app = buildKeyedApp('k1', 20);
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBe('20');
  });

  it('should include legacy X-RateLimit-Limit on successful response', async () => {
    const app = buildKeyedApp('k2', 20);
    const res = await request(app).get('/test');
    expect(res.headers['x-ratelimit-limit']).toBe('20');
  });

  it('should include RateLimit-Remaining on successful response', async () => {
    const app = buildKeyedApp('k3', 10);
    const res = await request(app).get('/test');
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(parseInt(res.headers['ratelimit-remaining'], 10)).toBeGreaterThanOrEqual(0);
  });

  it('should decrement remaining on subsequent requests', async () => {
    const keyId = 'k-decrement';
    const app = buildKeyedApp(keyId, 10);

    const res1 = await request(app).get('/test');
    const res2 = await request(app).get('/test');

    const rem1 = parseInt(res1.headers['ratelimit-remaining'], 10);
    const rem2 = parseInt(res2.headers['ratelimit-remaining'], 10);
    expect(rem2).toBe(rem1 - 1);
  });

  it('should return 429 and Retry-After when limit exceeded', async () => {
    const keyId = 'k-exhaust';
    const app = buildKeyedApp(keyId, 2);

    // Exhaust the limit
    await request(app).get('/test');
    await request(app).get('/test');

    const res = await request(app).get('/test');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect(parseInt(res.headers['retry-after'], 10)).toBeGreaterThanOrEqual(1);
  });

  it('IETF and legacy header values should match on per-key response', async () => {
    const app = buildKeyedApp('k-match', 10);
    const res = await request(app).get('/test');
    expect(res.headers['ratelimit-limit']).toBe(res.headers['x-ratelimit-limit']);
    expect(res.headers['ratelimit-remaining']).toBe(res.headers['x-ratelimit-remaining']);
    expect(res.headers['ratelimit-reset']).toBe(res.headers['x-ratelimit-reset']);
  });
});
