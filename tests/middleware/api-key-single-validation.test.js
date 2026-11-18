/**
 * API key validation and per-key rate limiting (#1941)
 *
 * - Each request validates its x-api-key header at most once, whether the key
 *   is valid, invalid, or legacy.
 * - A DB-backed key's rate_limit applies to any authenticated route, not only
 *   the routes that remember to mount perKeyRateLimit.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/models/apiKeys', () => {
  const validateApiKey = jest.fn();
  return { validateApiKey, validateKey: validateApiKey };
});

const { validateApiKey } = require('../../src/models/apiKeys');
const attachUserRole = require('../../src/middleware/rbac').attachUserRole;
const requireApiKey = require('../../src/middleware/apiKey');
const { clearStore } = require('../../src/middleware/perKeyRateLimit');
const AuditLogService = require('../../src/services/AuditLogService');

function buildApp() {
  const app = express();
  app.use(attachUserRole());
  app.get('/api/v1/anything', requireApiKey, (req, res) => {
    res.json({ success: true, userId: req.user && req.user.id });
  });
  return app;
}

// Audit writes are fire-and-forget; stub them so none outlive the test.
beforeAll(() => {
  jest.spyOn(AuditLogService, 'log').mockResolvedValue(undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('API key validation runs once per request (#1941)', () => {
  beforeEach(() => {
    validateApiKey.mockReset();
    clearStore();
  });

  it('validates a valid DB-backed key exactly once', async () => {
    validateApiKey.mockResolvedValue({ id: 11, role: 'user', scopes: [], rateLimitPerMinute: 1000 });

    const res = await request(buildApp()).get('/api/v1/anything').set('x-api-key', 'good-key');

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('apikey-11');
    expect(validateApiKey).toHaveBeenCalledTimes(1);
  });

  it('validates an unknown key exactly once and rejects it', async () => {
    validateApiKey.mockResolvedValue(null);

    const res = await request(buildApp()).get('/api/v1/anything').set('x-api-key', 'bogus-key');

    expect(res.status).toBe(401);
    expect(validateApiKey).toHaveBeenCalledTimes(1);
  });
});

describe('DB-backed key rate limit applies to every authenticated route (#1941)', () => {
  beforeEach(() => {
    validateApiKey.mockReset();
    clearStore();
  });

  it('returns 429 on the request that exceeds the key rate_limit on a route without its own limiter', async () => {
    validateApiKey.mockResolvedValue({ id: 21, role: 'user', scopes: [], rateLimitPerMinute: 2 });
    const app = buildApp();

    const first = await request(app).get('/api/v1/anything').set('x-api-key', 'limited-key');
    const second = await request(app).get('/api/v1/anything').set('x-api-key', 'limited-key');
    const third = await request(app).get('/api/v1/anything').set('x-api-key', 'limited-key');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(third.headers['x-ratelimit-limit']).toBe('2');
  });
});
