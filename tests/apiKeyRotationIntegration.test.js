/**
 * Integration tests for the full API key rotation workflow
 * Tests POST /api-keys/:id/rotate endpoint and related header behaviour
 */
const request = require('supertest');
const app = require('../src/routes/app');
const apiKeysModel = require('../src/models/apiKeys');
const db = require('../src/utils/database');

describe('API Key Rotation - Integration Tests', () => {
  let adminKey;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();

    const adminKeyInfo = await apiKeysModel.createApiKey({
      name: 'Rotation Integration Admin',
      role: 'admin',
      createdBy: 'rotation-integration-test',
    });
    adminKey = adminKeyInfo.key;
  });

  afterAll(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'rotation-integration-test'");
  });

  describe('POST /api-keys/:id/rotate', () => {
    it('returns 201 with new key and marks old key as deprecated', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Key To Rotate',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      const res = await request(app)
        .post(`/api-keys/${original.id}/rotate`)
        .set('x-api-key', adminKey)
        .send({ gracePeriodDays: 7 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.newKey).toHaveProperty('key');
      expect(res.body.data.newKey.status).toBe('active');
      expect(res.body.data.oldKeyId).toBe(original.id);
      expect(res.body.data.gracePeriodDays).toBe(7);
      expect(res.body.data.autoRevokeAt).toBeDefined();
      expect(res.body.data.deprecatedAt).toBeDefined();

      // Old key should be deprecated
      const oldKeys = await apiKeysModel.listApiKeys({ status: 'deprecated' });
      expect(oldKeys.some(k => k.id === original.id)).toBe(true);
    });

    it('uses default grace period of 30 days when not provided', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Default Grace Rotate',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      const res = await request(app)
        .post(`/api-keys/${original.id}/rotate`)
        .set('x-api-key', adminKey)
        .send({});

      expect(res.status).toBe(201);
      expect(res.body.data.gracePeriodDays).toBe(30);
    });

    it('returns 404 for non-existent key id', async () => {
      const res = await request(app)
        .post('/api-keys/999999/rotate')
        .set('x-api-key', adminKey)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('returns 404 when trying to rotate a revoked key', async () => {
      const key = await apiKeysModel.createApiKey({
        name: 'Revoked Rotate Attempt',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });
      await apiKeysModel.revokeApiKey(key.id);

      const res = await request(app)
        .post(`/api-keys/${key.id}/rotate`)
        .set('x-api-key', adminKey)
        .send({});

      expect(res.status).toBe(404);
    });

    it('requires admin role', async () => {
      const userKeyInfo = await apiKeysModel.createApiKey({
        name: 'Non-Admin Rotate Test',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      const targetKey = await apiKeysModel.createApiKey({
        name: 'Target Key',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      const res = await request(app)
        .post(`/api-keys/${targetKey.id}/rotate`)
        .set('x-api-key', userKeyInfo.key)
        .send({});

      expect(res.status).toBe(403);
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api-keys/1/rotate')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('Deprecated key response headers', () => {
    it('sets X-API-Key-Deprecated and Warning headers when using a deprecated key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Header Test Deprecated',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });
      await apiKeysModel.deprecateApiKey(keyInfo.id);

      const res = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(res.status).toBe(200);
      expect(res.headers['x-api-key-deprecated']).toBe('true');
      expect(res.headers['warning']).toMatch(/deprecated/i);
    });

    it('does not set X-API-Key-Deprecated for active keys', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Active Header Test',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      const res = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(res.status).toBe(200);
      expect(res.headers['x-api-key-deprecated']).toBeUndefined();
    });
  });

  describe('X-Rotation-Suggested header', () => {
    it('sets X-Rotation-Suggested when key age exceeds 80% of grace period', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Old Key Rotation Suggested',
        role: 'user',
        createdBy: 'rotation-integration-test',
        gracePeriodDays: 10,
      });

      // Backdate created_at to 9 days ago (90% of 10-day grace period)
      const nineDAgo = Date.now() - 9 * 24 * 60 * 60 * 1000;
      await db.run('UPDATE api_keys SET created_at = ? WHERE id = ?', [nineDAgo, keyInfo.id]);

      const res = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(res.status).toBe(200);
      expect(res.headers['x-rotation-suggested']).toBe('true');
    });

    it('does not set X-Rotation-Suggested for a fresh key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Fresh Key No Suggestion',
        role: 'user',
        createdBy: 'rotation-integration-test',
        gracePeriodDays: 30,
      });

      const res = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(res.status).toBe(200);
      expect(res.headers['x-rotation-suggested']).toBeUndefined();
    });
  });

  describe('Full rotation workflow', () => {
    it('completes the full rotate → deprecated warning → auto-revoke cycle', async () => {
      // Step 1: Create original key
      const original = await apiKeysModel.createApiKey({
        name: 'Full Workflow Key',
        role: 'user',
        createdBy: 'rotation-integration-test',
      });

      // Step 2: Rotate it
      const rotateRes = await request(app)
        .post(`/api-keys/${original.id}/rotate`)
        .set('x-api-key', adminKey)
        .send({ gracePeriodDays: 1 });

      expect(rotateRes.status).toBe(201);
      const newRawKey = rotateRes.body.data.newKey.key;

      // Step 3: Old key returns deprecation headers
      const deprecatedRes = await request(app)
        .get('/health')
        .set('x-api-key', original.key);

      expect(deprecatedRes.headers['x-api-key-deprecated']).toBe('true');

      // Step 4: New key works fine
      const newKeyRes = await request(app)
        .get('/health')
        .set('x-api-key', newRawKey);

      expect(newKeyRes.status).toBe(200);
      expect(newKeyRes.headers['x-api-key-deprecated']).toBeUndefined();

      // Step 5: Simulate grace period expiry and auto-revoke
      await db.run(
        'UPDATE api_keys SET deprecated_at = ? WHERE id = ?',
        [Date.now() - 2 * 24 * 60 * 60 * 1000, original.id]
      );
      const revokedCount = await apiKeysModel.revokeExpiredDeprecatedKeys();
      expect(revokedCount).toBeGreaterThanOrEqual(1);

      // Step 6: Old key is now fully rejected
      const revokedRes = await request(app)
        .get('/health')
        .set('x-api-key', original.key);

      expect(revokedRes.status).toBe(401);
    });
  });
});
