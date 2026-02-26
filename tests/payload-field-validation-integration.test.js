/**
 * Payload Field Validation Integration Tests
 * 
 * Integration tests for unknown field validation across all endpoints
 * Tests that unknown fields are rejected and valid requests are accepted
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring validation middleware
jest.mock('../src/events/donationEvents', () => ({
  emit: jest.fn(),
  on: jest.fn()
}));

jest.mock('../src/routes/models/transaction', () => ({
  getById: jest.fn(),
  create: jest.fn(),
  update: jest.fn()
}));

jest.mock('../src/routes/models/user', () => ({
  getById: jest.fn(),
  getByWallet: jest.fn()
}));

const { validatePayloadFields } = require('../src/middleware/validation');

// Create a test app with the validation middleware
function createTestApp() {
  const app = express();
  app.use(express.json());
  
  // Apply validation middleware globally
  app.use(validatePayloadFields);

  // Mock route handlers for testing
  app.post('/donations/send', (req, res) => {
    res.status(201).json({ success: true, message: 'Donation sent' });
  });

  app.post('/donations', (req, res) => {
    res.status(201).json({ success: true, message: 'Donation created' });
  });

  app.post('/donations/verify', (req, res) => {
    res.status(200).json({ success: true, message: 'Transaction verified' });
  });

  app.patch('/donations/:id/status', (req, res) => {
    res.status(200).json({ success: true, message: 'Status updated' });
  });

  app.post('/wallets', (req, res) => {
    res.status(201).json({ success: true, message: 'Wallet created' });
  });

  app.patch('/wallets/:id', (req, res) => {
    res.status(200).json({ success: true, message: 'Wallet updated' });
  });

  app.post('/transactions/sync', (req, res) => {
    res.status(200).json({ success: true, message: 'Transactions synced' });
  });

  app.post('/api-keys', (req, res) => {
    res.status(201).json({ success: true, message: 'API key created' });
  });

  app.post('/api-keys/cleanup', (req, res) => {
    res.status(200).json({ success: true, message: 'Cleanup completed' });
  });

  // GET endpoint (should not validate)
  app.get('/donations', (req, res) => {
    res.status(200).json({ success: true, data: [] });
  });

  return app;
}

describe('Payload Field Validation Integration', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('POST /donations/send', () => {
    it('should accept valid payload with all allowed fields', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          memo: 'test donation'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should accept valid payload with subset of allowed fields', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          hacker: 'malicious'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNKNOWN_FIELDS');
      expect(response.body.error.unknownFields).toContain('hacker');
    });

    it('should reject payload with multiple unknown fields', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          hacker: 'bad',
          evil: 'worse'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('hacker');
      expect(response.body.error.unknownFields).toContain('evil');
    });

    it('should reject payload with typo in field name', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          ammount: 100 // typo: ammount instead of amount
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('ammount');
    });
  });

  describe('POST /donations', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 100,
          donor: 'GXXX',
          recipient: 'GYYY',
          memo: 'test'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 100,
          recipient: 'GYYY',
          extraField: 'not allowed'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('extraField');
    });
  });

  describe('POST /donations/verify', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .send({
          transactionHash: 'a'.repeat(64)
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .send({
          transactionHash: 'a'.repeat(64),
          extraField: 'not allowed'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('extraField');
    });
  });

  describe('PATCH /donations/:id/status', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .patch('/donations/123/status')
        .send({
          status: 'completed',
          stellarTxId: 'abc123',
          ledger: 12345
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .patch('/donations/123/status')
        .send({
          status: 'completed',
          unknownField: 'bad'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('unknownField');
    });
  });

  describe('POST /wallets', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({
          address: 'GXXX',
          label: 'My Wallet',
          ownerName: 'John Doe'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({
          address: 'GXXX',
          label: 'My Wallet',
          hackerField: 'malicious'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('hackerField');
    });
  });

  describe('PATCH /wallets/:id', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .patch('/wallets/123')
        .send({
          label: 'Updated Label',
          ownerName: 'Jane Doe'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .patch('/wallets/123')
        .send({
          label: 'Updated Label',
          extraField: 'not allowed'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('extraField');
    });
  });

  describe('POST /transactions/sync', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/transactions/sync')
        .send({
          publicKey: 'GXXX'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/transactions/sync')
        .send({
          publicKey: 'GXXX',
          maliciousField: 'bad'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('maliciousField');
    });
  });

  describe('POST /api-keys', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/api-keys')
        .send({
          name: 'My Key',
          role: 'user',
          expiresInDays: 30,
          metadata: { purpose: 'testing' }
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/api-keys')
        .send({
          name: 'My Key',
          role: 'user',
          unknownField: 'not allowed'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('unknownField');
    });
  });

  describe('POST /api-keys/cleanup', () => {
    it('should accept valid payload', async () => {
      const response = await request(app)
        .post('/api-keys/cleanup')
        .send({
          retentionDays: 90
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject payload with unknown field', async () => {
      const response = await request(app)
        .post('/api-keys/cleanup')
        .send({
          retentionDays: 90,
          extraField: 'not allowed'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('extraField');
    });
  });

  describe('HTTP Method Filtering', () => {
    it('should not validate GET requests', async () => {
      const response = await request(app)
        .get('/donations')
        .query({ unknownParam: 'should be ignored' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should validate POST requests', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          unknownField: 'should be rejected'
        });

      expect(response.status).toBe(400);
    });

    it('should validate PATCH requests', async () => {
      const response = await request(app)
        .patch('/wallets/123')
        .send({
          label: 'Test',
          unknownField: 'should be rejected'
        });

      expect(response.status).toBe(400);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty payload', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({});

      // Empty payload should pass validation (required field validation is separate)
      expect(response.status).toBe(201);
    });

    it('should handle special characters in field names', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          'constructor': 'malicious'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.unknownFields).toContain('constructor');
      // Note: __proto__ is not enumerable and won't be detected
    });

    it('should provide helpful error information', async () => {
      const response = await request(app)
        .post('/donations/send')
        .send({
          senderId: '123',
          receiverId: '456',
          amount: 100,
          unknownField: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toHaveProperty('code');
      expect(response.body.error).toHaveProperty('message');
      expect(response.body.error).toHaveProperty('unknownFields');
      expect(response.body.error).toHaveProperty('allowedFields');
      expect(response.body.error.allowedFields).toContain('senderId');
      expect(response.body.error.allowedFields).toContain('receiverId');
      expect(response.body.error.allowedFields).toContain('amount');
      expect(response.body.error.allowedFields).toContain('memo');
    });
  });
});
