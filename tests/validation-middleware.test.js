const request = require('supertest');
const express = require('express');
const donationRouter = require('../src/routes/donation');
const statsRouter = require('../src/routes/stats');
const walletRouter = require('../src/routes/wallet');

// Create test app
const app = express();
app.use(express.json());
app.use('/donations', donationRouter);
app.use('/stats', statsRouter);
app.use('/wallets', walletRouter);

describe('Validation Middleware - Integration Tests', () => {
  describe('Donation Creation Validation', () => {
    test('should reject request with missing amount field', async () => {
      const response = await request(app)
        .post('/donations')
        .send({ recipient: 'test-recipient' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
      expect(response.body.error.field).toBe('amount');
    });

    test('should reject missing recipient', async () => {
      const response = await request(app)
        .post('/donations')
        .send({ amount: 10 });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
      expect(response.body.error.field).toBe('recipient');
    });

    test('should reject zero amount', async () => {
      const response = await request(app)
        .post('/donations')
        .send({ amount: 0, recipient: 'test-recipient' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_AMOUNT');
    });

    test('should reject negative amount', async () => {
      const response = await request(app)
        .post('/donations')
        .send({ amount: -10, recipient: 'test-recipient' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_AMOUNT');
    });

    test('should reject invalid amount format', async () => {
      const response = await request(app)
        .post('/donations')
        .send({ amount: 'not-a-number', recipient: 'test-recipient' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_AMOUNT');
    });

    test('should reject same donor and recipient', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 10,
          donor: 'same-wallet',
          recipient: 'same-wallet'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TRANSACTION');
    });

    test('should reject invalid Stellar address for recipient', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 10,
          recipient: 'GINVALID123'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STELLAR_ADDRESS');
      expect(response.body.error.field).toBe('recipient');
    });

    test('should accept valid donation', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 10.5,
          donor: 'Anonymous',
          recipient: 'test-recipient'
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data.amount).toBe(10.5);
    });

    test('should accept valid Stellar address', async () => {
      const validAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 10,
          recipient: validAddress
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Transaction Verification Validation', () => {
    test('should reject request with missing transaction hash', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
      expect(response.body.error.field).toBe('transactionHash');
    });

    test('should reject invalid transaction hash format', async () => {
      const response = await request(app)
        .post('/donations/verify')
        .send({ transactionHash: 'invalid-hash' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_TRANSACTION_HASH');
    });

    test('should accept valid transaction hash', async () => {
      const validHash = 'a'.repeat(64);
      const response = await request(app)
        .post('/donations/verify')
        .send({ transactionHash: validHash });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Date Range Validation', () => {
    test('should reject request with missing startDate parameter', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .query({ endDate: '2024-12-31' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_PARAMETERS');
    });

    test('should reject missing endDate', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .query({ startDate: '2024-01-01' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_PARAMETERS');
    });

    test('should reject invalid date format', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .query({ startDate: 'invalid', endDate: '2024-12-31' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_DATE_RANGE');
    });

    test('should reject start date after end date', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .query({ startDate: '2024-12-31', endDate: '2024-01-01' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_DATE_RANGE');
    });

    test('should accept valid date range', async () => {
      const response = await request(app)
        .get('/stats/daily')
        .query({ startDate: '2024-01-01', endDate: '2024-12-31' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Wallet Creation Validation', () => {
    test('should reject request with missing name field', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({ walletAddress: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
      expect(response.body.error.field).toBe('name');
    });

    test('should reject missing wallet address', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({ name: 'Test User' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
      expect(response.body.error.field).toBe('walletAddress');
    });

    test('should reject invalid Stellar address', async () => {
      const response = await request(app)
        .post('/wallets')
        .send({
          name: 'Test User',
          walletAddress: 'INVALID123'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STELLAR_ADDRESS');
    });

    test('should accept valid wallet creation', async () => {
      const validAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const response = await request(app)
        .post('/wallets')
        .send({
          name: 'Test User',
          walletAddress: validAddress
        });

      // May be 201 (created) or 409 (already exists)
      expect([201, 409]).toContain(response.status);
    });
  });

  describe('Wallet Lookup Validation', () => {
    test('should reject request with missing wallet address', async () => {
      const response = await request(app)
        .post('/wallets/lookup')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('MISSING_FIELD');
    });

    test('should reject invalid Stellar address', async () => {
      const response = await request(app)
        .post('/wallets/lookup')
        .send({ walletAddress: 'INVALID' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STELLAR_ADDRESS');
    });
  });
});
