/**
 * Integration tests for Payload Size Limit Middleware
 * Tests the middleware in the context of the full application
 */

const request = require('supertest');
const app = require('../src/routes/app');

describe('Payload Size Limit Integration Tests', () => {
  describe('Donation endpoints with payload limits', () => {
    it('should accept normal donation requests', async () => {
      const donationPayload = {
        senderId: '1',
        receiverId: '2',
        amount: '10.50',
        memo: 'Test donation'
      };

      // Note: This will fail auth, but should pass payload size check
      const response = await request(app)
        .post('/donations/send')
        .send(donationPayload)
        .set('Content-Type', 'application/json');

      // Should not be rejected for payload size (413)
      expect(response.status).not.toBe(413);
    });

    it('should reject oversized donation requests', async () => {
      // Create a payload larger than 100KB
      const oversizedPayload = {
        senderId: '1',
        receiverId: '2',
        amount: '10.50',
        memo: 'x'.repeat(110 * 1024) // 110KB memo
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(response.body.error.message).toContain('Request payload too large');
    });
  });

  describe('Wallet endpoints with payload limits', () => {
    it('should accept normal wallet creation requests', async () => {
      const walletPayload = {
        address: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        label: 'Test Wallet',
        ownerName: 'John Doe'
      };

      const response = await request(app)
        .post('/wallets')
        .send(walletPayload)
        .set('Content-Type', 'application/json');

      // Should not be rejected for payload size
      expect(response.status).not.toBe(413);
    });

    it('should reject oversized wallet requests', async () => {
      const oversizedPayload = {
        address: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        label: 'x'.repeat(110 * 1024), // 110KB label
        ownerName: 'John Doe'
      };

      const response = await request(app)
        .post('/wallets')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Health check endpoint', () => {
    it('should not be affected by payload size limits', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('Error response format', () => {
    it('should include all required error fields', async () => {
      const oversizedPayload = {
        data: 'x'.repeat(110 * 1024)
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      // Verify error structure
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('error');
      
      const error = response.body.error;
      expect(error).toHaveProperty('code', 'PAYLOAD_TOO_LARGE');
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('details');
      expect(error).toHaveProperty('requestId');
      expect(error).toHaveProperty('timestamp');

      // Verify details structure
      expect(error.details).toHaveProperty('receivedSize');
      expect(error.details).toHaveProperty('maxSize');
      expect(error.details).toHaveProperty('payloadType');
    });

    it('should include request ID from middleware chain', async () => {
      const oversizedPayload = {
        data: 'x'.repeat(110 * 1024)
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      // Request ID should be set by requestId middleware
      expect(response.body.error.requestId).toBeDefined();
      expect(typeof response.body.error.requestId).toBe('string');
      expect(response.body.error.requestId.length).toBeGreaterThan(0);
    });
  });

  describe('Middleware order verification', () => {
    it('should reject before authentication', async () => {
      // Oversized payload without API key
      const oversizedPayload = {
        data: 'x'.repeat(110 * 1024)
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      // Should get 413 (payload too large) not 401 (unauthorized)
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('should reject before rate limiting', async () => {
      // Oversized payload should be rejected before rate limit check
      const oversizedPayload = {
        data: 'x'.repeat(110 * 1024)
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      // Should get 413 not 429 (rate limit)
      expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('Content-Type handling', () => {
    it('should handle JSON content type', async () => {
      const oversizedPayload = {
        data: 'x'.repeat(110 * 1024)
      };

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedPayload)
        .set('Content-Type', 'application/json')
        .expect(413);

      expect(response.body.error.details.payloadType).toBe('JSON');
    });

    it('should handle URL-encoded content type', async () => {
      const oversizedData = 'data=' + 'x'.repeat(110 * 1024);

      const response = await request(app)
        .post('/donations/send')
        .send(oversizedData)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(413);

      expect(response.body.error.details.payloadType).toBe('URL-encoded');
    });
  });

  describe('Edge cases in production context', () => {
    it('should handle requests without Content-Length header', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({ amount: '10', senderId: '1', receiverId: '2' })
        .set('Content-Type', 'application/json');

      // Should not be rejected for missing Content-Length
      expect(response.status).not.toBe(413);
    });

    it('should handle empty POST requests', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({})
        .set('Content-Type', 'application/json');

      // Should not be rejected for empty payload
      expect(response.status).not.toBe(413);
    });

    it('should handle GET requests', async () => {
      const response = await request(app)
        .get('/health');

      expect(response.status).toBe(200);
    });
  });
});
