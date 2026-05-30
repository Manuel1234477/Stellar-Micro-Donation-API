'use strict';

/**
 * Tests for #802 — /network route audit + missing endpoints
 * Tests for #803 — GET /admin/system/info
 */

const request = require('supertest');
const express = require('express');
const NetworkStatusService = require('../src/services/NetworkStatusService');
const { router: networkRoutes, setService } = require('../src/routes/network');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNetworkApp(service) {
  setService(service);
  const app = express();
  app.use(express.json());
  app.use('/network', networkRoutes);
  return app;
}

function feeStatsResponse({ lastLedger = 1000, feeMode = '100', capacityUsage = '0.3' } = {}) {
  return {
    last_ledger: String(lastLedger),
    fee_charged: { mode: feeMode, p10: '100', p50: feeMode, p90: feeMode },
    min_accepted_fee: feeMode,
    ledger_capacity_usage: capacityUsage,
  };
}

function stubFetch(service, data) {
  service._fetchHorizon = jest.fn().mockResolvedValue(data);
}

// ---------------------------------------------------------------------------
// #802 — GET /network/fees
// ---------------------------------------------------------------------------

describe('#802 GET /network/fees', () => {
  let svc, app;

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeNetworkApp(svc);
  });

  afterEach(() => svc.stop());

  test('returns 200 with fee data shape', async () => {
    stubFetch(svc, feeStatsResponse({ feeMode: '100' }));
    await svc._poll();

    const res = await request(app).get('/network/fees');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('baseFeeStroops');
    expect(res.body.data).toHaveProperty('feeLevel');
    expect(res.body.data).toHaveProperty('feeSurgeMultiplier');
    expect(res.body.data).toHaveProperty('timestamp');
  });

  test('sets Cache-Control: public, max-age=30', async () => {
    const res = await request(app).get('/network/fees');
    expect(res.headers['cache-control']).toBe('public, max-age=30');
  });

  test('returns 503 when service not initialised', async () => {
    setService(null);
    const app2 = express();
    app2.use('/network', networkRoutes);
    const res = await request(app2).get('/network/fees');
    expect(res.status).toBe(503);
    setService(svc);
  });

  test('feeLevel is "surge" when fee is high', async () => {
    stubFetch(svc, feeStatsResponse({ feeMode: '600' }));
    await svc._poll();

    const res = await request(app).get('/network/fees');
    expect(res.body.data.feeLevel).toBe('surge');
  });
});

// ---------------------------------------------------------------------------
// #802 — GET /network/ledger
// ---------------------------------------------------------------------------

describe('#802 GET /network/ledger', () => {
  let svc, app;

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeNetworkApp(svc);
  });

  afterEach(() => svc.stop());

  test('returns 200 with ledger data shape', async () => {
    stubFetch(svc, feeStatsResponse({ lastLedger: 5000 }));
    await svc._poll();

    const res = await request(app).get('/network/ledger');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('connected');
    expect(res.body.data).toHaveProperty('ledgerCloseTimeSeconds');
    expect(res.body.data).toHaveProperty('latencyMs');
    expect(res.body.data).toHaveProperty('timestamp');
  });

  test('sets Cache-Control: public, max-age=30', async () => {
    const res = await request(app).get('/network/ledger');
    expect(res.headers['cache-control']).toBe('public, max-age=30');
  });

  test('returns 503 when service not initialised', async () => {
    setService(null);
    const app2 = express();
    app2.use('/network', networkRoutes);
    const res = await request(app2).get('/network/ledger');
    expect(res.status).toBe(503);
    setService(svc);
  });
});

// ---------------------------------------------------------------------------
// #802 — GET /network/metrics
// ---------------------------------------------------------------------------

describe('#802 GET /network/metrics', () => {
  let svc, app;

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeNetworkApp(svc);
  });

  afterEach(() => svc.stop());

  test('returns 200 with metrics data shape', async () => {
    stubFetch(svc, feeStatsResponse());
    await svc._poll();

    const res = await request(app).get('/network/metrics');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d).toHaveProperty('network_connected');
    expect(d).toHaveProperty('network_degraded');
    expect(d).toHaveProperty('network_latency_ms');
    expect(d).toHaveProperty('network_fee_stroops');
    expect(d).toHaveProperty('network_fee_surge_multiplier');
    expect(d).toHaveProperty('network_error_rate_percent');
    expect(d).toHaveProperty('timestamp');
  });

  test('network_connected is 1 when connected', async () => {
    stubFetch(svc, feeStatsResponse({ lastLedger: 2000, feeMode: '100' }));
    await svc._poll();

    const res = await request(app).get('/network/metrics');
    expect(res.body.data.network_connected).toBe(1);
  });

  test('network_connected is 0 when disconnected', async () => {
    svc._fetchHorizon = jest.fn().mockRejectedValue(new Error('Connection refused'));
    await svc._poll();

    const res = await request(app).get('/network/metrics');
    expect(res.body.data.network_connected).toBe(0);
  });

  test('sets Cache-Control: no-store', async () => {
    const res = await request(app).get('/network/metrics');
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('returns 503 when service not initialised', async () => {
    setService(null);
    const app2 = express();
    app2.use('/network', networkRoutes);
    const res = await request(app2).get('/network/metrics');
    expect(res.status).toBe(503);
    setService(svc);
  });
});

// ---------------------------------------------------------------------------
// #802 — 404 catch-all with hint
// ---------------------------------------------------------------------------

