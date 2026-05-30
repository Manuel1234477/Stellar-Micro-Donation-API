/**
 * Test: GET /admin/anomalies endpoint for anomaly detection alerts
 * Issue #110
 */

const request = require('supertest');
const { createApiKey } = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

let app;
let adminKey;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_STELLAR = 'true';
  app = require('../../src/routes/app');
  
  adminKey = await createApiKey({
    name: 'Admin Key',
    role: 'admin',
  });
});

afterAll(async () => {
  await db.close();
});

describe('GET /admin/anomalies', () => {
  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key',
      role: 'user',
    });

    const res = await request(app)
      .get('/admin/anomalies')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(403);
  });

  test('returns anomaly list for admin', async () => {
    const res = await request(app)
      .get('/admin/anomalies')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('filters by acknowledged status', async () => {
    const res = await request(app)
      .get('/admin/anomalies?acknowledged=false')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('filters by severity', async () => {
    const res = await request(app)
      .get('/admin/anomalies?severity=HIGH')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('PATCH /admin/anomalies/:id/acknowledge', () => {
  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 2',
      role: 'user',
    });

    const res = await request(app)
      .patch('/admin/anomalies/1/acknowledge')
      .set('Authorization', `Bearer ${userKey.key}`)
      .send({ notes: 'Test' });

    expect(res.status).toBe(403);
  });
});

describe('GET /admin/anomalies/config', () => {
  test('returns detection thresholds for admin', async () => {
    const res = await request(app)
      .get('/admin/anomalies/config')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
  });

  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 3',
      role: 'user',
    });

    const res = await request(app)
      .get('/admin/anomalies/config')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(403);
  });
});

describe('PATCH /admin/anomalies/config', () => {
  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 4',
      role: 'user',
    });

    const res = await request(app)
      .patch('/admin/anomalies/config')
      .set('Authorization', `Bearer ${userKey.key}`)
      .send({ largeTransactionThresholdXLM: 1000 });

    expect(res.status).toBe(403);
  });
});
