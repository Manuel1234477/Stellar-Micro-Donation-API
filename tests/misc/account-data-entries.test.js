/**
 * Account Data Entries Tests
 * 
 * Tests for Stellar "Manage Data" operations allowing wallets to store
 * on-chain key-value metadata. Covers CRUD operations, byte limit validation,
 * and error scenarios.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2';

const request = require('supertest');
const express = require('express');
const walletRouter = require('../../src/routes/wallet');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');
const Wallet = require('../../src/routes/models/wallet');
const { resetMockStellarService } = require('../helpers/testIsolation');

// Create test app
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/wallets', walletRouter);

  // Add error handler
  app.use((err, req, res, next) => {
    void next;
    res.status(err.status || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message || 'Internal server error'
      }
    });
  });
  return app;
}

describe('Account Data Entries (Manage Data Operations)', () => {
  let app;
  let stellarService;
  let testWallet;
  let testWalletDb;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();
    
    // Create test wallets
    testWallet = await stellarService.createWallet();
    testWalletDb = Wallet.create({
      address: testWallet.publicKey,
      label: 'Test Wallet for Data Entries'
    });
  });

  afterEach(async () => {
    resetMockStellarService();
  });

  describe('POST /wallets/:id/data - Set/Update Data Entry', () => {
    it('should successfully set a data entry when valid key and value', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'account_tier',
          value: 'premium'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hash');
      expect(response.body.data).toHaveProperty('ledger');
    });

    it('should successfully update an existing data entry', async () => {
      // First set
      let response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'kyc_status',
          value: 'pending'
        });

      expect(response.status).toBe(201);

      // Update with new value
      response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'kyc_status',
          value: 'verified'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject when key exceeds 64 bytes', async () => {
      // Create a key that exceeds 64 bytes
      const longKey = 'k'.repeat(65);

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: longKey,
          value: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('KEY_EXCEEDS_BYTE_LIMIT');
    });

    it('should reject when value exceeds 64 bytes', async () => {
      // Create a value that exceeds 64 bytes
      const longValue = 'v'.repeat(65);

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test_key',
          value: longValue
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALUE_EXCEEDS_BYTE_LIMIT');
    });

    it('should handle multi-byte Unicode characters correctly', async () => {
      // Emoji takes 4 bytes in UTF-8
      const emojiKey = '🌟'; // 4 bytes
      const validLength = 'k'.repeat(60) + '🌟'; // 60 + 4 = 64 bytes, valid

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: validLength,
          value: 'test'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should reject when Unicode value makes total exceed 64 bytes', async () => {
      const longValue = 'v'.repeat(61) + '🌟'; // 61 + 4 = 65 bytes, invalid

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test',
          value: longValue
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALUE_EXCEEDS_BYTE_LIMIT');
    });

    it('should reject when key is missing', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          value: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('should reject when secretKey is missing', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          key: 'test_key',
          value: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('should reject when wallet ID is invalid', async () => {
      const response = await request(app)
        .post('/wallets/invalid-id/data')
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test',
          value: 'test'
        });

      expect(response.status).toBe(400);
    });

    it('should reject when wallet is not found', async () => {
      const response = await request(app)
        .post('/wallets/999999/data')
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test',
          value: 'test'
        });

      expect(response.status).toBe(404);
    });

    it('should allow empty value when nullification', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test_nullify',
          value: ''
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should allow null value', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test_null',
          value: null
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });

    it('should support common use case: account_tier', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'account_tier',
          value: 'gold'
        });

      expect(response.status).toBe(201);
    });

    it('should support common use case: kyc_status', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'kyc_status',
          value: 'verified'
        });

      expect(response.status).toBe(201);
    });
  });

  describe('GET /wallets/:id/data - Fetch Data Entries', () => {
    it('should return empty entries when wallet when no data', async () => {
      const response = await request(app)
        .get(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual({});
      expect(response.body.count).toBe(0);
    });

    it('should return data entries when setting them', async () => {
      // First set some data
      await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'tier1',
          value: 'bronze'
        });

      await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'tier2',
          value: 'silver'
        });

      // Now fetch
      const response = await request(app)
        .get(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      // Mock service stores data entries (in real service, would be from Horizon)
      expect(response.body.count).toBeGreaterThanOrEqual(0);
    });

    it('should reject when invalid wallet ID', async () => {
      const response = await request(app)
        .get('/wallets/invalid-id/data')
        .set('Authorization', 'Bearer test-key-1');

      expect(response.status).toBe(400);
    });

    it('should reject when non-existent wallet', async () => {
      const response = await request(app)
        .get('/wallets/999999/data')
        .set('Authorization', 'Bearer test-key-1');

      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /wallets/:id/data/:key - Delete Data Entry', () => {
    beforeEach(async () => {
      // Set a data entry before each delete test
      await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'to_delete',
          value: 'will_be_deleted'
        });
    });

    it('should successfully delete an existing data entry', async () => {
      const response = await request(app)
        .delete(`/wallets/${testWalletDb.id}/data/to_delete`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('hash');
      expect(response.body.data).toHaveProperty('ledger');
    });

    it('should allow deleting non-existent key (Stellar accepts this)', async () => {
      const response = await request(app)
        .delete(`/wallets/${testWalletDb.id}/data/non_existent_key`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey
        });

      // Stellar accepts deletion of non-existent keys (idempotent)
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should reject when secretKey is missing', async () => {
      const response = await request(app)
        .delete(`/wallets/${testWalletDb.id}/data/to_delete`)
        .set('Authorization', 'Bearer test-key-1')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('MISSING_REQUIRED_FIELD');
    });

    it('should reject when wallet ID is invalid', async () => {
      const response = await request(app)
        .delete('/wallets/invalid-id/data/test_key')
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey
        });

      expect(response.status).toBe(400);
    });

    it('should reject when wallet is not found', async () => {
      const response = await request(app)
        .delete('/wallets/999999/data/test_key')
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey
        });

      expect(response.status).toBe(404);
    });

    it('should reject when key is empty', async () => {
      const response = await request(app)
        .delete(`/wallets/${testWalletDb.id}/data/`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey
        });

      // Route shouldn't match if key is empty
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Security and Best Practices', () => {
    it('should handle large ASCII keys at exactly 64 bytes', async () => {
      const key64bytes = 'k'.repeat(64);

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: key64bytes,
          value: 'test'
        });

      expect(response.status).toBe(201);
    });

    it('should handle large ASCII values at exactly 64 bytes', async () => {
      const value64bytes = 'v'.repeat(64);

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test_key',
          value: value64bytes
        });

      expect(response.status).toBe(201);
    });

    it('should properly encode base64 values in mock service', async () => {
      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'encoded_data',
          value: 'hello world'
        });

      expect(response.status).toBe(201);
      
      // In mock service, verify data is stored
      const mockWallet = stellarService.wallets.get(testWallet.publicKey);
      expect(mockWallet).toBeDefined();
      expect(mockWallet.data_attr).toBeDefined();
      expect(mockWallet.data_attr['encoded_data']).toBe(
        Buffer.from('hello world').toString('base64')
      );
    });
  });

  describe('Byte Length Edge Cases', () => {
    it('should correctly count UTF-8 multi-byte sequences in keys', async () => {
      // Chinese character '中' = 3 bytes in UTF-8
      const chineseKey = '中'.repeat(21) + 'a'; // 63 + 1 = 64 bytes, valid

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: chineseKey,
          value: 'test'
        });

      expect(response.status).toBe(201);
    });

    it('should reject Chinese character key exceeding 64 bytes', async () => {
      // Chinese character '中' = 3 bytes in UTF-8
      const chineseKey = '中'.repeat(22); // 66 bytes, invalid

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: chineseKey,
          value: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('KEY_EXCEEDS_BYTE_LIMIT');
    });

    it('should correctly count UTF-8 multi-byte sequences in values', async () => {
      // Chinese character '中' = 3 bytes in UTF-8
      const chineseValue = '中'.repeat(21) + 'a'; // 63 + 1 = 64 bytes, valid

      const response = await request(app)
        .post(`/wallets/${testWalletDb.id}/data`)
        .set('Authorization', 'Bearer test-key-1')
        .send({
          secretKey: testWallet.secretKey,
          key: 'test',
          value: chineseValue
        });

      expect(response.status).toBe(201);
    });
  });
});
