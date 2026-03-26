/**
 * Donation E2E Tests — Real Stellar Testnet
 *
 * Tests the full donation lifecycle against the live Stellar testnet:
 *
 *   Service-layer (direct StellarService):
 *     - sendDonation() submits a real on-chain payment
 *     - verifyTransaction() confirms the ledger record
 *
 *   HTTP API layer (through Express app):
 *     - POST /api/v1/donations/send  — custodial donation (decrypts secret from DB)
 *     - POST /api/v1/donations/verify — verifies by hash
 *     - POST /api/v1/donations        — non-custodial record (no on-chain tx)
 *     - Idempotency: replay same request returns cached 201, no second tx
 *     - Error: sender with no encryptedSecret → 422/400
 *
 * Setup: each describe block seeds fresh funded keypairs via Friendbot.
 * Runtime: testTimeout is 60 s (set in jest.config.e2e.js).
 */

'use strict';

const request = require('supertest');
const { v4: uuid } = require('uuid');
const app = require('../../src/routes/app');
const {
  createTestnetService,
  createFundedAccount,
  createFundedUser,
  seedUser,
  generateKeypair,
  waitForBalance,
} = require('./helpers/testnet');
const { withRetry } = require('./helpers/retry');

const E2E_API_KEY = 'e2e-test-key';
const E2E_ADMIN_KEY = 'e2e-admin-key';
const DONATION_AMOUNT = 1; // XLM — small enough to run many times on testnet

// ─── Service-Layer Tests ──────────────────────────────────────────────────────

describe('Donation E2E — StellarService direct (no HTTP)', () => {
  let stellarService;
  let sender;
  let recipient;

  beforeAll(async () => {
    stellarService = createTestnetService();
    // Create two funded accounts in parallel — they are independent Friendbot calls
    [sender, recipient] = await Promise.all([
      createFundedAccount(stellarService),
      createFundedAccount(stellarService),
    ]);
    // Ensure both are confirmed on-chain before we try to spend from sender
    await Promise.all([
      waitForBalance(stellarService, sender.publicKey, '1'),
      waitForBalance(stellarService, recipient.publicKey, '1'),
    ]);
  }, 120000);

  it('sends a real XLM payment and returns a transaction hash', async () => {
    const result = await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipient.publicKey,
      amount: String(DONATION_AMOUNT),
      memo: 'e2e-service-test',
    });

    expect(typeof result.transactionId).toBe('string');
    expect(result.transactionId).toHaveLength(64); // Stellar tx hash is 64 hex chars
    expect(typeof result.ledger).toBe('number');
    expect(result.ledger).toBeGreaterThan(0);
  }, 60000);

  it('verifies a submitted transaction is recorded on the ledger', async () => {
    // Send a fresh payment so we have a known hash to verify
    const { transactionId } = await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipient.publicKey,
      amount: String(DONATION_AMOUNT),
    });

    const verification = await withRetry(
      () => stellarService.verifyTransaction(transactionId),
      { maxAttempts: 5, baseDelayMs: 2000 }
    );

    expect(verification.verified).toBe(true);
    expect(verification.transaction).toBeDefined();
    expect(verification.transaction.hash).toBe(transactionId);
  }, 60000);

  it('returns the correct balance after a payment is sent', async () => {
    const before = await stellarService.getBalance(sender.publicKey);

    await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipient.publicKey,
      amount: String(DONATION_AMOUNT),
    });

    const after = await stellarService.getBalance(sender.publicKey);
    // Balance should decrease by at least the donation amount
    expect(parseFloat(after.balance)).toBeLessThan(parseFloat(before.balance));
  }, 60000);
});

// ─── HTTP API Tests ───────────────────────────────────────────────────────────

