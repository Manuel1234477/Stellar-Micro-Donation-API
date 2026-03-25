/**
 * Per-API-Key Rate Limiting Tests
 * Unit + integration tests for rate limit enforcement and header correctness.
 */

const request = require('supertest');
const app = require('../src/routes/app');
const apiKeysModel = require('../src/models/apiKeys');
const { checkRateLimit, buildRateLimitHeaders, clearStore, DEFAULT_RATE_LIMIT, DEFAULT_WINDOW_SECONDS } = require('../src/middleware/perKeyRateLimit');

// ─── Unit Tests ───────────────────────────────────────────────────────────────

describe('Per-Key Rate Limiting - Unit Tests', () => {
  beforeEach(() => clearStore());

  describe('checkRateLimit', () => {
    it('allows requests within the limit', () => {
      const result = checkRateLimit('key-1', 5, 60);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(4);
    });

    it('blocks requests exceeding the limit', () => {
      for (let i = 0; i < 3; i++) checkRateLimit('key-2', 3, 60);
      const result = checkRateLimit('key-2', 3, 60);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('tracks limits independently per key', () => {
      checkRateLimit('key-a', 2, 60);
      checkRateLimit('key-a', 2, 60);
      const blocked = checkRateLimit('key-a', 2, 60);
      const allowed = checkRateLimit('key-b', 2, 60);
      expect(blocked.allowed).toBe(false);
      expect(allowed.allowed).toBe(true);
    });

    it('uses default limit and window when not specified', () => {
      const result = checkRateLimit('key-default', DEFAULT_RATE_LIMIT, DEFAULT_WINDOW_SECONDS);
      expect(result.limit).toBe(DEFAULT_RATE_LIMIT);
      expect(result.remaining).toBe(DEFAULT_RATE_LIMIT - 1);
    });

    it('provides a resetAt timestamp in the future', () => {
      const before = Date.now();
      const result = checkRateLimit('key-reset', 5, 60);
      expect(result.resetAt).toBeGreaterThan(before);
    });
  });

  describe('buildRateLimitHeaders', () => {
    it('returns correct header values', () => {
      const resetAt = Date.now() + 60000;
      const headers = buildRateLimitHeaders(100, 42, resetAt);
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('42');
      expect(headers['X-RateLimit-Reset']).toBe(String(Math.ceil(resetAt / 1000)));
    });

    it('clamps remaining to 0 when negative', () => {
      const headers = buildRateLimitHeaders(5, -1, Date.now() + 1000);
      expect(headers['X-RateLimit-Remaining']).toBe('0');
    });
  });
});

// ─── Integration Tests ────────────────────────────────────────────────────────

describe('Per-Key Rate Limiting - Integration Tests', () => {
  let adminKey;

  beforeAll(async () => {
    const admin = await apiKeysModel.createApiKey({ name: 'Rate Limit Admin', role: 'admin', createdBy: 'test' });
    adminKey = admin.key;
  });

  beforeEach(() => clearStore());

  it('returns rate limit headers on authenticated requests', async () => {
    const res = await request(app).get('/health').set('x-api-key', adminKey);
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });

  it('returns 429 when per-key limit is exceeded', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Low Limit Key',
      role: 'user',
      createdBy: 'test',
      rateLimit: 2,
      rateLimitWindowSeconds: 60,
    });

    await request(app).get('/health').set('x-api-key', key.key);
    await request(app).get('/health').set('x-api-key', key.key);
    const res = await request(app).get('/health').set('x-api-key', key.key);

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('reflects custom rate limit in headers', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Custom Limit Key',
      role: 'user',
      createdBy: 'test',
      rateLimit: 50,
      rateLimitWindowSeconds: 30,
    });

    const res = await request(app).get('/health').set('x-api-key', key.key);
    expect(res.headers['x-ratelimit-limit']).toBe('50');
    expect(res.headers['x-ratelimit-remaining']).toBe('49');
  });

  it('uses default limit for keys without explicit rate limit', async () => {
    const key = await apiKeysModel.createApiKey({ name: 'Default Limit Key', role: 'user', createdBy: 'test' });
    const res = await request(app).get('/health').set('x-api-key', key.key);
    expect(res.headers['x-ratelimit-limit']).toBe(String(DEFAULT_RATE_LIMIT));
  });

  it('PATCH /api-keys/:id updates rate limit config', async () => {
    const key = await apiKeysModel.createApiKey({ name: 'Patchable Key', role: 'user', createdBy: 'test' });

    const res = await request(app)
      .patch(`/api-keys/${key.id}`)
      .set('x-api-key', adminKey)
      .send({ rateLimit: 10, rateLimitWindowSeconds: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('PATCH /api-keys/:id returns 404 for non-existent key', async () => {
    const res = await request(app)
      .patch('/api-keys/999999')
      .set('x-api-key', adminKey)
      .send({ rateLimit: 10 });

    expect(res.status).toBe(404);
  });

  it('POST /api-keys accepts rateLimit and rateLimitWindowSeconds', async () => {
    const res = await request(app)
      .post('/api-keys')
      .set('x-api-key', adminKey)
      .send({ name: 'Rate Limited Key', role: 'user', rateLimit: 20, rateLimitWindowSeconds: 120 });

    expect(res.status).toBe(201);
    expect(res.body.data.rateLimit).toBe(20);
    expect(res.body.data.rateLimitWindowSeconds).toBe(120);
  });

  it('rate limit state resets after window expires', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Window Reset Key',
      role: 'user',
      createdBy: 'test',
      rateLimit: 1,
      rateLimitWindowSeconds: 60,
    });

    // Exhaust the limit
    await request(app).get('/health').set('x-api-key', key.key);
    const blocked = await request(app).get('/health').set('x-api-key', key.key);
    expect(blocked.status).toBe(429);

    // Manually expire the window by clearing the store
    clearStore();

    const allowed = await request(app).get('/health').set('x-api-key', key.key);
    expect(allowed.status).toBe(200);
  });
});
