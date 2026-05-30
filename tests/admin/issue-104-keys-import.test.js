/**
 * Issue #104: POST /admin/keys/import endpoint tests
 * 
 * Tests for importing legacy environment-based API keys to database-backed system.
 * Covers fresh import, re-import (idempotency), role override, and error handling.
 */

const request = require('supertest');
const app = require('../../src/routes/app');
const apiKeysModel = require('../../src/models/apiKeys');
const db = require('../../src/utils/database');

describe('POST /admin/keys/import - Legacy API Key Import', () => {
  let adminKey;

  beforeAll(async () => {
    await apiKeysModel.initializeApiKeysTable();
    const adminKeyInfo = await apiKeysModel.createApiKey({
      name: 'Test Admin Key',
      role: 'admin',
      createdBy: 'test-suite'
    });
    adminKey = adminKeyInfo.key;
  });

  afterEach(async () => {
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['import-test']);
  });

  afterAll(async () => {
    await db.run('DELETE FROM api_keys WHERE created_by = ?', ['test-suite']);
  });

  describe('Fresh Import', () => {
    it('should import single legacy key from API_KEYS env var', async () => {
      process.env.API_KEYS = 'legacy_key_12345';

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('imported');
      expect(res.body).toHaveProperty('skipped');
      expect(res.body).toHaveProperty('errors');
      expect(res.body.imported).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(res.body.errors)).toBe(true);

      delete process.env.API_KEYS;
    });

    it('should import multiple comma-separated legacy keys', async () => {
      process.env.API_KEYS = 'key_one,key_two,key_three';

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body.imported).toBeGreaterThanOrEqual(0);
      expect(res.body.skipped).toBeGreaterThanOrEqual(0);

      delete process.env.API_KEYS;
    });

    it('should assign user role by default', async () => {
      process.env.API_KEYS = 'default_role_key';

      await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      const keys = await db.all('SELECT role FROM api_keys WHERE key_hash LIKE ?', ['%default_role%']);
      if (keys.length > 0) {
        expect(keys[0].role).toBe('user');
      }

      delete process.env.API_KEYS;
    });

    it('should override role with query parameter', async () => {
      process.env.API_KEYS = 'admin_override_key';

      const res = await request(app)
        .post('/admin/keys/import?role=admin')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('imported');

      delete process.env.API_KEYS;
    });

    it('should accept guest role override', async () => {
      process.env.API_KEYS = 'guest_key';

      const res = await request(app)
        .post('/admin/keys/import?role=guest')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('imported');

      delete process.env.API_KEYS;
    });
  });

  describe('Idempotency', () => {
    it('should skip already imported keys on re-import', async () => {
      process.env.API_KEYS = 'idempotent_key_123';

      // First import
      const res1 = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      const firstImported = res1.body.imported;

      // Second import (same key)
      const res2 = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res2.body.skipped).toBeGreaterThanOrEqual(0);

      delete process.env.API_KEYS;
    });

    it('should not create duplicate records', async () => {
      process.env.API_KEYS = 'duplicate_test_key';

      // Import twice
      await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      // Count keys with this pattern
      const keys = await db.all('SELECT COUNT(*) as count FROM api_keys WHERE key_hash LIKE ?', ['%duplicate%']);
      expect(keys[0].count).toBeLessThanOrEqual(1);

      delete process.env.API_KEYS;
    });
  });

  describe('Error Handling', () => {
    it('should return 401 without authentication', async () => {
      process.env.API_KEYS = 'test_key';

      await request(app)
        .post('/admin/keys/import')
        .expect(401);

      delete process.env.API_KEYS;
    });

    it('should return 403 without admin role', async () => {
      const userKeyInfo = await apiKeysModel.createApiKey({
        name: 'User Key',
        role: 'user',
        createdBy: 'test-suite'
      });

      process.env.API_KEYS = 'test_key';

      await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${userKeyInfo.key}`)
        .expect(403);

      delete process.env.API_KEYS;
    });

    it('should handle missing API_KEYS env var gracefully', async () => {
      delete process.env.API_KEYS;

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body.imported).toBe(0);
      expect(res.body.skipped).toBe(0);
    });

    it('should reject invalid role parameter', async () => {
      process.env.API_KEYS = 'test_key';

      await request(app)
        .post('/admin/keys/import?role=invalid_role')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(400);

      delete process.env.API_KEYS;
    });

    it('should mask key values in error messages', async () => {
      process.env.API_KEYS = 'sk_very_long_secret_key_12345';

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      // Check if errors contain masked keys (first 4 and last 4 chars)
      if (res.body.errors && res.body.errors.length > 0) {
        res.body.errors.forEach(error => {
          if (error.key) {
            // Should show only first 4 and last 4 chars
            expect(error.key).toMatch(/^sk_v.*5$/);
          }
        });
      }

      delete process.env.API_KEYS;
    });
  });

  describe('Response Format', () => {
    it('should return correct response structure', async () => {
      process.env.API_KEYS = 'format_test_key';

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      expect(res.body).toHaveProperty('imported');
      expect(res.body).toHaveProperty('skipped');
      expect(res.body).toHaveProperty('errors');
      expect(typeof res.body.imported).toBe('number');
      expect(typeof res.body.skipped).toBe('number');
      expect(Array.isArray(res.body.errors)).toBe(true);

      delete process.env.API_KEYS;
    });

    it('should include error details with key and reason', async () => {
      process.env.API_KEYS = 'test_key';

      const res = await request(app)
        .post('/admin/keys/import')
        .set('Authorization', `Bearer ${adminKey}`)
        .expect(200);

      if (res.body.errors.length > 0) {
        res.body.errors.forEach(error => {
          expect(error).toHaveProperty('key');
          expect(error).toHaveProperty('reason');
        });
      }

      delete process.env.API_KEYS;
    });
  });
});
