/**
 * Tests for issue #769: GET /api-keys/me/usage
 */

const request = require('supertest');
const express = require('express');

jest.mock('../../src/middleware/rbac', () => ({
  requireAdmin: () => (req, res, next) => next(),
  checkPermission: () => (req, res, next) => next(),
  attachUserRole: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { admin: 1024 },
}));
jest.mock('../../src/middleware/schemaValidation', () => ({
  validateSchema: () => (req, res, next) => next(),
}));
jest.mock('../../src/models/apiKeys', () => ({
  validateKey: jest.fn(),
  incrementQuota: jest.fn(),
  createKey: jest.fn(),
  listKeys: jest.fn(() => []),
  revokeKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { API_KEY: 'API_KEY' },
  ACTION: { API_KEY_CREATED: 'API_KEY_CREATED' },
  SEVERITY: { HIGH: 'HIGH', MEDIUM: 'MEDIUM' },
}));
jest.mock('../../src/services/TOTPService', () => ({}));
jest.mock('../../src/utils/scopeValidator', () => ({ validateScopes: jest.fn(() => ({ valid: true })) }));
jest.mock('../../src/constants', () => ({ API_KEY_STATUS: { ACTIVE: 'active', REVOKED: 'revoked' } }));

const mockUsageService = {
  getTimeSeries: jest.fn(() => []),
};
jest.mock('../../src/services/ApiKeyUsageService', () => {
  const MockClass = jest.fn();
  MockClass.instance = mockUsageService;
  return MockClass;
});

const router = require('../../src/routes/apiKeys');

function buildApp(apiKeyOverride = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.id = 'test-req-id';
    req.user = { id: 1, role: 'user' };
    req.apiKey = { id: 42, quotaLimit: 1000, quotaUsed: 150, rateLimit: 100, rateLimitWindowSeconds: 60, ...apiKeyOverride };
    next();
  });
  app.use('/api-keys', router);
  return app;
}

describe('GET /api-keys/me/usage (#769)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns usage stats for the current API key', async () => {
    mockUsageService.getTimeSeries.mockReturnValue([
      { bucket: '2026-04-25', requests: 42, errors: 2 },
    ]);

    const res = await request(buildApp()).get('/api-keys/me/usage');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.keyId).toBe(42);
    expect(res.body.data.quota.limit).toBe(1000);
    expect(res.body.data.quota.used).toBe(150);
    expect(res.body.data.quota.remaining).toBe(850);
    expect(res.body.data.rateLimit.requestsPerWindow).toBe(100);
    expect(res.body.data.rateLimit.windowSeconds).toBe(60);
  });

  it('returns 401 when no API key is present', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { req.id = 'test'; req.user = { id: 1 }; next(); });
    app.use('/api-keys', router);

    const res = await request(app).get('/api-keys/me/usage');
    expect(res.status).toBe(401);
  });

  it('returns null quota fields when quota is not configured', async () => {
    mockUsageService.getTimeSeries.mockReturnValue([]);
    const res = await request(buildApp({ quotaLimit: undefined, quotaUsed: undefined })).get('/api-keys/me/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.quota.limit).toBeNull();
    expect(res.body.data.quota.remaining).toBeNull();
  });

  it('returns zero counts when no usage is recorded', async () => {
    mockUsageService.getTimeSeries.mockReturnValue([]);
    const res = await request(buildApp()).get('/api-keys/me/usage');
    expect(res.status).toBe(200);
    expect(res.body.data.requestsToday).toBe(0);
    expect(res.body.data.requestsThisMonth).toBe(0);
  });
});
