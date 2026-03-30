const request = require('supertest');
const express = require('express');
const ApiKeyUsageService = require('../src/services/ApiKeyUsageService');
const apiKeyUsageRoutes = require('../src/routes/apiKeyUsage');
const adminAnalyticsRoutes = require('../src/routes/admin/analytics');
const { setUsageService } = require('../src/routes/apiKeyUsage');

jest.mock('../src/config/stellar', () => ({
  getStellarService: () => ({ getContractEvents: async () => [] }),
  useMockStellar: true,
  network: 'testnet',
  port: undefined,
}));

jest.mock('../src/middleware/apiKey', () => ({
  requireApiKey: () => (req, res, next) => next(),
}));

function freshService() {
  const svc = new ApiKeyUsageService();
  setUsageService(svc);
  return svc;
}

function authHeader(id, role) {
  return `Bearer ${id}:${role}`;
}

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    const [subject, role] = token.split(':');
    req.user = {
      authMethod: 'jwt',
      subject,
      role: role || 'user',
    };
  }
  next();
});
app.use('/api-keys', apiKeyUsageRoutes);
app.use('/admin/analytics', adminAnalyticsRoutes);

describe('ApiKeyUsageService analytics', () => {
  let svc;

  beforeEach(() => {
    svc = new ApiKeyUsageService();
  });

  test('records and returns per-endpoint analytics', () => {
    const base = Date.UTC(2025, 0, 1, 0, 0, 0);
    svc.record('key1', { latencyMs: 100, statusCode: 200, path: '/health', method: 'GET', timestamp: base });
    svc.record('key1', { latencyMs: 200, statusCode: 500, path: '/health', method: 'GET', timestamp: base + 3_600_000 });
    svc.record('key1', { latencyMs: 150, statusCode: 200, path: '/donations', method: 'POST', timestamp: base + 2 * 86_400_000 });

    const analytics = svc.getAnalytics('key1', { from: base, to: base + 3 * 86_400_000 });
    expect(analytics.apiKey).toBe('key1');
    expect(analytics.endpoints).toHaveLength(2);
    expect(analytics.endpoints[0]).toMatchObject({
      path: '/health',
      method: 'GET',
      totalCalls: 2,
      errorCount: 1,
      statusCodes: { 200: 1, 500: 1 },
    });
    expect(analytics.endpoints[0].daily).toHaveLength(2);
    expect(analytics.endpoints[1]).toMatchObject({ path: '/donations', method: 'POST', totalCalls: 1 });
  });

  test('summary returns correct latency percentiles and error rate', () => {
    const base = Date.now();
    svc.record('key2', { latencyMs: 10, statusCode: 200, timestamp: base });
    svc.record('key2', { latencyMs: 20, statusCode: 400, timestamp: base + 1000 });
    svc.record('key2', { latencyMs: 100, statusCode: 500, timestamp: base + 2000 });

    const summary = svc.getAnalyticsSummary('key2', { from: base - 1000, to: base + 5000 });
    expect(summary.totalCalls).toBe(3);
    expect(summary.errorCount).toBe(2);
    expect(summary.errorRate).toBeCloseTo(66.67, 1);
    expect(summary.p50).toBe(20);
    expect(summary.p95).toBe(100);
    expect(summary.p99).toBe(100);
  });

  test('getTopEndpoints aggregates across all keys and limits results', () => {
    const base = Date.now();
    svc.record('key1', { latencyMs: 10, statusCode: 200, path: '/health', method: 'GET', timestamp: base });
    svc.record('key1', { latencyMs: 20, statusCode: 200, path: '/health', method: 'GET', timestamp: base + 1000 });
    svc.record('key2', { latencyMs: 50, statusCode: 200, path: '/donations', method: 'POST', timestamp: base + 2000 });

    const top = svc.getTopEndpoints({ from: base - 1000, to: base + 5000, limit: 10 });
    expect(top).toHaveLength(2);
    expect(top[0]).toMatchObject({ path: '/health', method: 'GET', totalCalls: 2 });
    expect(top[1]).toMatchObject({ path: '/donations', method: 'POST', totalCalls: 1 });
  });

  test('older than 30 days is purged automatically', () => {
    const now = Date.now();
    svc.record('key3', { latencyMs: 10, statusCode: 200, timestamp: now - 31 * 24 * 60 * 60 * 1000 });
    svc.record('key3', { latencyMs: 20, statusCode: 200, timestamp: now });

    const summary = svc.getSummary('key3');
    expect(summary.totalRequests).toBe(1);
    expect(summary.avgLatencyMs).toBe(20);
  });
});

describe('API endpoints for API key analytics', () => {
  let svc;

  beforeEach(() => {
    svc = freshService();
  });

  test('GET /api-keys/:id/analytics allows owner token', async () => {
    svc.record('123', { latencyMs: 120, statusCode: 200, path: '/health', method: 'GET' });
    const token = authHeader('123', 'user');

    const res = await request(app)
      .get('/api-keys/123/analytics')
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.apiKey).toBe('123');
    expect(res.body.data.endpoints.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /api-keys/:id/analytics/summary returns latency percentiles', async () => {
    svc.record('456', { latencyMs: 5, statusCode: 200, path: '/donations', method: 'POST' });
    const token = authHeader('456', 'user');

    const res = await request(app)
      .get('/api-keys/456/analytics/summary')
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('p50');
    expect(res.body.data).toHaveProperty('p95');
    expect(res.body.data).toHaveProperty('p99');
  });

  test('GET /api-keys/:id/analytics rejects non-owner users', async () => {
    svc.record('789', { latencyMs: 10, statusCode: 200, path: '/health', method: 'GET' });
    const token = authHeader('999', 'user');

    const res = await request(app)
      .get('/api-keys/789/analytics')
      .set('Authorization', token);

    expect(res.status).toBe(403);
  });

  test('GET /admin/analytics/top-endpoints requires admin role', async () => {
    svc.record('111', { latencyMs: 10, statusCode: 200, path: '/health', method: 'GET' });
    const token = authHeader('admin-user', 'admin');

    const res = await request(app)
      .get('/admin/analytics/top-endpoints')
      .set('Authorization', token);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.topEndpoints).toBeInstanceOf(Array);
  });

  test('GET /admin/analytics/top-endpoints forbids non-admin users', async () => {
    const token = authHeader('user-1', 'user');
    const res = await request(app)
      .get('/admin/analytics/top-endpoints')
      .set('Authorization', token);

    expect(res.status).toBe(403);
  });
});
