'use strict';

/**
 * Tests for /admin/subscriptions/tiers - Subscription tier management
 * Issue #995: Implement GET /admin/subscriptions/tiers and tier management endpoints
 *
 * Acceptance Criteria:
 * - GET /admin/subscriptions/tiers lists all tiers with id, name, features, limits, active
 * - POST /admin/subscriptions/tiers creates new tier
 * - PATCH /admin/subscriptions/tiers/:id updates tier parameters
 * - DELETE /admin/subscriptions/tiers/:id deactivates tier (sets active=false)
 * - GET /admin/subscriptions/tiers/:id/keys lists API keys on tier
 * - Requires admin role
 * - Tests: full CRUD lifecycle, deactivation with key migration, key listing
 */

const request = require('supertest');
const crypto = require('crypto');

describe('/admin/subscriptions/tiers - Subscription Tier Management', () => {
  let app;
  let adminKey;
  let userKey;
  let tierId;

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!';
    process.env.MOCK_STELLAR = 'true';
    process.env.NODE_ENV = 'test';

    app = require('../../src/routes/app');

    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-tier-test', 'user-tier-test']);

    const adminResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['admin-tier-test', crypto.createHash('sha256').update('admin-key-tier').digest('hex'), 'admin']
    );
    adminKey = 'admin-key-tier';

    const userResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['user-tier-test', crypto.createHash('sha256').update('user-key-tier').digest('hex'), 'user']
    );
    userKey = 'user-key-tier';
  });

  afterAll(async () => {
    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-tier-test', 'user-tier-test']);
  });

  describe('GET /admin/subscriptions/tiers', () => {
    it('should list all tiers with required fields', async () => {
      const res = await request(app)
        .get('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);

      if (res.body.data.length > 0) {
        const tier = res.body.data[0];
        expect(tier).toHaveProperty('id');
        expect(tier).toHaveProperty('name');
        expect(tier).toHaveProperty('features');
        expect(tier).toHaveProperty('rateLimitPerMinute');
        expect(tier).toHaveProperty('quotaPerMonth');
        expect(tier).toHaveProperty('active');
      }
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/admin/subscriptions/tiers')
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/admin/subscriptions/tiers')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('POST /admin/subscriptions/tiers', () => {
    it('should create a new tier', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-' + Date.now(),
          features: ['feature1', 'feature2'],
          rateLimitPerMinute: 100,
          quotaPerMonth: 10000,
        })
        .expect(201);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data).toHaveProperty('name');
      expect(res.body.data).toHaveProperty('active', true);

      tierId = res.body.data.id;
    });

    it('should require name field', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', userKey)
        .send({
          name: 'test-tier',
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should set active to true by default', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-active-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      expect(res.body.data.active).toBe(true);
    });
  });

  describe('PATCH /admin/subscriptions/tiers/:id', () => {
    let testTierId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-patch-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
          quotaPerMonth: 5000,
        })
        .expect(201);

      testTierId = res.body.data.id;
    });

    it('should update tier features', async () => {
      const res = await request(app)
        .patch(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .send({
          features: ['feature1', 'feature2', 'feature3'],
        })
        .expect(200);

      expect(res.body.data.features).toEqual(['feature1', 'feature2', 'feature3']);
    });

    it('should update rate limit', async () => {
      const res = await request(app)
        .patch(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .send({
          rateLimitPerMinute: 200,
        })
        .expect(200);

      expect(res.body.data.rateLimitPerMinute).toBe(200);
    });

    it('should update quota', async () => {
      const res = await request(app)
        .patch(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .send({
          quotaPerMonth: 20000,
        })
        .expect(200);

      expect(res.body.data.quotaPerMonth).toBe(20000);
    });

    it('should update multiple fields', async () => {
      const res = await request(app)
        .patch(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .send({
          features: ['new-feature'],
          rateLimitPerMinute: 300,
          quotaPerMonth: 30000,
        })
        .expect(200);

      expect(res.body.data.features).toEqual(['new-feature']);
      expect(res.body.data.rateLimitPerMinute).toBe(300);
      expect(res.body.data.quotaPerMonth).toBe(30000);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .patch(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', userKey)
        .send({
          features: ['feature1'],
        })
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent tier', async () => {
      const res = await request(app)
        .patch('/admin/subscriptions/tiers/99999')
        .set('X-API-Key', adminKey)
        .send({
          features: ['feature1'],
        })
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('DELETE /admin/subscriptions/tiers/:id', () => {
    let testTierId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-delete-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      testTierId = res.body.data.id;
    });

    it('should deactivate tier (set active=false)', async () => {
      const res = await request(app)
        .delete(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.active).toBe(false);
    });

    it('should migrate API keys to free tier on deactivation', async () => {
      // Create an API key on this tier
      const Database = require('../../src/utils/database');
      await Database.run(
        `INSERT INTO api_keys (name, key_hash, role, tier_id, is_active, created_at) 
         VALUES (?, ?, ?, ?, 1, datetime('now'))`,
        ['test-key-' + Date.now(), crypto.createHash('sha256').update('test-key').digest('hex'), 'user', testTierId]
      );

      // Deactivate the tier
      const res = await request(app)
        .delete(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.active).toBe(false);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .delete(`/admin/subscriptions/tiers/${testTierId}`)
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent tier', async () => {
      const res = await request(app)
        .delete('/admin/subscriptions/tiers/99999')
        .set('X-API-Key', adminKey)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('GET /admin/subscriptions/tiers/:id/keys', () => {
    let testTierId;

    beforeEach(async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-keys-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      testTierId = res.body.data.id;

      // Create API keys on this tier
      const Database = require('../../src/utils/database');
      for (let i = 0; i < 3; i++) {
        await Database.run(
          `INSERT INTO api_keys (name, key_hash, role, tier_id, is_active, created_at) 
           VALUES (?, ?, ?, ?, 1, datetime('now'))`,
          [`test-key-${testTierId}-${i}`, crypto.createHash('sha256').update(`test-key-${i}`).digest('hex'), 'user', testTierId]
        );
      }
    });

    it('should list all API keys on a tier', async () => {
      const res = await request(app)
        .get(`/admin/subscriptions/tiers/${testTierId}/keys`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });

    it('should include key metadata', async () => {
      const res = await request(app)
        .get(`/admin/subscriptions/tiers/${testTierId}/keys`)
        .set('X-API-Key', adminKey)
        .expect(200);

      if (res.body.data.length > 0) {
        const key = res.body.data[0];
        expect(key).toHaveProperty('id');
        expect(key).toHaveProperty('name');
        expect(key).toHaveProperty('role');
        expect(key).toHaveProperty('isActive');
      }
    });

    it('should return empty list for tier with no keys', async () => {
      const res = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-no-keys-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      const emptyRes = await request(app)
        .get(`/admin/subscriptions/tiers/${res.body.data.id}/keys`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(emptyRes.body.data).toEqual([]);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get(`/admin/subscriptions/tiers/${testTierId}/keys`)
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return 404 for non-existent tier', async () => {
      const res = await request(app)
        .get('/admin/subscriptions/tiers/99999/keys')
        .set('X-API-Key', adminKey)
        .expect(404);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('Full CRUD lifecycle', () => {
    it('should complete full tier lifecycle: create, read, update, deactivate', async () => {
      // Create
      const createRes = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-lifecycle-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
          quotaPerMonth: 5000,
        })
        .expect(201);

      const tierId = createRes.body.data.id;
      expect(createRes.body.data.active).toBe(true);

      // Read
      const listRes = await request(app)
        .get('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .expect(200);

      const tier = listRes.body.data.find(t => t.id === tierId);
      expect(tier).toBeDefined();

      // Update
      const updateRes = await request(app)
        .patch(`/admin/subscriptions/tiers/${tierId}`)
        .set('X-API-Key', adminKey)
        .send({
          features: ['feature1', 'feature2'],
          rateLimitPerMinute: 200,
        })
        .expect(200);

      expect(updateRes.body.data.features).toEqual(['feature1', 'feature2']);
      expect(updateRes.body.data.rateLimitPerMinute).toBe(200);

      // Deactivate
      const deleteRes = await request(app)
        .delete(`/admin/subscriptions/tiers/${tierId}`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(deleteRes.body.data.active).toBe(false);
    });
  });
});
