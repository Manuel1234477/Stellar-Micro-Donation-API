const request = require('supertest');
const app = require('../src/routes/app');
const apiKeysModel = require('../src/models/apiKeys');
const db = require('../src/utils/database');

describe('API Key Rotation', () => {
  let adminKey;
  let testKey;

  beforeAll(async () => {
    // Initialize the API keys table
    await apiKeysModel.initializeApiKeysTable();

    // Create an admin key for testing
    const adminKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test Admin Key',
      role: 'admin',
      createdBy: 'test-suite'
    });
    adminKey = adminKeyInfo.key;

    // Create a test user key
    const testKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test User Key',
      role: 'user',
      createdBy: 'test-suite'
    });
    testKey = testKeyInfo.key;
  });

  afterAll(async () => {
    // Clean up test keys
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Key Creation', () => {
    it('should create a new API key with admin authentication', async () => {
      const response = await request(app)
        .post('/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Integration Test Key',
          role: 'user',
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('key');
      expect(response.body.data).toHaveProperty('keyPrefix');
      expect(response.body.data.name).toBe('Integration Test Key');
      expect(response.body.data.role).toBe('user');
      expect(response.body.data.status).toBe('active');
    });

    it('should reject key creation without admin role', async () => {
      const response = await request(app)
        .post('/api-keys')
        .set('x-api-key', testKey)
        .send({
          name: 'Unauthorized Key',
          role: 'user'
        });

      expect(response.status).toBe(403);
    });

    it('should reject key creation with invalid role', async () => {
      const response = await request(app)
        .post('/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Invalid Role Key',
          role: 'superadmin'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Key Validation', () => {
    it('should validate active key', async () => {
      const keyInfo = await apiKeysModel.validateApiKey(testKey);
      
      expect(keyInfo).not.toBeNull();
      expect(keyInfo.role).toBe('user');
      expect(keyInfo.status).toBe('active');
    });

    it('should reject invalid key', async () => {
      const keyInfo = await apiKeysModel.validateApiKey('invalid-key-123');
      expect(keyInfo).toBeNull();
    });

    it('should reject revoked key', async () => {
      // Create and revoke a key
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'To Be Revoked',
        role: 'user',
        createdBy: 'test-suite'
      });

      await apiKeysModel.revokeApiKey(keyInfo.id);
      
      const validationResult = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validationResult).toBeNull();
    });

    it('should reject expired key', async () => {
      // Create a key that expires immediately
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Expired Key',
        role: 'user',
        expiresInDays: -1, // Already expired
        createdBy: 'test-suite'
      });

      const validationResult = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validationResult).toBeNull();
    });

    it('should warn when using deprecated key', async () => {
      // Create and deprecate a key
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'To Be Deprecated',
        role: 'user',
        createdBy: 'test-suite'
      });

      await apiKeysModel.deprecateApiKey(keyInfo.id);
      
      const validationResult = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validationResult).not.toBeNull();
      expect(validationResult.isDeprecated).toBe(true);
    });
  });

  describe('Key Listing', () => {
    it('should list all keys with admin authentication', async () => {
      const response = await request(app)
        .get('/api-keys')
        .set('x-api-key', adminKey);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should filter keys by status', async () => {
      const response = await request(app)
        .get('/api-keys?status=active')
        .set('x-api-key', adminKey);

      expect(response.status).toBe(200);
      expect(response.body.data.every(key => key.status === 'active')).toBe(true);
    });

    it('should reject listing without admin role', async () => {
      const response = await request(app)
        .get('/api-keys')
        .set('x-api-key', testKey);

      expect(response.status).toBe(403);
    });
  });

  describe('Key Deprecation', () => {
    it('should deprecate an active key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'To Deprecate',
        role: 'user',
        createdBy: 'test-suite'
      });

      const response = await request(app)
        .post(`/api-keys/${keyInfo.id}/deprecate`)
        .set('x-api-key', adminKey);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify key is deprecated
      const keys = await apiKeysModel.listApiKeys({ status: 'deprecated' });
      const deprecatedKey = keys.find(k => k.id === keyInfo.id);
      expect(deprecatedKey).toBeDefined();
      expect(deprecatedKey.status).toBe('deprecated');
    });

    it('should return warning headers when using deprecated key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Deprecated Test',
        role: 'user',
        createdBy: 'test-suite'
      });

      await apiKeysModel.deprecateApiKey(keyInfo.id);

      const response = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(response.status).toBe(200);
      expect(response.headers['x-api-key-deprecated']).toBe('true');
      expect(response.headers['warning']).toContain('deprecated');
    });
  });

  describe('Key Revocation', () => {
    it('should revoke a key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'To Revoke',
        role: 'user',
        createdBy: 'test-suite'
      });

      const response = await request(app)
        .delete(`/api-keys/${keyInfo.id}`)
        .set('x-api-key', adminKey);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify key cannot be used
      const validationResult = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validationResult).toBeNull();
    });

    it('should reject requests with revoked key', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Revoked Test',
        role: 'user',
        createdBy: 'test-suite'
      });

      await apiKeysModel.revokeApiKey(keyInfo.id);

      const response = await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      expect(response.status).toBe(401);
    });
  });

  describe('Key Cleanup', () => {
    it('should clean up old revoked keys', async () => {
      // Create and revoke a key
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Old Revoked Key',
        role: 'user',
        createdBy: 'test-suite'
      });

      await apiKeysModel.revokeApiKey(keyInfo.id);

      // Manually set revoked_at to old date
      await db.run(
        'UPDATE api_keys SET revoked_at = ? WHERE id = ?',
        [Date.now() - (100 * 24 * 60 * 60 * 1000), keyInfo.id]
      );

      const response = await request(app)
        .post('/api-keys/cleanup')
        .set('x-api-key', adminKey)
        .send({ retentionDays: 90 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.deletedCount).toBeGreaterThan(0);
    });
  });

  describe('Authentication Middleware', () => {
    it('should authenticate with valid database key', async () => {
      const response = await request(app)
        .get('/health')
        .set('x-api-key', testKey);

      expect(response.status).toBe(200);
    });

    it('should reject request without API key', async () => {
      const response = await request(app)
        .get('/api-keys');

      expect(response.status).toBe(401);
    });

    it('should update last_used_at on key usage', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Usage Tracking Test',
        role: 'user',
        createdBy: 'test-suite'
      });

      const beforeUsage = Date.now();

      await request(app)
        .get('/health')
        .set('x-api-key', keyInfo.key);

      const keys = await apiKeysModel.listApiKeys();
      const usedKey = keys.find(k => k.id === keyInfo.id);
      
      expect(usedKey.last_used_at).toBeGreaterThanOrEqual(beforeUsage);
    });
  });

  describe('Role-Based Access', () => {
    it('should attach correct role from database key', async () => {
      const adminKeyInfo = await apiKeysModel.createApiKey({
        name: 'Role Test Admin',
        role: 'admin',
        createdBy: 'test-suite'
      });

      const response = await request(app)
        .get('/api-keys')
        .set('x-api-key', adminKeyInfo.key);

      expect(response.status).toBe(200); // Admin can access
    });

    it('should enforce role permissions', async () => {
      const userKeyInfo = await apiKeysModel.createApiKey({
        name: 'Role Test User',
        role: 'user',
        createdBy: 'test-suite'
      });

      const response = await request(app)
        .get('/api-keys')
        .set('x-api-key', userKeyInfo.key);

      expect(response.status).toBe(403); // User cannot access admin endpoint
    });
  });
});
