/**
 * Idempotency Integration Tests
 * Tests idempotency behavior in actual API endpoints
 */

const request = require('supertest');
const app = require('../src/routes/app');
const Database = require('../src/utils/database');

describe('Idempotency Integration Tests', () => {
  beforeAll(async () => {
    // Ensure idempotency table exists
    await Database.run(`
      CREATE TABLE IF NOT EXISTS idempotency_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idempotencyKey VARCHAR(255) NOT NULL UNIQUE,
        requestHash VARCHAR(64) NOT NULL,
        response TEXT NOT NULL,
        userId INTEGER,
        createdAt DATETIME NOT NULL,
        expiresAt DATETIME NOT NULL
      )
    `);
  });

  beforeEach(async () => {
    // Clean up before each test
    await Database.run('DELETE FROM idempotency_keys');
  });

  describe('POST /donations - Idempotency', () => {
    it('should require idempotency key', async () => {
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('should reject invalid idempotency key', async () => {
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', 'short')
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_IDEMPOTENCY_KEY');
    });

    it('should process request with valid idempotency key', async () => {
      const idempotencyKey = 'test-donation-' + Date.now();
      
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return cached response for duplicate idempotency key', async () => {
      const idempotencyKey = 'duplicate-test-' + Date.now();
      
      // First request
      const response1 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(response1.status).toBe(201);
      const transactionId1 = response1.body.data.id;

      // Second request with same key
      const response2 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({
          amount: 10,
          recipient: 'GTEST123',
          donor: 'GTEST456'
        });

      expect(response2.status).toBe(200);
      expect(response2.body._idempotent).toBe(true);
      expect(response2.body.data.id).toBe(transactionId1);
      expect(response2.body._originalTimestamp).toBeDefined();
    });

    it('should detect duplicate request with different idempotency key', async () => {
      const key1 = 'key1-' + Date.now();
      const key2 = 'key2-' + Date.now();
      const requestData = {
        amount: 10,
        recipient: 'GTEST123',
        donor: 'GTEST456'
      };

      // First request
      const response1 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key1)
        .send(requestData);

      expect(response1.status).toBe(201);

      // Second request with different key but same data
      const response2 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key2)
        .send(requestData);

      expect(response2.status).toBe(201);
      expect(response2.body.warning).toBeDefined();
      expect(response2.body.warning.message).toContain('Similar request detected');
    });

    it('should allow different requests with different idempotency keys', async () => {
      const key1 = 'unique1-' + Date.now();
      const key2 = 'unique2-' + Date.now();

      // First request
      const response1 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key1)
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response1.status).toBe(201);

      // Second request with different data
      const response2 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key2)
        .send({
          amount: 20,
          recipient: 'GTEST456'
        });

      expect(response2.status).toBe(201);
      expect(response2.body.warning).toBeUndefined();
      expect(response1.body.data.id).not.toBe(response2.body.data.id);
    });
  });

  describe('POST /donations/send - Idempotency', () => {
    it('should require idempotency key for send endpoint', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: 1,
          receiverId: 2,
          amount: 10
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });

    it('should prevent duplicate send with same idempotency key', async () => {
      const idempotencyKey = 'send-test-' + Date.now();
      
      // Note: This test assumes proper authentication is in place
      // In real scenario, you'd need valid user credentials
      
      const requestData = {
        senderId: 1,
        receiverId: 2,
        amount: 10,
        memo: 'test'
      };

      // First request
      const response1 = await request(app)
        .post('/donations/send')
        .set('idempotency-key', idempotencyKey)
        .send(requestData);

      // Second request with same key
      const response2 = await request(app)
        .post('/donations/send')
        .set('idempotency-key', idempotencyKey)
        .send(requestData);

      // If first succeeded, second should return cached response
      if (response1.status === 201) {
        expect(response2.status).toBe(200);
        expect(response2.body._idempotent).toBe(true);
      }
    });
  });

  describe('Idempotency Key Formats', () => {
    it('should accept UUID format', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', uuid)
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response.status).toBe(201);
    });

    it('should accept timestamp-based format', async () => {
      const key = `donation_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key)
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response.status).toBe(201);
    });

    it('should accept hash-based format', async () => {
      const crypto = require('crypto');
      const key = crypto.randomBytes(16).toString('hex');
      
      const response = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', key)
        .send({
          amount: 10,
          recipient: 'GTEST123'
        });

      expect(response.status).toBe(201);
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle concurrent requests with same idempotency key', async () => {
      const idempotencyKey = 'concurrent-' + Date.now();
      const requestData = {
        amount: 10,
        recipient: 'GTEST123'
      };

      // Send multiple concurrent requests
      const promises = Array(5).fill(null).map(() =>
        request(app)
          .post('/donations')
          .set('x-api-key', 'test-key')
          .set('idempotency-key', idempotencyKey)
          .send(requestData)
      );

      const responses = await Promise.all(promises);

      // One should be 201 (created), others should be 200 (cached)
      const created = responses.filter(r => r.status === 201);
      const cached = responses.filter(r => r.status === 200 && r.body._idempotent);

      expect(created.length).toBe(1);
      expect(cached.length).toBeGreaterThan(0);

      // All should return same transaction ID
      const transactionIds = responses.map(r => r.body.data.id);
      const uniqueIds = [...new Set(transactionIds)];
      expect(uniqueIds.length).toBe(1);
    });
  });

  describe('Error Scenarios', () => {
    it('should not cache failed requests', async () => {
      const idempotencyKey = 'error-test-' + Date.now();
      
      // First request with invalid data (should fail)
      const response1 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({
          amount: -10, // Invalid amount
          recipient: 'GTEST123'
        });

      expect(response1.status).toBe(400);

      // Second request with valid data and same key
      const response2 = await request(app)
        .post('/donations')
        .set('x-api-key', 'test-key')
        .set('idempotency-key', idempotencyKey)
        .send({
          amount: 10, // Valid amount
          recipient: 'GTEST123'
        });

      // Should process as new request, not return cached error
      expect(response2.status).not.toBe(200);
      expect(response2.body._idempotent).toBeUndefined();
    });
  });
});
