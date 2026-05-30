'use strict';

/**
 * Tests for issue #61: POST /admin/keys/:id/extend
 */

const request = require('supertest');
const db = require('../../src/utils/database');
const apiKeysModel = require('../../src/models/apiKeys');

// Build a minimal app with the apiKeys router and admin auth injected
function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());

  // Inject admin user for all requests
  app.use((req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    req.apiKey = { id: 1, role: 'admin' };
    next();
  });

  const apiKeysRouter = require('../../src/routes/apiKeys');
  app.use('/api/v1/api-keys', apiKeysRouter);

  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  });

  return app;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('POST /api/v1/api-keys/:id/extend (#61)', () => {
  let app;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
    app = buildApp();
  });

  afterEach(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'extend-test'");
  });

  it('extends an active key by the given number of days from current expiresAt', async () => {
    const futureExpiry = Date.now() + 10 * DAY_MS;
    const key = await apiKeysModel.createApiKey({
      name: 'Extend Test Key',
      role: 'user',
      createdBy: 'extend-test',
      expiresInDays: 10,
    });

    const res = await request(app)
      .post(`/api/v1/api-keys/${key.id}/extend`)
      .send({ days: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.days).toBe(30);
    expect(res.body.data.newExpiresAt).toBeGreaterThan(res.body.data.oldExpiresAt);
    // New expiry should be ~40 days from now (10 existing + 30 extended)
    const expectedNew = res.body.data.oldExpiresAt + 30 * DAY_MS;
    expect(res.body.data.newExpiresAt).toBe(expectedNew);
  });

  it('returns 400 when days exceeds 365', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Extend Limit Key',
      role: 'user',
      createdBy: 'extend-test',
    });

    const res = await request(app)
      .post(`/api/v1/api-keys/${key.id}/extend`)
      .send({ days: 366 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EXTENSION_TOO_LONG');
  });

  it('returns 409 when extending a revoked key', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Revoked Key',
      role: 'user',
      createdBy: 'extend-test',
    });
    await apiKeysModel.revokeApiKey(key.id);

    const res = await request(app)
      .post(`/api/v1/api-keys/${key.id}/extend`)
      .send({ days: 30 });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Cannot extend a revoked key');
  });

  it('returns 404 for a non-existent key', async () => {
    const res = await request(app)
      .post('/api/v1/api-keys/999999/extend')
      .send({ days: 30 });

    expect(res.status).toBe(404);
  });

  it('records an audit log entry with API_KEY_EXTENDED action', async () => {
    const key = await apiKeysModel.createApiKey({
      name: 'Audit Log Key',
      role: 'user',
      createdBy: 'extend-test',
      expiresInDays: 5,
    });

    await request(app)
      .post(`/api/v1/api-keys/${key.id}/extend`)
      .send({ days: 10 });

    const log = await db.get(
      "SELECT * FROM audit_logs WHERE action = 'API_KEY_EXTENDED' ORDER BY id DESC LIMIT 1"
    );
    expect(log).toBeTruthy();
    const details = JSON.parse(log.details || '{}');
    expect(details.keyId).toBe(key.id);
    expect(details.days).toBe(10);
  });
});
