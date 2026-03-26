/**
 * Unit tests for API key rotation logic (src/models/apiKeys.js)
 */
const apiKeysModel = require('../src/models/apiKeys');
const db = require('../src/utils/database');

describe('API Key Rotation - Unit Tests', () => {
  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
  });

  afterEach(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'rotation-unit-test'");
  });

  describe('rotateApiKey', () => {
    it('creates a new key and deprecates the old one atomically', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Original Key',
        role: 'user',
        createdBy: 'rotation-unit-test',
      });

      const result = await apiKeysModel.rotateApiKey(original.id, { gracePeriodDays: 7 });

      expect(result).not.toBeNull();
      expect(result.oldKeyId).toBe(original.id);
      expect(result.gracePeriodDays).toBe(7);
      expect(result.newKey).toHaveProperty('key');
      expect(result.newKey.role).toBe('user');
      expect(result.newKey.status).toBe('active');
      expect(result.deprecatedAt).toBeDefined();
      expect(result.autoRevokeAt).toBeDefined();

      // Old key should now be deprecated
      const oldValidation = await apiKeysModel.validateApiKey(original.key);
      expect(oldValidation).not.toBeNull();
      expect(oldValidation.isDeprecated).toBe(true);

      // New key should be active
      const newValidation = await apiKeysModel.validateApiKey(result.newKey.key);
      expect(newValidation).not.toBeNull();
      expect(newValidation.status).toBe('active');
    });

    it('returns null for a non-existent key id', async () => {
      const result = await apiKeysModel.rotateApiKey(999999);
      expect(result).toBeNull();
    });

    it('returns null for an already-revoked key', async () => {
      const key = await apiKeysModel.createApiKey({
        name: 'Revoked Key',
        role: 'user',
        createdBy: 'rotation-unit-test',
      });
      await apiKeysModel.revokeApiKey(key.id);

      const result = await apiKeysModel.rotateApiKey(key.id);
      expect(result).toBeNull();
    });

    it('uses default grace period of 30 days when not specified', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Default Grace Key',
        role: 'user',
        createdBy: 'rotation-unit-test',
      });

      const result = await apiKeysModel.rotateApiKey(original.id);
      expect(result.gracePeriodDays).toBe(30);
    });

    it('preserves the role of the original key', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Admin Key',
        role: 'admin',
        createdBy: 'rotation-unit-test',
      });

      const result = await apiKeysModel.rotateApiKey(original.id);
      expect(result.newKey.role).toBe('admin');
    });

    it('can rotate a deprecated key (re-rotation)', async () => {
      const original = await apiKeysModel.createApiKey({
        name: 'Already Deprecated',
        role: 'user',
        createdBy: 'rotation-unit-test',
      });
      await apiKeysModel.deprecateApiKey(original.id);

      // Should still be rotatable (not revoked)
      const result = await apiKeysModel.rotateApiKey(original.id);
      expect(result).not.toBeNull();
      expect(result.newKey.status).toBe('active');
    });
  });

  describe('revokeExpiredDeprecatedKeys', () => {
    it('revokes deprecated keys past their grace period', async () => {
      const key = await apiKeysModel.createApiKey({
        name: 'Expired Deprecated',
        role: 'user',
        createdBy: 'rotation-unit-test',
        gracePeriodDays: 1,
      });

      // Deprecate and backdate deprecated_at to simulate expired grace period
      await apiKeysModel.deprecateApiKey(key.id);
      const pastTime = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2 days ago
      await db.run('UPDATE api_keys SET deprecated_at = ? WHERE id = ?', [pastTime, key.id]);

      const revokedCount = await apiKeysModel.revokeExpiredDeprecatedKeys();
      expect(revokedCount).toBeGreaterThanOrEqual(1);

      // Key should now be revoked
      const validation = await apiKeysModel.validateApiKey(key.key);
      expect(validation).toBeNull();
    });

    it('does not revoke deprecated keys still within grace period', async () => {
      const key = await apiKeysModel.createApiKey({
        name: 'Active Deprecated',
        role: 'user',
        createdBy: 'rotation-unit-test',
        gracePeriodDays: 30,
      });

      await apiKeysModel.deprecateApiKey(key.id);
      // deprecated_at is just now — well within 30-day grace period

      await apiKeysModel.revokeExpiredDeprecatedKeys();

      const validation = await apiKeysModel.validateApiKey(key.key);
      expect(validation).not.toBeNull();
      expect(validation.isDeprecated).toBe(true);
    });

    it('returns 0 when no keys need revoking', async () => {
      const count = await apiKeysModel.revokeExpiredDeprecatedKeys();
      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('createApiKey with gracePeriodDays', () => {
    it('stores custom grace period', async () => {
      const key = await apiKeysModel.createApiKey({
        name: 'Custom Grace',
        role: 'user',
        createdBy: 'rotation-unit-test',
        gracePeriodDays: 14,
      });

      expect(key.gracePeriodDays).toBe(14);

      const validated = await apiKeysModel.validateApiKey(key.key);
      expect(validated.gracePeriodDays).toBe(14);
    });
  });
});