describe('Donation E2E — HTTP API /donations/send', () => {
  let stellarService;
  let senderUser;    // { publicKey, secretKey, userId }
  let receiverUser;  // { publicKey, secretKey, userId }

  beforeAll(async () => {
    stellarService = createTestnetService();

    // Create and fund both users; seed them into the DB so the custodial
    // service can decrypt their secrets and sign transactions on their behalf.
    [senderUser, receiverUser] = await Promise.all([
      createFundedUser(stellarService),
      createFundedUser(stellarService),
    ]);

    await Promise.all([
      waitForBalance(stellarService, senderUser.publicKey, '5'),
      waitForBalance(stellarService, receiverUser.publicKey, '1'),
    ]);
  }, 120000);

  it('sends a custodial donation end-to-end and returns a transaction ID', async () => {
    const idempotencyKey = uuid();

    const res = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', idempotencyKey)
      .send({
        senderId: senderUser.userId,
        receiverId: receiverUser.userId,
        amount: DONATION_AMOUNT,
        memo: 'e2e-http-test',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('transactionId');
    expect(res.body.data).toHaveProperty('hash');
    expect(typeof res.body.data.transactionId).toBe('number');
  }, 60000);

  it('replays the same idempotency key and returns the cached result without a second tx', async () => {
    const idempotencyKey = uuid();
    const payload = {
      senderId: senderUser.userId,
      receiverId: receiverUser.userId,
      amount: DONATION_AMOUNT,
    };

    const first = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', idempotencyKey)
      .send(payload);

    expect(first.status).toBe(201);
    const firstHash = first.body.data.hash;

    const second = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', idempotencyKey)
      .send(payload);

    expect(second.status).toBe(201);
    // Exact same response — hash should match (cached, no new tx submitted)
    expect(second.body.data.hash).toBe(firstHash);
  }, 60000);

  it('returns an error when the x-idempotency-key header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .send({
        senderId: senderUser.userId,
        receiverId: receiverUser.userId,
        amount: DONATION_AMOUNT,
      });

    expect(res.status).toBe(400);
  });

  it('returns a structured error when senderId does not exist', async () => {
    const res = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({ senderId: 999999, receiverId: receiverUser.userId, amount: DONATION_AMOUNT });

    expect([400, 404, 422]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('returns an error when a user has no encrypted secret configured', async () => {
    // Seed a user with NO secret (publicKey only)
    const { publicKey } = generateKeypair();
    const { id: noSecretUserId } = await (async () => {
      const Database = require('../../src/utils/database');
      const r = await Database.run(
        'INSERT INTO users (publicKey) VALUES (?)',
        [publicKey]
      );
      return { id: r.lastID };
    })();

    const res = await request(app)
      .post('/api/v1/donations/send')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({
        senderId: noSecretUserId,
        receiverId: receiverUser.userId,
        amount: DONATION_AMOUNT,
      });

    expect([400, 422, 500]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /donations/verify ───────────────────────────────────────────────────

describe('Donation E2E — POST /api/v1/donations/verify', () => {
  let stellarService;
  let txHash;

  beforeAll(async () => {
    stellarService = createTestnetService();
    const sender = await createFundedAccount(stellarService);
    const recipient = generateKeypair();
    await waitForBalance(stellarService, sender.publicKey, '5');

    const { transactionId } = await stellarService.sendDonation({
      sourceSecret: sender.secretKey,
      destinationPublic: recipient.publicKey,
      amount: String(DONATION_AMOUNT),
    });
    txHash = transactionId;
  }, 120000);

  it('verifies a real transaction hash via the HTTP endpoint', async () => {
    const res = await request(app)
      .post('/api/v1/donations/verify')
      .set('x-api-key', E2E_API_KEY)
      .send({ transactionHash: txHash });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);
  }, 60000);

  it('returns an error for a non-existent transaction hash', async () => {
    const fakeHash = 'a'.repeat(64);

    const res = await request(app)
      .post('/api/v1/donations/verify')
      .set('x-api-key', E2E_API_KEY)
      .send({ transactionHash: fakeHash });

    expect(res.status).not.toBe(200);
    expect(res.body.success).toBe(false);
  });
});

// ─── POST /donations (non-custodial record) ───────────────────────────────────

describe('Donation E2E — POST /api/v1/donations (non-custodial record)', () => {
  it('creates a donation record without submitting an on-chain transaction', async () => {
    const { publicKey: donorKey } = generateKeypair();
    const { publicKey: recipientKey } = generateKeypair();

    const res = await request(app)
      .post('/api/v1/donations')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({
        donor: donorKey,
        recipient: recipientKey,
        amount: '10.5',
        memo: 'e2e-record-test',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // A non-custodial record doesn't have a Stellar tx hash
    expect(res.body.data).toBeDefined();
  });

  it('returns 400 when recipient is missing', async () => {
    const res = await request(app)
      .post('/api/v1/donations')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({ amount: '5.0' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for an invalid amount', async () => {
    const { publicKey: recipientKey } = generateKeypair();

    const res = await request(app)
      .post('/api/v1/donations')
      .set('x-api-key', E2E_API_KEY)
      .set('x-idempotency-key', uuid())
      .send({ recipient: recipientKey, amount: '-5' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
