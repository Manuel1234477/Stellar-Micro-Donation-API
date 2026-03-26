/**
 * Transaction E2E Tests — Real Stellar Testnet
 *
 * Tests transaction history and verification against the live Stellar testnet:
 *
 *   Service-layer (direct StellarService):
 *     - getTransactionHistory() returns real on-chain records
 *     - verifyTransaction()    confirms a specific ledger entry
 *
 *   HTTP API layer:
 *     - GET /api/v1/transactions              — paginated list from DB
 *     - GET /api/v1/wallets/:publicKey/transactions — wallet-specific history
 *
 * Setup: creates two funded accounts, submits a donation, then runs assertions
 * against the resulting transaction data. All Stellar calls use withRetry.
 */

'use strict';

const request = require('supertest');
const { v4: uuid } = require('uuid');
const app = require('../../src/routes/app');
const {
  createTestnetService,
  createFundedAccount,
  createFundedUser,
  waitForBalance,
  generateKeypair,
} = require('./helpers/testnet');
const { withRetry } = require('./helpers/retry');

const E2E_API_KEY = 'e2e-test-key';
const DONATION_AMOUNT = '1';

// ─── Service-Layer Transaction History ───────────────────────────────────────

describe('Transaction E2E — StellarService.getTransactionHistory()', () => {
  let stellarService;
  let senderPublicKey;
  let submittedHash;

  beforeAll(async () => {
    stellarService = createTestnetService();
    const sender = await createFundedAccount(stellarService);
    const { publicKey: recipientKey } = generateKeypair();

    senderPublicKey = sender.publicKey;
    await waitForBalance(stellarService, senderPublicKey, '5');

    const { transactionId } = await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipientKey,
      amount: DONATION_AMOUNT,
      memo: 'e2e-history-test',
    });
    submittedHash = transactionId;
  }, 120000);

  it('returns an array of on-chain transactions for the account', async () => {
    const records = await withRetry(
      () => stellarService.getTransactionHistory(senderPublicKey, 10),
      { maxAttempts: 5, baseDelayMs: 2000 }
    );

    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
  }, 60000);

  it('includes the just-submitted transaction in the history', async () => {
    const records = await withRetry(
      () => stellarService.getTransactionHistory(senderPublicKey, 10),
      { maxAttempts: 5, baseDelayMs: 2000 }
    );

    const match = records.find(r => r.hash === submittedHash);
    expect(match).toBeDefined();
  }, 60000);

  it('respects the limit parameter', async () => {
    const records = await stellarService.getTransactionHistory(senderPublicKey, 2);
    expect(records.length).toBeLessThanOrEqual(2);
  }, 60000);
});

// ─── Service-Layer Transaction Verification ──────────────────────────────────

describe('Transaction E2E — StellarService.verifyTransaction()', () => {
  let stellarService;
  let knownHash;

  beforeAll(async () => {
    stellarService = createTestnetService();
    const sender = await createFundedAccount(stellarService);
    const { publicKey: recipientKey } = generateKeypair();

    await waitForBalance(stellarService, sender.publicKey, '5');

    const { transactionId } = await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipientKey,
      amount: DONATION_AMOUNT,
    });
    knownHash = transactionId;
  }, 120000);

  it('returns verified: true for a confirmed transaction', async () => {
    const result = await withRetry(
      () => stellarService.verifyTransaction(knownHash),
      { maxAttempts: 5, baseDelayMs: 2000 }
    );

    expect(result.verified).toBe(true);
    expect(result.transaction).toBeDefined();
    expect(result.transaction.hash).toBe(knownHash);
    expect(result.transaction.successful).toBe(true);
  }, 60000);

  it('throws for a hash that does not exist on-chain', async () => {
    const nonExistentHash = 'b'.repeat(64);

    await expect(
      stellarService.verifyTransaction(nonExistentHash)
    ).rejects.toThrow();
  }, 30000);
});

// ─── HTTP API — GET /api/v1/transactions ─────────────────────────────────────

describe('Transaction E2E — GET /api/v1/transactions', () => {
  beforeAll(async () => {
    // Seed at least one DB transaction via a custodial donation so the list
    // endpoint has something to return. Re-use shared funded users if available.
    const stellarService = createTestnetService();
    const senderUser = await createFundedUser(stellarService);
    const receiverUser = await createFundedUser(stellarService);

    await Promise.all([
      waitForBalance(stellarService, senderUser.publicKey, '5'),
      waitForBalance(stellarService, receiverUser.publicKey, '1'),
    ]);

    await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({
        senderId: senderUser.userId,
        receiverId: receiverUser.userId,
        amount: 1,
      });
  }, 120000);

  it('returns a paginated list of transactions', async () => {
    const res = await request(app)
      .get('/api/v1/transactions')
      .set('x-api-key', E2E_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('respects the limit query parameter', async () => {
    const res = await request(app)
      .get('/api/v1/transactions?limit=1')
      .set('x-api-key', E2E_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(1);
  });

  it('returns 403 without an API key', async () => {
    const res = await request(app).get('/api/v1/transactions');

    expect(res.status).toBe(403);
  });

  it('returns 400 for an invalid limit value', async () => {
    const res = await request(app)
      .get('/api/v1/transactions?limit=999')
      .set('x-api-key', E2E_API_KEY);

    expect(res.status).toBe(400);
  });
});

// ─── HTTP API — GET /api/v1/wallets/:publicKey/transactions ──────────────────

describe('Transaction E2E — GET /api/v1/wallets/:publicKey/transactions', () => {
  let stellarService;
  let senderPublicKey;

  beforeAll(async () => {
    stellarService = createTestnetService();
    const senderUser = await createFundedUser(stellarService);
    const receiverUser = await createFundedUser(stellarService);
    senderPublicKey = senderUser.publicKey;

    await Promise.all([
      waitForBalance(stellarService, senderUser.publicKey, '5'),
      waitForBalance(stellarService, receiverUser.publicKey, '1'),
    ]);

    // Submit a custodial donation so the sender has DB transaction history
    await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({
        senderId: senderUser.userId,
        receiverId: receiverUser.userId,
        amount: 1,
      });
  }, 120000);

  it('returns transaction history for a specific wallet public key', async () => {
    const res = await request(app)
      .get(`/api/v1/wallets/${senderPublicKey}/transactions`)
      .set('x-api-key', E2E_API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // The wallet was used as a sender — its history should be non-empty
    expect(res.body.data.transactions).toBeDefined();
  });

  it('returns an empty history for a public key with no DB activity', async () => {
    const { publicKey } = generateKeypair();

    const res = await request(app)
      .get(`/api/v1/wallets/${publicKey}/transactions`)
      .set('x-api-key', E2E_API_KEY);

    expect(res.status).toBe(200);
    // Unknown public key returns count: 0 (not a 404)
    expect(res.body.data.count).toBe(0);
  });
});
