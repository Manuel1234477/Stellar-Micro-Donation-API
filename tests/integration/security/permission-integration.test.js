/**
 * Permission Integration Tests
 * Tests that permission middleware is properly applied to routes
 */

const request = require('supertest');
const app = require('../../../src/routes/app');

describe('Permission Integration Tests', () => {
  describe('Donation Routes', () => {
    it('should block guest from creating donations', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Insufficient permissions');
    });

    it('should allow user to create donations', async () => {
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'user-key-123')
        .set('idempotency-key', 'test-key-' + Date.now())
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(response.status).not.toBe(403);
    });

    it('should allow guest to read donations', async () => {
      const response = await request(app)
        .get('/donations/recent');

      expect(response.status).toBe(200);
    });
  });

  describe('Wallet Routes', () => {
    it('should block guest from creating wallets', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({
          address: 'GTEST123',
          label: 'Test Wallet'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Insufficient permissions');
    });

    it('should allow user to create wallets', async () => {
      const response = await request(app)
        .post('/wallets')
        .set('x-api-key', 'user-key-123')
        .send({
          address: 'GTEST' + Date.now(),
          label: 'Test Wallet'
        });

      expect(response.status).not.toBe(403);
    });

    it('should allow user to read wallets', async () => {
      const response = await request(app)
        .get('/wallets')
        .set('x-api-key', 'user-key-123');

      expect(response.status).toBe(200);
    });
  });

  describe('Stream Routes', () => {
    it('should block guest from creating streams', async () => {
      const response = await request(app)
        .post('/stream/create')
        .send({
          donorPublicKey: 'GTEST123',
          recipientPublicKey: 'GTEST456',
          amount: 10,
          frequency: 'daily'
        });

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('Insufficient permissions');
    });

    it('should allow user to read streams', async () => {
      const response = await request(app)
        .get('/stream/schedules')
        .set('x-api-key', 'user-key-123');

      expect(response.status).toBe(200);
    });
  });

  describe('Stats Routes', () => {
    it('should allow guest to read stats', async () => {
      const response = await request(app)
        .get('/stats/summary')
        .query({
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        });

      expect(response.status).toBe(200);
    });

    it('should allow user to read stats', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .set('x-api-key', 'user-key-123')
        .query({
          startDate: '2024-01-01',
          endDate: '2024-12-31'
        });

      expect(response.status).toBe(200);
    });
  });

  describe('Admin Routes', () => {
    it('should allow admin to access all endpoints', async () => {
      const endpoints = [
        { method: 'get', path: '/donations' },
        { method: 'get', path: '/wallets' },
        { method: 'get', path: '/stream/schedules' },
        { method: 'get', path: '/stats/summary?startDate=2024-01-01&endDate=2024-12-31' }
      ];

      for (const endpoint of endpoints) {
        const response = await request(app)
          [endpoint.method](endpoint.path)
          .set('x-api-key', 'admin-key-123');

        expect(response.status).not.toBe(403);
      }
    });
  });

  describe('Role-based Access', () => {
    it('should differentiate between admin and user permissions', async () => {
      // User should be able to create donations
      const userResponse = await request(app)
        .post('/donations')
        .set('x-api-key', 'user-key-123')
        .set('idempotency-key', 'test-key-' + Date.now())
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(userResponse.status).not.toBe(403);

      // Admin should also be able to create donations
      const adminResponse = await request(app)
        .post('/donations')
        .set('x-api-key', 'admin-key-123')
        .set('idempotency-key', 'test-key-admin-' + Date.now())
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(adminResponse.status).not.toBe(403);
    });

    it('should block guest from write operations', async () => {
      const writeEndpoints = [
        { method: 'post', path: '/donations', body: { amount: 10, recipient: 'GTEST123' } },
        { method: 'post', path: '/wallets', body: { address: 'GTEST123' } },
        { method: 'post', path: '/stream/create', body: { donorPublicKey: 'GTEST123', recipientPublicKey: 'GTEST456', amount: 10, frequency: 'daily' } }
      ];

      for (const endpoint of writeEndpoints) {
        const response = await request(app)
          [endpoint.method](endpoint.path)
          .send(endpoint.body);

        expect(response.status).toBe(403);
      }
    });
  });
});
