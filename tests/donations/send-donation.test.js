/**
 * Send Donation Integration Tests
 * Standardized Jest version of legacy test-send-donation.js
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
const { resetMockStellarService } = require('../helpers/testIsolation');

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  return app;
}

describe('Send Donation Tests', () => {
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

  test('should send donation and record in database when valid data provided', async () => {
    // 1. Get sample users
    const users = await Database.query('SELECT * FROM users LIMIT 2');
    if (users.length < 2) {
      console.warn('Skipping test: not enough users in DB.');
      return;
    }

    const sender = users[0];
    const receiver = users[1];
    const amount = '10.5';
    const memo = 'Test donation';

    // 2. Perform request
    const response = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('X-Idempotency-Key', 'send-test-1')
      .send({
        senderId: sender.id,
        receiverId: receiver.id,
        amount: amount,
        memo: memo
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);

    // 3. Verify Database Recording (SQLite)
    const tx = await Database.get(
      'SELECT * FROM transactions WHERE senderId = ? AND receiverId = ? ORDER BY timestamp DESC LIMIT 1',
      [sender.id, receiver.id]
    );

    expect(tx).toBeDefined();
    expect(tx.amount).toBe(parseFloat(amount));

    // 4. Verify JSON Recording
    const allJsonTxs = Transaction.getAll();
    const jsonTx = allJsonTxs.find(t => t.amount == amount && t.donor === sender.publicKey);

    expect(jsonTx).toBeDefined();
    expect(jsonTx.memo).toBe(memo);
  });
});
