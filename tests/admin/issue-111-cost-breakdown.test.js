/**
 * Test: GET /admin/cost-breakdown endpoint
 * Issue #111
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

describe('GET /admin/cost-breakdown', () => {
  test('returns aggregated cost breakdown', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('period');
    expect(res.body.data).toHaveProperty('donationCount');
    expect(res.body.data).toHaveProperty('totalDonatedXLM');
    expect(res.body.data).toHaveProperty('stellarFees');
    expect(res.body.data).toHaveProperty('analyticsFees');
    expect(res.body.data).toHaveProperty('platformFees');
    expect(res.body.data).toHaveProperty('netDonatedXLM');
  });

  test('filters by daily period', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown?period=daily')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(res.body.data.period).toHaveProperty('type');
  });

  test('filters by weekly period', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown?period=weekly')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
  });

  test('filters by monthly period', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown?period=monthly')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
  });

  test('filters by date range', async () => {
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = new Date().toISOString().split('T')[0];

    const res = await request(app)
      .get(`/admin/cost-breakdown?startDate=${startDate}&endDate=${endDate}`)
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
  });

  test('response is cached for 5 minutes', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBeDefined();
  });

  test('requires admin role', async () => {
    const userKey = await createApiKey({
      name: 'Test User Key',
      role: 'user',
    });

    const res = await request(app)
      .get('/admin/cost-breakdown')
      .set('Authorization', `Bearer ${userKey.key}`);

    expect(res.status).toBe(403);
  });

  test('handles empty donation set', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(res.body.data.donationCount).toBe(0);
  });

  test('includes period boundaries in response', async () => {
    const res = await request(app)
      .get('/admin/cost-breakdown?period=daily')
      .set('Authorization', `Bearer ${adminKey.key}`);

    expect(res.status).toBe(200);
    expect(res.body.data.period).toHaveProperty('start');
    expect(res.body.data.period).toHaveProperty('end');
    expect(res.body.data.period).toHaveProperty('type');
  });
});
