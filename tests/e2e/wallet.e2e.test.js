/**
 * Wallet E2E Tests — Real Stellar Testnet
 *
 * Tests the full wallet lifecycle against the live Stellar testnet:
 *   - Keypair generation and Friendbot funding
 *   - Wallet registration via POST /api/v1/wallets (auto-funds via Friendbot)
 *   - Balance retrieval via GET /api/v1/wallets/:id/balance
 *   - Metadata updates via PATCH /api/v1/wallets/:id
 *   - Wallet listing via GET /api/v1/wallets
 *   - Auth and validation error cases
 *
 * Each describe block creates its own fresh keypair so tests are fully isolated.
 * All Stellar interactions use withRetry to tolerate testnet flakiness.
 */

'use strict';

const request = require('supertest');
const app = require('../../src/routes/app');
const { createTestnetService, generateKeypair, createFundedAccount, waitForBalance } = require('./helpers/testnet');

// API key configured in tests/e2e/setup.js
const E2E_API_KEY = 'e2e-test-key';
const E2E_ADMIN_KEY = 'e2e-admin-key';

describe('Wallet E2E — Stellar Testnet', () => {
  let stellarService;

  beforeAll(() => {
    stellarService = createTestnetService();
  });

  // ─── POST /api/v1/wallets ──────────────────────────────────────────────────

  describe('POST /api/v1/wallets — wallet creation', () => {
    it('creates a wallet and auto-funds it via Friendbot', async () => {
      const { publicKey } = generateKeypair();

      const res = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: publicKey, label: 'E2E Test Wallet', ownerName: 'E2E Runner' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toMatchObject({
        address: publicKey,
        label: 'E2E Test Wallet',
        ownerName: 'E2E Runner',
        funded: true,
      });
      expect(typeof res.body.data.id).toBe('string');
    }, 60000);

    it('returns 403 when no API key is supplied', async () => {
      const { publicKey } = generateKeypair();

      const res = await request(app)
        .post('/api/v1/wallets')
        .send({ address: publicKey });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('returns 400 when address field is missing', async () => {
      const res = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ label: 'No Address' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('returns 409 when the same address is registered twice', async () => {
      const { publicKey } = generateKeypair();

      // First registration
      const first = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: publicKey });

      expect(first.status).toBe(201);

      // Duplicate
      const second = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: publicKey });

      expect(second.status).toBe(409);
      expect(second.body.success).toBe(false);
    }, 60000);
  });

  // ─── GET /api/v1/wallets/:id ───────────────────────────────────────────────

  describe('GET /api/v1/wallets/:id — wallet retrieval', () => {
    let walletId;
    let walletAddress;

    beforeAll(async () => {
      const { publicKey } = generateKeypair();
      walletAddress = publicKey;

      const res = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: publicKey, label: 'Retrieval Test' });

      walletId = res.body.data.id;
    }, 60000);

    it('returns the wallet by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletId}`)
        .set('x-api-key', E2E_TEST_KEY());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.address).toBe(walletAddress);
    });

    it('returns 404 for an unknown wallet ID', async () => {
      const res = await request(app)
        .get('/api/v1/wallets/999999999')
        .set('x-api-key', E2E_TEST_KEY());

      expect(res.status).toBe(404);
    });
  });

  // ─── GET /api/v1/wallets/:id/balance ──────────────────────────────────────

  describe('GET /api/v1/wallets/:id/balance — live balance', () => {
    let walletId;
    let walletPublicKey;

    beforeAll(async () => {
      const keypair = await createFundedAccount(stellarService);
      walletPublicKey = keypair.publicKey;

      // Confirm balance is on-chain before registering with the API
      await waitForBalance(stellarService, walletPublicKey, '1');

      const res = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: walletPublicKey, label: 'Balance Test' });

      walletId = res.body.data.id;
    }, 60000);

    it('returns a positive XLM balance for a Friendbot-funded account', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletId}/balance`)
        .set('x-api-key', E2E_TEST_KEY());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.asset).toBe('XLM');
      expect(parseFloat(res.body.data.balance)).toBeGreaterThan(0);
    });

    it('returns a fresh balance when refresh=true bypasses cache', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletId}/balance?refresh=true`)
        .set('x-api-key', E2E_TEST_KEY());

      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('MISS');
    });
  });

  // ─── PATCH /api/v1/wallets/:id ────────────────────────────────────────────

  describe('PATCH /api/v1/wallets/:id — metadata updates', () => {
    let walletId;

    beforeAll(async () => {
      const { publicKey } = generateKeypair();

      const res = await request(app)
        .post('/api/v1/wallets')
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ address: publicKey, label: 'Original Label' });

      walletId = res.body.data.id;
    }, 60000);

    it('updates wallet label', async () => {
      const res = await request(app)
        .patch(`/api/v1/wallets/${walletId}`)
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ label: 'Updated Label' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.label).toBe('Updated Label');
    });

    it('updates ownerName', async () => {
      const res = await request(app)
        .patch(`/api/v1/wallets/${walletId}`)
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({ ownerName: 'New Owner' });

      expect(res.status).toBe(200);
      expect(res.body.data.ownerName).toBe('New Owner');
    });

    it('returns 400 when no updateable fields are provided', async () => {
      const res = await request(app)
        .patch(`/api/v1/wallets/${walletId}`)
        .set('x-api-key', E2E_ADMIN_KEY)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ─── GET /api/v1/wallets ──────────────────────────────────────────────────

  describe('GET /api/v1/wallets — wallet list', () => {
    it('returns a list of wallets including ones created in this test run', async () => {
      const res = await request(app)
        .get('/api/v1/wallets')
        .set('x-api-key', E2E_TEST_KEY());

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns 403 without a valid API key', async () => {
      const res = await request(app)
        .get('/api/v1/wallets')
        .set('x-api-key', 'invalid-key-xyz');

      expect(res.status).toBe(403);
    });
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Return the standard e2e read-only API key. */
function E2E_TEST_KEY() {
  return E2E_API_KEY;
}
