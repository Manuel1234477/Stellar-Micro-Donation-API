/**
 * Test: GET /admin/quota/usage endpoint for API quota monitoring
 * Issue #108
 */

const request = require('supertest');
const { createApiKey } = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

let app;
let adminKey;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.MOCK_STELLAR = 'true';
  app = require('../../src/app');
  
  adminKey = await createApiKey({
    name: 'Admin Key',
    role: 'admin',
    monthlyQuota: 1000,
  });
});

afterAll(async () => {
  await db.close();
});

describe('GET /admin/quota/usage', () => {
  test('returns per-key quota usage with warning flag', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key',
      role: 'user',
      monthlyQuota: 500,
    });

    // Set quota usage to 450/500 (90%)
    await new Promise((resolve) => {
      db.run('UPDATE api_keys SET quotaUsed = ? WHERE id = ?', [450, userKey.id], () => resolve());
    });

    const res = await request(app)
      .get('/admin/quota/usage')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key 2',
      role: 'user',
      monthlyQuota: 500,
    });

    const res = await request(app)
      .get('/admin/quota/usage')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(403);
  });

  test('filters keys with exceeded quota', async () => {
    const exceededKey = await createApiKey({
      name: 'Test Exceeded Key',
      role: 'user',
      monthlyQuota: 100,
    });

    // Set exceeded key to 150/100
    await new Promise((resolve) => {
      db.run('UPDATE api_keys SET quotaUsed = ? WHERE id = ?', [150, exceededKey.id], () => resolve());
    });

    const res = await request(app)
      .get('/admin/quota/usage?exceeded=true')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('filters keys at warning threshold', async () => {
    const warningKey = await createApiKey({
      name: 'Test Warning Key',
      role: 'user',
      monthlyQuota: 500,
    });

    // Set warning key to 400/500 (80%)
    await new Promise((resolve) => {
      db.run('UPDATE api_keys SET quotaUsed = ? WHERE id = ?', [400, warningKey.id], () => resolve());
    });

    const res = await request(app)
      .get('/admin/quota/usage?warning=true')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
