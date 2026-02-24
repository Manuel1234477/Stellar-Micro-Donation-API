/**
 * Integration tests for input sanitization across API endpoints
 */

const request = require('supertest');
const express = require('express');
const donationRoutes = require('../src/routes/donation');
const walletRoutes = require('../src/routes/wallet');
const Transaction = require('../src/routes/models/transaction');
const Wallet = require('../src/routes/models/wallet');

// Mock dependencies
jest.mock('../src/utils/database');
jest.mock('../src/middleware/apiKeyMiddleware', () => (req, res, next) => next());
jest.mock('../src/middleware/rbacMiddleware', () => ({
  checkPermission: () => (req, res, next) => next()
}));
jest.mock('../src/middleware/idempotencyMiddleware', () => ({
  requireIdempotency: (req, res, next) => {
    req.idempotency = { key: 'test-key-' + Date.now() };
    next();
  },
  storeIdempotencyResponse: jest.fn()
}));

// Mock rate limiters
jest.mock('express-rate-limit', () => {
  return jest.fn(() => (req, res, next) => next());
}, { virtual: true });

describe('Sanitization Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/donations', donationRoutes);
    app.use('/wallets', walletRoutes);

    // Clear mocks
    jest.clearAllMocks();
  });

  describe('Donation Metadata Sanitization', () => {
    test('should sanitize memo field in donation creation', async () => {
      const createSpy = jest.spyOn(Transaction, 'create').mockReturnValue({
        id: '1',
        amount: 100,
        donor: 'Anonymous',
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        memo: 'testmemo',
        status: 'pending'
      });

      await request(app)
        .post('/donations')
        .send({
          amount: 100,
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          memo: '  testmemo  '
        });

      expect(createSpy).toHaveBeenCalled();
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.memo).toBe('testmemo');
    });

    test('should reject memo with control characters', async () => {
      const response = await request(app)
        .post('/donations')
        .send({
          amount: 100,
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          memo: 'test\x01\x02\x03'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should sanitize donor identifier', async () => {
      const createSpy = jest.spyOn(Transaction, 'create').mockReturnValue({
        id: '1',
        amount: 100,
        donor: 'donor123',
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        status: 'pending'
      });

      jest.spyOn(Transaction, 'getDailyTotalByDonor').mockReturnValue(0);

      await request(app)
        .post('/donations')
        .send({
          amount: 100,
          donor: 'donor<script>123',
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
        });

      expect(createSpy).toHaveBeenCalled();
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.donor).not.toContain('<');
      expect(callArgs.donor).not.toContain('>');
    });

    test('should sanitize recipient identifier', async () => {
      const createSpy = jest.spyOn(Transaction, 'create').mockReturnValue({
        id: '1',
        amount: 100,
        donor: 'Anonymous',
        recipient: 'recipient123',
        status: 'pending'
      });

      await request(app)
        .post('/donations')
        .send({
          amount: 100,
          recipient: 'recipient\n123'
        });

      expect(createSpy).toHaveBeenCalled();
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.recipient).not.toContain('\n');
    });
  });

  describe('Wallet Metadata Sanitization', () => {
    test('should sanitize label when creating wallet', async () => {
      const createSpy = jest.spyOn(Wallet, 'create').mockReturnValue({
        id: '1',
        address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        label: 'MyWallet',
        ownerName: null
      });

      jest.spyOn(Wallet, 'getByAddress').mockReturnValue(null);

      await request(app)
        .post('/wallets')
        .send({
          address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          label: 'My\nWallet\x00'
        });

      expect(createSpy).toHaveBeenCalled();
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.label).not.toContain('\n');
      expect(callArgs.label).not.toContain('\x00');
    });

    test('should sanitize ownerName when creating wallet', async () => {
      const createSpy = jest.spyOn(Wallet, 'create').mockReturnValue({
        id: '1',
        address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        label: null,
        ownerName: 'JohnDoe'
      });

      jest.spyOn(Wallet, 'getByAddress').mockReturnValue(null);

      await request(app)
        .post('/wallets')
        .send({
          address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          ownerName: 'John\x01Doe'
        });

      expect(createSpy).toHaveBeenCalled();
      const callArgs = createSpy.mock.calls[0][0];
      expect(callArgs.ownerName).not.toContain('\x01');
    });

    test('should sanitize label when updating wallet', async () => {
      const updateSpy = jest.spyOn(Wallet, 'update').mockReturnValue({
        id: '1',
        address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        label: 'UpdatedLabel',
        ownerName: null
      });

      await request(app)
        .patch('/wallets/1')
        .send({
          label: 'Updated\nLabel\x00'
        });

      expect(updateSpy).toHaveBeenCalled();
      const callArgs = updateSpy.mock.calls[0][1];
      expect(callArgs.label).not.toContain('\n');
      expect(callArgs.label).not.toContain('\x00');
    });
  });

  describe('Log Injection Prevention', () => {
    test('should prevent log injection in memo field', async () => {
      jest.spyOn(Transaction, 'create').mockReturnValue({
        id: '1',
        amount: 100,
        donor: 'Anonymous',
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        memo: 'safememo',
        status: 'pending'
      });

      const maliciousMemo = 'safe\n[2024-01-01] [ERROR] Fake log entry';

      const response = await request(app)
        .post('/donations')
        .send({
          amount: 100,
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          memo: maliciousMemo
        });

      expect(response.status).toBe(400);
      expect(Transaction.create).not.toHaveBeenCalled();
    });

    test('should prevent ANSI escape codes in labels', async () => {
      jest.spyOn(Wallet, 'create').mockReturnValue({
        id: '1',
        address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        label: 'RedLabel',
        ownerName: null
      });

      jest.spyOn(Wallet, 'getByAddress').mockReturnValue(null);

      await request(app)
        .post('/wallets')
        .send({
          address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          label: '\x1B[31mRed Label\x1B[0m'
        });

      const createCall = Wallet.create.mock.calls[0][0];
      expect(createCall.label).not.toContain('\x1B');
    });
  });

  describe('XSS Prevention', () => {
    test('should sanitize potential XSS in donor field', async () => {
      jest.spyOn(Transaction, 'create').mockReturnValue({
        id: '1',
        amount: 100,
        donor: 'scriptalert1script',
        recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        status: 'pending'
      });

      jest.spyOn(Transaction, 'getDailyTotalByDonor').mockReturnValue(0);

      await request(app)
        .post('/donations')
        .send({
          amount: 100,
          donor: '<script>alert(1)</script>',
          recipient: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H'
        });

      const createCall = Transaction.create.mock.calls[0][0];
      expect(createCall.donor).not.toContain('<script>');
    });
  });

  describe('Null Byte Injection Prevention', () => {
    test('should remove null bytes from all text fields', async () => {
      jest.spyOn(Wallet, 'create').mockReturnValue({
        id: '1',
        address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
        label: 'safelabel',
        ownerName: 'safename'
      });

      jest.spyOn(Wallet, 'getByAddress').mockReturnValue(null);

      await request(app)
        .post('/wallets')
        .send({
          address: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
          label: 'safe\x00label',
          ownerName: 'safe\x00name'
        });

      const createCall = Wallet.create.mock.calls[0][0];
      expect(createCall.label).not.toContain('\x00');
      expect(createCall.ownerName).not.toContain('\x00');
    });
  });
});
