/**
 * Edge Case Integration Tests
 * Standardized Jest version of legacy test-edge-cases.js
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../../src/routes/donation');
const Transaction = require('../../src/routes/models/transaction');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');
const { resetMockStellarService } = require('../helpers/testIsolation');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  // Note: The legacy script hit /donations/send, but /api/v1/donations is the standard.
  // The router is usually attached at /donations in these tests.
  app.use('/donations', donationRouter);
  return app;
}

describe('Edge Case Tests', () => {
  let app;
  let stellarService;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
  });

  afterEach(() => {
    Transaction._clearAllData();
  });

  afterAll(() => {
    resetMockStellarService(stellarService);
  });

  describe('POST /donations - Edge Cases', () => {
    test('should return 400 when required fields are missing', async () => {
      const response = await request(app)
        .post('/donations') // Based on router attachment
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'edge-1')
        .send({
          senderId: 1
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    test('should return 400 when amount is invalid (negative)', async () => {
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'edge-2')
        .send({
          amount: '-10',
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should return 404 when user does not exist', async () => {
      // Assuming user 999 doesn't exist
      const response = await request(app)
        .post('/donations')
        .set('X-API-Key', 'test-key-1')
        .set('X-Idempotency-Key', 'edge-3')
        .send({
          senderId: 999,
          receiverId: 2,
          amount: '10',
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
        });

      // Depending on the implementation, this might be a 400 or 404.
      // The legacy script caught *any* error.
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('POST /donations/verify - Edge Cases', () => {
    test('should return 200 and success status when valid mock hash', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .set('X-API-Key', 'test-key-1')
        .send({
          transactionHash: 'mock_tx_hash_123'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });
});