describe('#802 /network/* 404 catch-all', () => {
  let svc, app;

  beforeEach(() => {
    svc = new NetworkStatusService({ pollIntervalMs: 60_000 });
    app = makeNetworkApp(svc);
  });

  afterEach(() => svc.stop());

  test('unknown path returns 404 with hint', async () => {
    const res = await request(app).get('/network/unknown');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(res.body.error.hint).toMatch('/status');
  });

  test('hint lists all valid sub-paths', async () => {
    const res = await request(app).get('/network/bogus');
    const hint = res.body.error.hint;
    expect(hint).toContain('/status');
    expect(hint).toContain('/fees');
    expect(hint).toContain('/ledger');
    expect(hint).toContain('/metrics');
  });
});

// ---------------------------------------------------------------------------
// #803 — GET /admin/system/info
// ---------------------------------------------------------------------------

describe('#803 GET /admin/system/info', () => {
  const express = require('express');
  const requireApiKey = require('../src/middleware/apiKey');
  const { requireAdmin } = require('../src/middleware/rbac');
  const systemInfoRoutes = require('../src/routes/admin/systemInfo');
  const { createApiKey } = require('../src/models/apiKeys');
  const db = require('../src/utils/database');

  let adminKey;
  let userKey;
  let app;

  beforeAll(async () => {
    // Build a minimal app that mirrors how app.js mounts the route
    app = express();
    app.use(express.json());
    // requireApiKey must run before attachUserRole so req.apiKey is set
    const { attachUserRole } = require('../src/middleware/rbac');
    app.use('/admin/system/info', requireApiKey, attachUserRole(), systemInfoRoutes);
    // Error handler so async errors are returned as JSON
    app.use((err, req, res, next) => {
      res.status(err.status || err.statusCode || 500).json({ error: err.message, code: err.code });
    });

    const adminResult = await createApiKey({ name: 'SysInfo Admin', role: 'admin' });
    adminKey = adminResult.key;

    const userResult = await createApiKey({ name: 'SysInfo User', role: 'user' });
    userKey = userResult.key;
  });

  afterAll(async () => {
    await db.close();
  });

  test('returns 200 for admin key', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);
    expect(res.status).toBe(200);
  });

  test('returns 403 for non-admin key', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', userKey);
    expect(res.status).toBe(403);
  });

  test('returns 401 without API key', async () => {
    const res = await request(app).get('/admin/system/info');
    expect(res.status).toBe(401);
  });

  test('response includes all required sections', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    expect(res.body).toHaveProperty('application');
    expect(res.body).toHaveProperty('runtime');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('configuration');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('generatedAt');
  });

  test('application section has required fields', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const { application } = res.body;
    expect(application).toHaveProperty('name');
    expect(application).toHaveProperty('version');
    expect(application).toHaveProperty('environment');
    expect(application).toHaveProperty('uptime');
    expect(application).toHaveProperty('uptimeSeconds');
    expect(application).toHaveProperty('startedAt');
    expect(typeof application.uptimeSeconds).toBe('number');
    expect(application.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  test('runtime section has required fields', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const { runtime } = res.body;
    expect(runtime.nodeVersion).toMatch(/^v\d+/);
    expect(runtime.platform).toBeTruthy();
    expect(runtime.arch).toBeTruthy();
    expect(typeof runtime.pid).toBe('number');
  });

  test('memory section has required fields in MB', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const { memory } = res.body;
    expect(typeof memory.heapUsedMB).toBe('number');
    expect(typeof memory.heapTotalMB).toBe('number');
    expect(typeof memory.externalMB).toBe('number');
    expect(typeof memory.rssMB).toBe('number');
    expect(memory.heapUsedMB).toBeGreaterThan(0);
  });

  test('configuration section has required fields', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const { configuration } = res.body;
    expect(configuration).toHaveProperty('stellarNetwork');
    expect(configuration).toHaveProperty('mockStellar');
    expect(configuration).toHaveProperty('debugMode');
    expect(configuration).toHaveProperty('rateLimitingEnabled');
    expect(configuration).toHaveProperty('port');
    expect(typeof configuration.port).toBe('number');
  });

  test('database section has required fields', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const { database } = res.body;
    expect(database.type).toBe('sqlite');
    expect(['healthy', 'unhealthy']).toContain(database.status);
  });

  test('response does not contain sensitive env var values', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    const body = JSON.stringify(res.body);
    // Should not contain raw API key values or encryption key
    expect(body).not.toContain('ENCRYPTION_KEY');
    expect(body).not.toContain('API_KEYS');
    // The actual key value should not appear in the response
    if (process.env.ENCRYPTION_KEY) {
      expect(body).not.toContain(process.env.ENCRYPTION_KEY);
    }
  });

  test('uptimeSeconds increases between calls', async () => {
    const res1 = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    await new Promise(r => setTimeout(r, 50));

    const res2 = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    expect(res2.body.application.uptimeSeconds).toBeGreaterThanOrEqual(
      res1.body.application.uptimeSeconds
    );
  });

  test('generatedAt is a valid ISO timestamp', async () => {
    const res = await request(app)
      .get('/admin/system/info')
      .set('x-api-key', adminKey);

    expect(typeof res.body.generatedAt).toBe('string');
    expect(isNaN(Date.parse(res.body.generatedAt))).toBe(false);
  });
});
