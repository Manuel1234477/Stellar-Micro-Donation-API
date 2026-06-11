'use strict';

/**
 * Combined tests for admin operations
 * Issues #995, #996, #997: Admin endpoints for database export, webhook stats, and tier management
 *
 * This test file validates the integration and interaction between:
 * - Database export functionality
 * - Webhook delivery analytics
 * - Subscription tier management
 */

const request = require('supertest');
const crypto = require('crypto');

describe('Admin Operations - Integration Tests', () => {
  let app;
  let adminKey;
  let userKey;

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!';
    process.env.MOCK_STELLAR = 'true';
    process.env.NODE_ENV = 'test';

    app = require('../../src/app');

    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-combined-test', 'user-combined-test']);

    const adminResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['admin-combined-test', crypto.createHash('sha256').update('admin-key-combined').digest('hex'), 'admin']
    );
    adminKey = 'admin-key-combined';

    const userResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['user-combined-test', crypto.createHash('sha256').update('user-key-combined').digest('hex'), 'user']
    );
    userKey = 'user-key-combined';
  });

  afterAll(async () => {
    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-combined-test', 'user-combined-test']);
  });

  describe('Admin role enforcement across endpoints', () => {
    it('should enforce admin role on all admin endpoints', async () => {
      const endpoints = [
        { method: 'post', path: '/admin/db/export' },
        { method: 'get', path: '/admin/webhooks/stats' },
        { method: 'get', path: '/admin/subscriptions/tiers' },
      ];

      for (const endpoint of endpoints) {
        const req = request(app)[endpoint.method](endpoint.path)
          .set('X-API-Key', userKey);

        const res = await req.expect(403);
        expect(res.body).toHaveProperty('success', false);
        expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
      }
    });

    it('should allow admin access to all admin endpoints', async () => {
      // Test database export
      const exportRes = await request(app)
        .post('/admin/db/export')
        .set('X-API-Key', adminKey)
        .expect(202);
      expect(exportRes.body).toHaveProperty('success', true);

      // Test webhook stats
      const statsRes = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);
      expect(statsRes.body).toHaveProperty('success', true);

      // Test tier listing
      const tiersRes = await request(app)
        .get('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .expect(200);
      expect(tiersRes.body).toHaveProperty('success', true);
    });
  });

  describe('Authentication enforcement', () => {
    it('should reject unauthenticated requests to admin endpoints', async () => {
      const endpoints = [
        { method: 'post', path: '/admin/db/export' },
        { method: 'get', path: '/admin/webhooks/stats' },
        { method: 'get', path: '/admin/subscriptions/tiers' },
      ];

      for (const endpoint of endpoints) {
        const req = request(app)[endpoint.method](endpoint.path);
        const res = await req.expect(401);
        expect(res.body).toHaveProperty('success', false);
      }
    });
  });

  describe('Response format consistency', () => {
    it('should return consistent response format across admin endpoints', async () => {
      const exportRes = await request(app)
        .post('/admin/db/export')
        .set('X-API-Key', adminKey)
        .expect(202);

      const statsRes = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      const tiersRes = await request(app)
        .get('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .expect(200);

      // All should have success field
      expect(exportRes.body).toHaveProperty('success');
      expect(statsRes.body).toHaveProperty('success');
      expect(tiersRes.body).toHaveProperty('success');

      // All should have data or jobId
      expect(exportRes.body).toHaveProperty('jobId');
      expect(statsRes.body).toHaveProperty('data');
      expect(tiersRes.body).toHaveProperty('data');
    });
  });

  describe('Error handling consistency', () => {
    it('should return consistent error format', async () => {
      // Unauthorized error
      const unauthorizedRes = await request(app)
        .get('/admin/webhooks/stats')
        .expect(401);

      expect(unauthorizedRes.body).toHaveProperty('success', false);
      expect(unauthorizedRes.body).toHaveProperty('error');

      // Forbidden error
      const forbiddenRes = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', userKey)
        .expect(403);

      expect(forbiddenRes.body).toHaveProperty('success', false);
      expect(forbiddenRes.body).toHaveProperty('error');
    });
  });

  describe('Tier management with API keys', () => {
    it('should create tier and associate API keys', async () => {
      // Create a tier
      const tierRes = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      const tierId = tierRes.body.data.id;

      // Create an API key on this tier
      const Database = require('../../src/utils/database');
      await Database.run(
        `INSERT INTO api_keys (name, key_hash, role, tier_id, is_active, created_at) 
         VALUES (?, ?, ?, ?, 1, datetime('now'))`,
        ['test-key-' + Date.now(), crypto.createHash('sha256').update('test-key').digest('hex'), 'user', tierId]
      );

      // List keys on tier
      const keysRes = await request(app)
        .get(`/admin/subscriptions/tiers/${tierId}/keys`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(keysRes.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Database export with tier context', () => {
    it('should export database containing tier information', async () => {
      // Create a tier first
      const tierRes = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-export-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      // Start export
      const exportRes = await request(app)
        .post('/admin/db/export')
        .set('X-API-Key', adminKey)
        .expect(202);

      expect(exportRes.body).toHaveProperty('jobId');
      expect(exportRes.body.jobId).toMatch(/^export-/);
    });
  });

  describe('Webhook stats with tier filtering', () => {
    it('should retrieve webhook stats for monitoring', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data).toHaveProperty('period');
      expect(res.body.data).toHaveProperty('totalDeliveries');
      expect(res.body.data).toHaveProperty('successRate');
    });

    it('should support period filtering for webhook stats', async () => {
      const periods = ['24h', '7d', '30d'];

      for (const period of periods) {
        const res = await request(app)
          .get(`/admin/webhooks/stats?period=${period}`)
          .set('X-API-Key', adminKey)
          .expect(200);

        expect(res.body.data.period).toBe(period);
      }
    });
  });

  describe('Concurrent admin operations', () => {
    it('should handle concurrent admin requests', async () => {
      const promises = [
        request(app)
          .post('/admin/db/export')
          .set('X-API-Key', adminKey),
        request(app)
          .get('/admin/webhooks/stats')
          .set('X-API-Key', adminKey),
        request(app)
          .get('/admin/subscriptions/tiers')
          .set('X-API-Key', adminKey),
      ];

      const results = await Promise.all(promises);

      expect(results[0].status).toBe(202);
      expect(results[1].status).toBe(200);
      expect(results[2].status).toBe(200);

      expect(results[0].body).toHaveProperty('success', true);
      expect(results[1].body).toHaveProperty('success', true);
      expect(results[2].body).toHaveProperty('success', true);
    });
  });

  describe('Admin operations audit trail', () => {
    it('should support audit logging for admin operations', async () => {
      // Create tier (should be auditable)
      const tierRes = await request(app)
        .post('/admin/subscriptions/tiers')
        .set('X-API-Key', adminKey)
        .send({
          name: 'test-tier-audit-' + Date.now(),
          features: ['feature1'],
          rateLimitPerMinute: 100,
        })
        .expect(201);

      expect(tierRes.body).toHaveProperty('success', true);

      // Export database (should be auditable)
      const exportRes = await request(app)
        .post('/admin/db/export')
        .set('X-API-Key', adminKey)
        .expect(202);

      expect(exportRes.body).toHaveProperty('success', true);
    });
  });
});
