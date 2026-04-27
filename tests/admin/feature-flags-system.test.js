/**
 * Tests: GET /admin/feature-flags — content negotiation (HTML + JSON)
 * Issue #807
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const apiKeysModel = require('../../src/models/apiKeys');
const featureFlagsUtil = require('../../src/utils/featureFlags');
const db = require('../../src/utils/database');

let adminKey;

beforeAll(async () => {
  await apiKeysModel.initializeApiKeysTable();
  await featureFlagsUtil.initializeFeatureFlagsTable();

  const info = await apiKeysModel.createApiKey({
    name: 'ff-test-admin',
    role: 'admin',
    createdBy: 'ff-test-suite',
  });
  adminKey = info.key;

  // Seed a couple of flags
  await featureFlagsUtil.setFlag('test-flag-on', true, 'global', null, { description: 'On flag' });
  await featureFlagsUtil.setFlag('test-flag-off', false, 'global', null, { description: 'Off flag' });
});

afterAll(async () => {
  await db.run("DELETE FROM api_keys WHERE created_by = 'ff-test-suite'");
  await db.run("DELETE FROM feature_flags WHERE name LIKE 'test-flag-%'");
});

describe('GET /admin/feature-flags — JSON (default / explicit)', () => {
  test('returns JSON with success + data when Accept: application/json', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.flags)).toBe(true);
    expect(typeof res.body.data.total).toBe('number');
  });

  test('returns 401 without API key', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('Accept', 'application/json');

    expect(res.status).toBe(401);
  });
});

describe('GET /admin/feature-flags — HTML (Accept: text/html)', () => {
  test('returns HTML page with 200', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });

  test('HTML page lists seeded flags', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'text/html');

    expect(res.text).toContain('test-flag-on');
    expect(res.text).toContain('test-flag-off');
  });

  test('HTML page contains toggle inputs', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'text/html');

    expect(res.text).toContain('<input type="checkbox"');
    expect(res.text).toContain('data-name=');
  });

  test('HTML page includes PATCH fetch call in script', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'text/html');

    expect(res.text).toContain("method: 'PATCH'");
  });

  test('HTML response includes Content-Security-Policy header', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('x-api-key', adminKey)
      .set('Accept', 'text/html');

    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('returns 401 without API key', async () => {
    const res = await request(app)
      .get('/admin/feature-flags')
      .set('Accept', 'text/html');

    expect(res.status).toBe(401);
  });
});
