'use strict';

/**
 * Tests for issue #64: GET /admin/system-info
 */

const request = require('supertest');

function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    req.apiKey = { id: 1, role: 'admin' };
    next();
  });
  const systemInfoRouter = require('../../src/routes/admin/systemInfo');
  app.use('/admin/system-info', systemInfoRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  });
  return app;
}

describe('GET /admin/system-info (#64)', () => {
  let app;

  beforeAll(() => {
    app = buildApp();
  });

  it('returns 200 with all required top-level sections', async () => {
    const res = await request(app).get('/admin/system-info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('runtime');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('scheduler');
    expect(res.body).toHaveProperty('webhooks');
    expect(res.body).toHaveProperty('featureFlags');
    expect(res.body).toHaveProperty('configuration');
    expect(res.body).toHaveProperty('generatedAt');
  });

  it('runtime section contains expected fields', async () => {
    const res = await request(app).get('/admin/system-info');
    const { runtime } = res.body;
    expect(runtime).toHaveProperty('nodeVersion');
    expect(runtime).toHaveProperty('uptime');
    expect(runtime).toHaveProperty('memoryUsage');
    expect(runtime.memoryUsage).toHaveProperty('heapUsedMB');
    expect(runtime.memoryUsage).toHaveProperty('heapTotalMB');
    expect(runtime.memoryUsage).toHaveProperty('rssMB');
    expect(typeof runtime.nodeVersion).toBe('string');
    expect(typeof runtime.uptime).toBe('number');
  });

  it('database section contains expected fields', async () => {
    const res = await request(app).get('/admin/system-info');
    const { database } = res.body;
    expect(database).toHaveProperty('fileSizeBytes');
    expect(database).toHaveProperty('connectionPoolSize');
    expect(database).toHaveProperty('activeConnections');
    expect(database).toHaveProperty('pendingMigrations');
  });

  it('scheduler section contains expected fields', async () => {
    const res = await request(app).get('/admin/system-info');
    const { scheduler } = res.body;
    expect(scheduler).toHaveProperty('isRunning');
    expect(scheduler).toHaveProperty('lastTickAt');
    expect(scheduler).toHaveProperty('lastTickDurationMs');
    expect(scheduler).toHaveProperty('activeScheduleCount');
    expect(scheduler).toHaveProperty('nextTickAt');
  });

  it('webhooks section contains expected fields', async () => {
    const res = await request(app).get('/admin/system-info');
    const { webhooks } = res.body;
    expect(webhooks).toHaveProperty('registeredCount');
    expect(webhooks).toHaveProperty('queueDepth');
    expect(webhooks).toHaveProperty('failedDeliveries24h');
  });

  it('featureFlags is an array', async () => {
    const res = await request(app).get('/admin/system-info');
    expect(Array.isArray(res.body.featureFlags)).toBe(true);
  });

  it('configuration section contains expected fields', async () => {
    const res = await request(app).get('/admin/system-info');
    const { configuration } = res.body;
    expect(configuration).toHaveProperty('stellarNetwork');
    expect(configuration).toHaveProperty('mockMode');
    expect(configuration).toHaveProperty('rateLimitSettings');
  });

  it('does not expose sensitive values (encryption keys, API keys)', async () => {
    const res = await request(app).get('/admin/system-info');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/ENCRYPTION_KEY|API_KEYS|_SECRET|_PASSWORD/i);
  });

  it('requires admin role - returns 403 for non-admin', async () => {
    const express = require('express');
    const nonAdminApp = express();
    nonAdminApp.use(express.json());
    nonAdminApp.use((req, res, next) => {
      req.user = { id: 2, role: 'user' };
      req.apiKey = { id: 2, role: 'user' };
      next();
    });
    const systemInfoRouter = require('../../src/routes/admin/systemInfo');
    nonAdminApp.use('/admin/system-info', systemInfoRouter);
    nonAdminApp.use((err, req, res, next) => {
      void next;
      res.status(err.status || 403).json({ success: false, error: { message: err.message } });
    });

    const res = await request(nonAdminApp).get('/admin/system-info');
    expect(res.status).toBe(403);
  });
});
