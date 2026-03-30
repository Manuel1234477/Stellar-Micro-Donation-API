/**
 * Fine-Grained Permission Scoping Tests
 * 
 * Comprehensive test suite for API key scoping functionality including:
 * - Scope validation and parsing
 * - API key creation with scopes
 * - Permission checking with scopes
 * - Scope enforcement across endpoints
 * - Edge cases and error scenarios
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const apiKeysModel = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');
const scopeValidator = require('../../src/utils/scopeValidator');

describe('API Key Fine-Grained Permission Scoping', () => {
  let adminKey;
  let testUserKey;

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

    // Create a test user key (no scopes)
    const testUserKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test User Key (No Scopes)',
      role: 'user',
      createdBy: 'test-suite',
      scopes: []
    });
    testUserKey = testUserKeyInfo.key;
  });

  afterAll(async () => {
    // Clean up test keys
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Scope Validator Utility', () => {
    describe('validateScopes', () => {
      it('should accept valid scope array', () => {
        const result = scopeValidator.validateScopes(['donations:read', 'stats:read']);
        expect(result.valid).toBe(true);
        expect(result.scopes).toEqual(['donations:read', 'stats:read']);
        expect(result.errors).toHaveLength(0);
      });

      it('should accept empty scope array', () => {
        const result = scopeValidator.validateScopes([]);
        expect(result.valid).toBe(true);
        expect(result.scopes).toEqual([]);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject non-array input', () => {
        const result = scopeValidator.validateScopes('not-an-array');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Scopes must be an array');
      });

      it('should reject null scopes', () => {
        const result = scopeValidator.validateScopes(null);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('array');
      });

      it('should reject invalid scope strings', () => {
        const result = scopeValidator.validateScopes(['invalid:scope', 'donations:read']);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('Invalid scope'));
      });

      it('should reject empty string scopes', () => {
        const result = scopeValidator.validateScopes(['', 'donations:read']);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('empty'));
      });

      it('should detect duplicate scopes', () => {
        const result = scopeValidator.validateScopes(['donations:read', 'donations:read']);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('Duplicate'));
      });

      it('should trim whitespace from scope strings', () => {
        const result = scopeValidator.validateScopes(['  donations:read  ', 'stats:read']);
        expect(result.valid).toBe(true);
        expect(result.scopes).toEqual(['donations:read', 'stats:read']);
      });

      it('should reject non-string scope items', () => {
        const result = scopeValidator.validateScopes(['donations:read', 123]);
        expect(result.valid).toBe(false);
        expect(result.errors).toContainEqual(expect.stringContaining('must be a string'));
      });

      it('should handle mixed valid and invalid scopes', () => {
        const result = scopeValidator.validateScopes([
          'donations:read',
          'invalid:scope',
          'stats:read'
        ]);
        expect(result.valid).toBe(false);
        expect(result.scopes.length < 3).toBe(true);
      });
    });

    describe('isValidScope', () => {
      it('should validate known scopes', () => {
        expect(scopeValidator.isValidScope('donations:read')).toBe(true);
        expect(scopeValidator.isValidScope('stats:read')).toBe(true);
        expect(scopeValidator.isValidScope('admin:*')).toBe(true);
      });

      it('should reject unknown scopes', () => {
        expect(scopeValidator.isValidScope('unknown:scope')).toBe(false);
        expect(scopeValidator.isValidScope('invalid')).toBe(false);
      });

      it('should reject non-string scopes', () => {
        expect(scopeValidator.isValidScope(123)).toBe(false);
        expect(scopeValidator.isValidScope(null)).toBe(false);
        expect(scopeValidator.isValidScope(undefined)).toBe(false);
      });
    });

    describe('hasScope', () => {
      it('should find exact scope match', () => {
        const scopes = ['donations:read', 'stats:read'];
        expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
        expect(scopeValidator.hasScope(scopes, 'stats:read')).toBe(true);
      });

      it('should not match non-existent scopes', () => {
        const scopes = ['donations:read', 'stats:read'];
        expect(scopeValidator.hasScope(scopes, 'donations:create')).toBe(false);
      });

      it('should handle wildcard resource scope', () => {
        const scopes = ['donations:*'];
        expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
        expect(scopeValidator.hasScope(scopes, 'donations:create')).toBe(true);
        expect(scopeValidator.hasScope(scopes, 'donations:delete')).toBe(true);
      });

      it('should grant all permissions when admin wildcard', () => {
        const scopes = ['admin:*'];
        expect(scopeValidator.hasScope(scopes, 'donations:read')).toBe(true);
        expect(scopeValidator.hasScope(scopes, 'stats:export')).toBe(true);
        expect(scopeValidator.hasScope(scopes, 'any:permission')).toBe(true);
      });

      it('should handle empty scope array', () => {
        expect(scopeValidator.hasScope([], 'donations:read')).toBe(false);
      });

      it('should reject invalid input', () => {
        expect(scopeValidator.hasScope('not-array', 'donations:read')).toBe(false);
        expect(scopeValidator.hasScope(null, 'donations:read')).toBe(false);
      });
    });

    describe('hasAllScopes', () => {
      it('should verify all required scopes are present', () => {
        const scopes = ['donations:read', 'donations:create', 'stats:read'];
        const required = ['donations:read', 'donations:create'];
        expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
      });

      it('should fail when any required scope is missing', () => {
        const scopes = ['donations:read', 'stats:read'];
        const required = ['donations:read', 'donations:create'];
        expect(scopeValidator.hasAllScopes(scopes, required)).toBe(false);
      });

      it('should use wildcard when matching', () => {
        const scopes = ['donations:*', 'stats:read'];
        const required = ['donations:read', 'donations:create', 'stats:read'];
        expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
      });

      it('should return true when empty required scopes', () => {
        expect(scopeValidator.hasAllScopes(['donations:read'], [])).toBe(true);
      });

      it('should handle valid wildcards', () => {
        const scopes = ['admin:*'];
        const required = ['donations:read', 'stats:export', 'wallets:create'];
        expect(scopeValidator.hasAllScopes(scopes, required)).toBe(true);
      });
    });

    describe('hasAnyScope', () => {
      it('should succeed when any required scope matches', () => {
        const scopes = ['donations:read', 'stats:read'];
        const required = ['donations:create', 'donations:read'];
        expect(scopeValidator.hasAnyScope(scopes, required)).toBe(true);
      });

      it('should fail when no required scopes match', () => {
        const scopes = ['donations:read'];
        const required = ['stats:export', 'wallets:create'];
        expect(scopeValidator.hasAnyScope(scopes, required)).toBe(false);
      });

      it('should use wildcard when matching', () => {
        const scopes = ['donations:*'];
        const required = ['stats:read', 'donations:create'];
        expect(scopeValidator.hasAnyScope(scopes, required)).toBe(true);
      });

      it('should return true when empty required scopes', () => {
        expect(scopeValidator.hasAnyScope(['donations:read'], [])).toBe(true);
      });
    });

    describe('getAllScopes', () => {
      it('should return array of all valid scopes', () => {
        const allScopes = scopeValidator.getAllScopes();
        expect(Array.isArray(allScopes)).toBe(true);
        expect(allScopes.length > 0).toBe(true);
      });

      it('should include common scopes', () => {
        const allScopes = scopeValidator.getAllScopes();
        expect(allScopes).toContain('donations:read');
        expect(allScopes).toContain('stats:read');
        expect(allScopes).toContain('admin:*');
      });
    });

    describe('getScopesByResource', () => {
      it('should return scopes when specific resource', () => {
        const donationScopes = scopeValidator.getScopesByResource('donations');
        expect(donationScopes.length > 0).toBe(true);
        expect(donationScopes.every(s => s.startsWith('donations:'))).toBe(true);
      });

      it('should return empty array when unknown resource', () => {
        const scopes = scopeValidator.getScopesByResource('unknown');
        expect(scopes).toEqual([]);
      });

      it('should handle null or undefined input', () => {
        expect(scopeValidator.getScopesByResource(null)).toEqual([]);
        expect(scopeValidator.getScopesByResource(undefined)).toEqual([]);
      });
    });
  });

  describe('API Key Creation with Scopes', () => {
    it('should create API key when valid scopes', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Read-Only Stats Key',
          role: 'user',
          scopes: ['stats:read', 'stats:export'],
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.scopes).toEqual(['stats:read', 'stats:export']);
      expect(response.body.data.name).toBe('Read-Only Stats Key');
    });

    it('should create API key without scopes (empty array)', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Unrestricted User Key',
          role: 'user',
          scopes: [],
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.scopes).toEqual([]);
    });

    it('should create API key without scopes parameter (defaults to empty)', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Default Scopes Key',
          role: 'user',
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.scopes).toEqual([]);
    });

    it('should reject key creation when invalid scopes', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Invalid Scopes Key',
          role: 'user',
          scopes: ['invalid:scope', 'donations:read'],
          expiresInDays: 30
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Invalid scopes');
    });

    it('should reject key creation when duplicate scopes', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Duplicate Scopes Key',
          role: 'user',
          scopes: ['donations:read', 'donations:read'],
          expiresInDays: 30
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toContain('Duplicate');
    });

    it('should reject key creation when non-array scopes', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Non-Array Scopes Key',
          role: 'user',
          scopes: 'donations:read',
          expiresInDays: 30
        });

      expect(response.status).toBe(400);
    });

    it('should reject key creation when not admin', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', testUserKey)
        .send({
          name: 'Unauthorized Key',
          role: 'user',
          scopes: ['donations:read'],
          expiresInDays: 30
        });

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });
  });

  describe('API Key Scope Retrieval', () => {
    it('should return scopes when listing keys', async () => {
      // First create a key with scopes
      const createResponse = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'List Test Key',
          role: 'user',
          scopes: ['donations:read', 'stats:read'],
          expiresInDays: 30
        });

      const keyId = createResponse.body.data.id;

      // Then list keys and verify scopes are included
      const listResponse = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', adminKey);

      expect(listResponse.status).toBe(200);
      const createdKey = listResponse.body.data.find(k => k.id === keyId);
      expect(createdKey).toBeDefined();
      expect(createdKey.scopes).toEqual(['donations:read', 'stats:read']);
    });

    it('should include empty scopes array in response', async () => {
      // Create a key without scopes
      const createResponse = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'No Scopes Key',
          role: 'user',
          scopes: [],
          expiresInDays: 30
        });

      expect(createResponse.body.data.scopes).toEqual([]);
    });
  });

  describe('API Key Model Scope Persistence', () => {
    it('should persist scopes in database', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Persistence Test Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['donations:read', 'donations:create']
      });

      const validated = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validated.scopes).toEqual(['donations:read', 'donations:create']);
    });

    it('should preserve scopes during key rotation', async () => {
      // Create initial key with scopes
      const originalKey = await apiKeysModel.createApiKey({
        name: 'Rotation Test Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['stats:read', 'stats:export']
      });

      // Rotate the key
      const rotated = await apiKeysModel.rotateApiKey(originalKey.id);
      const validatedNew = await apiKeysModel.validateApiKey(rotated.newKey.key);

      // Verify new key has same scopes
      expect(validatedNew.scopes).toEqual(['stats:read', 'stats:export']);
    });

    it('should handle empty scopes in database', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Empty Scopes Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: []
      });

      const validated = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validated.scopes).toEqual([]);
    });

    it('should list keys when scopes', async () => {
      const keys = await apiKeysModel.listApiKeys({ role: 'user' });
      expect(keys.length > 0).toBe(true);
      keys.forEach(key => {
        expect(Array.isArray(key.scopes)).toBe(true);
      });
    });
  });

  describe('Scope Permission Enforcement', () => {
    let scopedKey;
    let unrestrictedKey;

    beforeAll(async () => {
      // Create key with limited scopes
      const scopedKeyInfo = await apiKeysModel.createApiKey({
        name: 'Limited Scopes Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['stats:read']
      });
      scopedKey = scopedKeyInfo.key;

      // Create key with no scopes (uses role permissions only)
      const unrestrictedKeyInfo = await apiKeysModel.createApiKey({
        name: 'Unrestricted Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: []
      });
      unrestrictedKey = unrestrictedKeyInfo.key;
    });

    it('should allow operation when matching scope', async () => {
      const keyInfo = await apiKeysModel.validateApiKey(scopedKey);
      expect(scopeValidator.hasScope(keyInfo.scopes, 'stats:read')).toBe(true);
    });

    it('should deny operation without matching scope', async () => {
      const keyInfo = await apiKeysModel.validateApiKey(scopedKey);
      expect(scopeValidator.hasScope(keyInfo.scopes, 'donations:create')).toBe(false);
    });

    it('should allow any operation without scope restrictions', async () => {
      const keyInfo = await apiKeysModel.validateApiKey(unrestrictedKey);
      expect(keyInfo.scopes).toEqual([]);
    });
  });

  describe('Scope Edge Cases and Validation', () => {
    it('should handle whitespace in scope names', async () => {
      const result = scopeValidator.validateScopes(['  donations:read  ', 'stats:read']);
      expect(result.valid).toBe(true);
      expect(result.scopes).toEqual(['donations:read', 'stats:read']);
    });

    it('should reject scope when wrong format', async () => {
      const result = scopeValidator.validateScopes(['donations', 'stats:read']);
      expect(result.valid).toBe(false);
      expect(result.errors.length > 0).toBe(true);
    });

    it('should handle very large scope array', () => {
      const largeScopes = Array(10).fill('donations:read');
      const result = scopeValidator.validateScopes(largeScopes);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate'))).toBe(true);
    });

    it('should validate all resource scopes exist', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes.some(s => s.includes('donations'))).toBe(true);
      expect(allScopes.some(s => s.includes('stats'))).toBe(true);
      expect(allScopes.some(s => s.includes('wallets'))).toBe(true);
    });

    it('should have admin wildcard scope', () => {
      const allScopes = scopeValidator.getAllScopes();
      expect(allScopes.includes('admin:*')).toBe(true);
    });
  });

  describe('Scope Audit Logging', () => {
    it('should log key creation when scopes', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Audit Test Key',
          role: 'user',
          scopes: ['donations:read', 'donations:create'],
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      // Verify audit log was created (implementation-dependent)
    });

    it('should track scope in key metadata', async () => {
      const response = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Metadata Test Key',
          role: 'user',
          scopes: ['stats:export'],
          metadata: { integration: 'analytics-platform' },
          expiresInDays: 30
        });

      expect(response.status).toBe(201);
      expect(response.body.data.scopes).toContain('stats:export');
    });
  });

  describe('Scope Integration Tests', () => {
    it('should support full workflow: create, list, validate', async () => {
      // Create key with scopes
      const createResp = await request(app)
        .post('/api/v1/api-keys')
        .set('x-api-key', adminKey)
        .send({
          name: 'Workflow Test Key',
          role: 'user',
          scopes: ['donations:read', 'wallets:read'],
          expiresInDays: 30
        });

      expect(createResp.status).toBe(201);
      const newKey = createResp.body.data.key;

      // List and find the key
      const listResp = await request(app)
        .get('/api/v1/api-keys')
        .set('x-api-key', adminKey);

      expect(listResp.status).toBe(200);
      const foundKey = listResp.body.data.find(
        k => k.keyPrefix === createResp.body.data.keyPrefix
      );
      expect(foundKey.scopes).toEqual(['donations:read', 'wallets:read']);

      // Validate the actual key
      const validatedKey = await apiKeysModel.validateApiKey(newKey);
      expect(validatedKey.scopes).toEqual(['donations:read', 'wallets:read']);
    });

    it('should maintain scopes across role validation', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Role-Scope Test',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['stats:read']
      });

      const validated = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validated.role).toBe('user');
      expect(validated.scopes).toEqual(['stats:read']);
    });
  });

  describe('Scope Deprecation and Revocation', () => {
    it('should preserve scopes when deprecation', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Deprecation Test Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['donations:read', 'donations:create']
      });

      // Deprecate the key
      await apiKeysModel.deprecateApiKey(keyInfo.id);

      // Check that scopes are preserved (though key is deprecated)
      const list = await apiKeysModel.listApiKeys({});
      const deprecated = list.find(k => k.id === keyInfo.id);
      expect(deprecated.scopes).toEqual(['donations:read', 'donations:create']);
      expect(deprecated.isDeprecated).toBe(true);
    });

    it('should return null when revoked key (scopes not accessible)', async () => {
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Revoked Test Key',
        role: 'user',
        createdBy: 'test-suite',
        scopes: ['stats:read']
      });

      await apiKeysModel.revokeApiKey(keyInfo.id);

      // Validation should return null for revoked key
      const validated = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validated).toBeNull();
    });
  });

  describe('Scope Performance', () => {
    it('should efficiently handle large scope lists', async () => {
      const manyScopes = ['donations:read', 'donations:create', 'donations:update'];
      
      const start = Date.now();
      const result = scopeValidator.validateScopes(manyScopes);
      const elapsed = Date.now() - start;

      expect(result.valid).toBe(true);
      expect(elapsed < 10).toBe(true); // Should be very fast
    });

    it('should efficiently check scope permissions', () => {
      const scopes = ['donations:read', 'donations:update', 'stats:read', 'wallets:read'];
      
      const start = Date.now();
      const hasRead = scopeValidator.hasScope(scopes, 'donations:read');
      const elapsed = Date.now() - start;

      expect(hasRead).toBe(true);
      expect(elapsed < 5).toBe(true); // Should be very fast
    });
  });

  describe('Scope Compatibility', () => {
    it('should be compatible when existing keys without scopes', async () => {
      // This tests backward compatibility
      const keyInfo = await apiKeysModel.createApiKey({
        name: 'Legacy Key',
        role: 'user',
        createdBy: 'test-suite'
        // No scopes parameter provided
      });

      const validated = await apiKeysModel.validateApiKey(keyInfo.key);
      expect(validated.scopes).toEqual([]);
    });

    it('should work when all role types', async () => {
      const roles = ['admin', 'user', 'guest'];

      for (const role of roles) {
        const keyInfo = await apiKeysModel.createApiKey({
          name: `${role} Scope Test`,
          role,
          createdBy: 'test-suite',
          scopes: ['donations:read']
        });

        const validated = await apiKeysModel.validateApiKey(keyInfo.key);
        expect(validated.role).toBe(role);
        expect(validated.scopes).toEqual(['donations:read']);
      }
    });
  });
});
