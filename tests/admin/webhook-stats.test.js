'use strict';

/**
 * Tests for GET /admin/webhooks/stats - Webhook delivery analytics
 * Issue #996: Add GET /admin/webhooks/stats endpoint for webhook delivery analytics
 *
 * Acceptance Criteria:
 * - GET /admin/webhooks/stats returns delivery statistics
 * - Response includes: period, totalDeliveries, successCount, failureCount, successRate
 * - Response includes: averageDeliveryMs, p95DeliveryMs, failureReasons, retryRate
 * - Supports ?period=24h|7d|30d filter (default 24h)
 * - Supports ?webhookId= to get stats for specific webhook
 * - Requires admin role
 * - Tests: stats aggregation, period filtering, per-webhook stats
 */

const request = require('supertest');
const crypto = require('crypto');

describe('GET /admin/webhooks/stats - Webhook Delivery Analytics', () => {
  let app;
  let adminKey;
  let userKey;
  let webhookId;

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENCRYPTION_KEY = 'test-encryption-key-32-bytes-long!';
    process.env.MOCK_STELLAR = 'true';
    process.env.NODE_ENV = 'test';

    app = require('../../src/app');

    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-webhook-stats', 'user-webhook-stats']);

    const adminResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['admin-webhook-stats', crypto.createHash('sha256').update('admin-key-webhook').digest('hex'), 'admin']
    );
    adminKey = 'admin-key-webhook';

    const userResult = await Database.run(
      `INSERT INTO api_keys (name, key_hash, role, is_active, created_at) 
       VALUES (?, ?, ?, 1, datetime('now'))`,
      ['user-webhook-stats', crypto.createHash('sha256').update('user-key-webhook').digest('hex'), 'user']
    );
    userKey = 'user-key-webhook';

    // Create test webhook
    const webhookResult = await Database.run(
      `INSERT INTO webhooks (url, events, is_active, created_at) 
       VALUES (?, ?, 1, datetime('now'))`,
      ['https://example.com/webhook', JSON.stringify(['donation.created', 'donation.verified'])]
    );
    webhookId = webhookResult.lastID;

    // Insert sample delivery history
    const now = Date.now();
    const deliveries = [
      { status: 'success', ms: 150, code: 200 },
      { status: 'success', ms: 200, code: 200 },
      { status: 'success', ms: 180, code: 200 },
      { status: 'failed', ms: 5000, code: 500 },
      { status: 'failed', ms: 4500, code: 500 },
      { status: 'success', ms: 160, code: 200 },
      { status: 'failed', ms: 3000, code: 'timeout' },
    ];

    for (let i = 0; i < deliveries.length; i++) {
      const d = deliveries[i];
      await Database.run(
        `INSERT INTO webhook_delivery_history 
         (webhook_id, event, status, status_code, delivery_time_ms, attempt, delivered_at) 
         VALUES (?, ?, ?, ?, ?, 1, datetime('now', '-${i} hours'))`,
        [webhookId, 'donation.created', d.status, d.code, d.ms]
      );
    }
  });

  afterAll(async () => {
    const Database = require('../../src/utils/database');
    await Database.run('DELETE FROM webhook_delivery_history WHERE webhook_id = ?', [webhookId]);
    await Database.run('DELETE FROM webhooks WHERE id = ?', [webhookId]);
    await Database.run('DELETE FROM api_keys WHERE name IN (?, ?)', ['admin-webhook-stats', 'user-webhook-stats']);
  });

  describe('GET /admin/webhooks/stats', () => {
    it('should return webhook stats with default 24h period', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body).toHaveProperty('success', true);
      expect(res.body.data).toHaveProperty('period', '24h');
      expect(res.body.data).toHaveProperty('totalDeliveries');
      expect(res.body.data).toHaveProperty('successCount');
      expect(res.body.data).toHaveProperty('failureCount');
      expect(res.body.data).toHaveProperty('successRate');
      expect(res.body.data).toHaveProperty('averageDeliveryMs');
      expect(res.body.data).toHaveProperty('p95DeliveryMs');
      expect(res.body.data).toHaveProperty('failureReasons');
      expect(res.body.data).toHaveProperty('retryRate');
    });

    it('should calculate correct success rate', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      const { successCount, failureCount, successRate } = res.body.data;
      const expectedRate = successCount / (successCount + failureCount);
      expect(Math.abs(res.body.data.successRate - expectedRate)).toBeLessThan(0.01);
    });

    it('should include failure reasons breakdown', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(Array.isArray(res.body.data.failureReasons)).toBe(true);
      expect(res.body.data.failureReasons.length).toBeGreaterThan(0);

      res.body.data.failureReasons.forEach(reason => {
        expect(reason).toHaveProperty('reason');
        expect(reason).toHaveProperty('count');
        expect(typeof reason.count).toBe('number');
      });
    });

    it('should calculate average delivery time', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(typeof res.body.data.averageDeliveryMs).toBe('number');
      expect(res.body.data.averageDeliveryMs).toBeGreaterThan(0);
    });

    it('should calculate p95 delivery time', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(typeof res.body.data.p95DeliveryMs).toBe('number');
      expect(res.body.data.p95DeliveryMs).toBeGreaterThanOrEqual(res.body.data.averageDeliveryMs);
    });

    it('should calculate retry rate', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(typeof res.body.data.retryRate).toBe('number');
      expect(res.body.data.retryRate).toBeGreaterThanOrEqual(0);
      expect(res.body.data.retryRate).toBeLessThanOrEqual(1);
    });

    it('should reject non-admin users', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', userKey)
        .expect(403);

      expect(res.body).toHaveProperty('success', false);
      expect(res.body.error).toHaveProperty('code', 'FORBIDDEN');
    });

    it('should reject unauthenticated requests', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .expect(401);

      expect(res.body).toHaveProperty('success', false);
    });
  });

  describe('Period filtering', () => {
    it('should support 24h period filter', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?period=24h')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.period).toBe('24h');
    });

    it('should support 7d period filter', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?period=7d')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.period).toBe('7d');
    });

    it('should support 30d period filter', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?period=30d')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.period).toBe('30d');
    });

    it('should reject invalid period', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?period=invalid')
        .set('X-API-Key', adminKey)
        .expect(400);

      expect(res.body).toHaveProperty('success', false);
    });

    it('should return different stats for different periods', async () => {
      const res24h = await request(app)
        .get('/admin/webhooks/stats?period=24h')
        .set('X-API-Key', adminKey)
        .expect(200);

      const res7d = await request(app)
        .get('/admin/webhooks/stats?period=7d')
        .set('X-API-Key', adminKey)
        .expect(200);

      // 7d should have at least as many deliveries as 24h
      expect(res7d.data.totalDeliveries).toBeGreaterThanOrEqual(res24h.data.totalDeliveries);
    });
  });

  describe('Per-webhook filtering', () => {
    it('should filter stats by webhookId', async () => {
      const res = await request(app)
        .get(`/admin/webhooks/stats?webhookId=${webhookId}`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data).toHaveProperty('webhookId', webhookId);
      expect(res.body.data.totalDeliveries).toBeGreaterThan(0);
    });

    it('should return empty stats for non-existent webhook', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?webhookId=99999')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.totalDeliveries).toBe(0);
    });

    it('should combine period and webhookId filters', async () => {
      const res = await request(app)
        .get(`/admin/webhooks/stats?period=7d&webhookId=${webhookId}`)
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.period).toBe('7d');
      expect(res.body.data.webhookId).toBe(webhookId);
    });
  });

  describe('Stats aggregation', () => {
    it('should aggregate multiple delivery outcomes', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      const { successCount, failureCount, totalDeliveries } = res.body.data;
      expect(successCount + failureCount).toBe(totalDeliveries);
    });

    it('should handle zero deliveries gracefully', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats?webhookId=99999')
        .set('X-API-Key', adminKey)
        .expect(200);

      expect(res.body.data.totalDeliveries).toBe(0);
      expect(res.body.data.successCount).toBe(0);
      expect(res.body.data.failureCount).toBe(0);
      expect(isNaN(res.body.data.successRate) || res.body.data.successRate === 0).toBe(true);
    });

    it('should include all failure reason types', async () => {
      const res = await request(app)
        .get('/admin/webhooks/stats')
        .set('X-API-Key', adminKey)
        .expect(200);

      const failureReasons = res.body.data.failureReasons;
      const reasonStrings = failureReasons.map(r => r.reason);

      // Should include HTTP 500 and timeout reasons
      expect(reasonStrings.some(r => r.includes('500') || r.includes('HTTP'))).toBe(true);
    });
  });
});
