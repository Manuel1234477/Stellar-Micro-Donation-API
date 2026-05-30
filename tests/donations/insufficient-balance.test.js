/**
 * Insufficient Balance Tests
 * Verifies that a 422 is returned when the sender lacks sufficient funds.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const request = require('supertest');
const express = require('express');
const donationRouter = require('../../src/routes/donation');
const Database = require('../../src/utils/database');
const Transaction = require('../../src/routes/models/transaction');
const { getStellarService } = require('../../src/config/stellar');
const { attachUserRole } = require('../../src/middleware/rbac');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { resetMockStellarService } = require('../helpers/testIsolation');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use(errorHandler);
  return app;
}

describe('Insufficient Balance Check', () => {
  let app;
  let stellarService;
  let senderId;
  let receiverId;
  let senderPublicKey;

  beforeAll(async () => {
    app = createTestApp();
    stellarService = getStellarService();

    // Ensure velocity tables exist (may not be in test DB)
    await Database.run(`CREATE TABLE IF NOT EXISTS donation_velocity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      donorId INTEGER NOT NULL,
      recipientId INTEGER NOT NULL,
      windowStart DATETIME NOT NULL,
      totalAmount REAL NOT NULL DEFAULT 0,
      count INTEGER NOT NULL DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await Database.run(`CREATE TABLE IF NOT EXISTS recipient_velocity_limits (
      recipientId INTEGER PRIMARY KEY,
      maxAmount REAL,
      maxCount INTEGER,
      windowType TEXT NOT NULL DEFAULT 'daily',
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create Stellar wallets in MockStellarService
    const senderWallet = await stellarService.createWallet();
    const receiverWallet = await stellarService.createWallet();
    await stellarService.fundTestnetWallet(receiverWallet.publicKey);

    senderPublicKey = senderWallet.publicKey;

    // Encrypt secrets for DB storage
    const encryption = require('../../src/utils/encryption');
    const encSenderSecret = encryption.encrypt(senderWallet.secretKey);
    const encReceiverSecret = encryption.encrypt(receiverWallet.secretKey);

    // Insert users into DB
    const senderRow = await Database.run(
      'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
      [senderWallet.publicKey, encSenderSecret]
    );
    const receiverRow = await Database.run(
      'INSERT INTO users (publicKey, encryptedSecret) VALUES (?, ?)',
      [receiverWallet.publicKey, encReceiverSecret]
    );

    senderId = senderRow.id;
    receiverId = receiverRow.id;

    // Give sender 5 XLM — not enough for 10 XLM donation + 1 XLM reserve
    const senderWalletObj = stellarService.wallets.get(senderWallet.publicKey);
    senderWalletObj.assetBalances.native = '5.0000000';
    senderWalletObj.balance = '5.0000000';
  });

  afterEach(() => {
    Transaction._clearAllData();
  });

  afterAll(async () => {
    if (senderId) await Database.run('DELETE FROM users WHERE id = ?', [senderId]);
    if (receiverId) await Database.run('DELETE FROM users WHERE id = ?', [receiverId]);
    await Database.run('DELETE FROM transactions WHERE senderId = ?', [senderId]);
    resetMockStellarService(stellarService);
  });

  test('returns 422 with INSUFFICIENT_BALANCE when sender cannot cover amount + reserve', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'a1b2c3d4-e5f6-4a7b-8c9d-000000000001')
      .send({ senderId, receiverId, amount: 10 });

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(response.body.error.message).toMatch(/Insufficient balance/);
    expect(response.body.error.message).toMatch(/Required:/);
    expect(response.body.error.message).toMatch(/Available:/);
  });

  test('error message includes correct XLM amounts', async () => {
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'a1b2c3d4-e5f6-4a7b-8c9d-000000000002')
      .send({ senderId, receiverId, amount: 10 });

    expect(response.status).toBe(422);
    // amount(10) + reserve(1) = 11 required; available = 5
    expect(response.body.error.message).toContain('11.0000000 XLM');
    expect(response.body.error.message).toContain('5.0000000 XLM');
  });

  test('succeeds when sender has sufficient balance', async () => {
    // Bump sender balance to 20 XLM (covers 10 donation + 1 reserve)
    const senderWalletObj = stellarService.wallets.get(senderPublicKey);
    senderWalletObj.assetBalances.native = '20.0000000';
    senderWalletObj.balance = '20.0000000';

    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'a1b2c3d4-e5f6-4a7b-8c9d-000000000003')
      .send({ senderId, receiverId, amount: 10 });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
  });
});
