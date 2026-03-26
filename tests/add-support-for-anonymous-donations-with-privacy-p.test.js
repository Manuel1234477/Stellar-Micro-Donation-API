/**
 * Tests: Anonymous Donations with Privacy Preservation
 *
 * Covers:
 *  - anonymization utility (generatePseudonymousId, verifyPseudonymousId, isPseudonymousId)
 *  - DonationService.createDonationRecord with anonymous=true
 *  - DonationService.verifyAnonymousDonation
 *  - DonationService.getLeaderboard (anonymous exclusion)
 *  - DonationService.getRecentDonations (excludeAnonymous option)
 *  - StatsService.getDonorStats (anonymous exclusion)
 *  - GET /donations/verify-anonymous HTTP endpoint
 *  - Edge cases and validation errors
 *
 * No live Stellar network required — uses MockStellarService.
 */

'use strict';

process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

// ─── Isolated JSON store for this test suite ─────────────────────────────────
const TEST_DB_PATH = path.join(__dirname, '../data/test-anonymous-donations.json');
process.env.DB_JSON_PATH = TEST_DB_PATH;

const Transaction = require('../src/routes/models/transaction');

function clearDb() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
}

// ─── Imports ──────────────────────────────────────────────────────────────────
const {
  generatePseudonymousId,
  verifyPseudonymousId,
  isPseudonymousId,
} = require('../src/utils/anonymization');

const DonationService = require('../src/services/DonationService');
const MockStellarService = require('../src/services/MockStellarService');
const StatsService = require('../src/services/StatsService');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const WALLET_A = 'GABC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN';
const WALLET_B = 'GXYZ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN';
const RECIPIENT = 'GREC1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMN';

function makeDonationService() {
  return new DonationService(new MockStellarService({ strictValidation: false }));
}

// ─── 1. Anonymization Utility ─────────────────────────────────────────────────
describe('anonymization utility', () => {
  describe('generatePseudonymousId', () => {
    test('returns a string prefixed with "anon_"', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(typeof id).toBe('string');
      expect(id.startsWith('anon_')).toBe(true);
    });

    test('output is 69 characters long (anon_ + 64 hex chars)', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(id).toHaveLength(69);
    });

    test('is deterministic — same wallet always produces same ID', () => {
      const id1 = generatePseudonymousId(WALLET_A);
      const id2 = generatePseudonymousId(WALLET_A);
      expect(id1).toBe(id2);
    });

    test('different wallets produce different IDs', () => {
      const id1 = generatePseudonymousId(WALLET_A);
      const id2 = generatePseudonymousId(WALLET_B);
      expect(id1).not.toBe(id2);
    });

    test('trims whitespace from wallet address before hashing', () => {
      const id1 = generatePseudonymousId(WALLET_A);
      const id2 = generatePseudonymousId(`  ${WALLET_A}  `);
      expect(id1).toBe(id2);
    });

    test('throws TypeError for empty string', () => {
      expect(() => generatePseudonymousId('')).toThrow(TypeError);
    });

    test('throws TypeError for whitespace-only string', () => {
      expect(() => generatePseudonymousId('   ')).toThrow(TypeError);
    });

    test('throws TypeError for non-string input', () => {
      expect(() => generatePseudonymousId(null)).toThrow(TypeError);
      expect(() => generatePseudonymousId(undefined)).toThrow(TypeError);
      expect(() => generatePseudonymousId(42)).toThrow(TypeError);
    });
  });

  describe('verifyPseudonymousId', () => {
    test('returns true when wallet matches the pseudonymous ID', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(verifyPseudonymousId(WALLET_A, id)).toBe(true);
    });

    test('returns false when wallet does not match', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(verifyPseudonymousId(WALLET_B, id)).toBe(false);
    });

    test('returns false for a completely wrong pseudonymous ID', () => {
      const fakeId = 'anon_' + '0'.repeat(64);
      expect(verifyPseudonymousId(WALLET_A, fakeId)).toBe(false);
    });

    test('throws TypeError for empty walletAddress', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(() => verifyPseudonymousId('', id)).toThrow(TypeError);
    });

    test('throws TypeError for empty pseudonymousId', () => {
      expect(() => verifyPseudonymousId(WALLET_A, '')).toThrow(TypeError);
    });

    test('throws TypeError for non-string inputs', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(() => verifyPseudonymousId(null, id)).toThrow(TypeError);
      expect(() => verifyPseudonymousId(WALLET_A, null)).toThrow(TypeError);
    });
  });

  describe('isPseudonymousId', () => {
    test('returns true for a valid pseudonymous ID', () => {
      const id = generatePseudonymousId(WALLET_A);
      expect(isPseudonymousId(id)).toBe(true);
    });

    test('returns false for a plain wallet address', () => {
      expect(isPseudonymousId(WALLET_A)).toBe(false);
    });

    test('returns false for an ID with wrong hex length', () => {
      expect(isPseudonymousId('anon_abc123')).toBe(false);
    });

    test('returns false for non-string', () => {
      expect(isPseudonymousId(null)).toBe(false);
      expect(isPseudonymousId(42)).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isPseudonymousId('')).toBe(false);
    });
  });
});

// ─── 2. DonationService — anonymous donation creation ─────────────────────────
describe('DonationService.createDonationRecord — anonymous donations', () => {
  let service;

  beforeEach(() => {
    clearDb();
    service = makeDonationService();
  });

  afterEach(clearDb);

  test('stores pseudonymous ID instead of wallet address when anonymous=true', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    expect(tx.anonymous).toBe(true);
    expect(tx.donor).not.toBe(WALLET_A);
    expect(isPseudonymousId(tx.donor)).toBe(true);
    expect(tx.pseudonymousId).toBe(tx.donor);
  });

  test('pseudonymous ID is consistent for the same wallet address', async () => {
    const tx1 = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    const tx2 = await service.createDonationRecord({
      amount: 10,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
      idempotencyKey: 'key-2',
    });

    expect(tx1.pseudonymousId).toBe(tx2.pseudonymousId);
  });

  test('different wallets produce different pseudonymous IDs', async () => {
    const tx1 = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    const tx2 = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_B,
      recipient: RECIPIENT,
      anonymous: true,
      idempotencyKey: 'key-b',
    });

    expect(tx1.pseudonymousId).not.toBe(tx2.pseudonymousId);
  });

  test('stores real wallet address when anonymous=false', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: false,
    });

    expect(tx.anonymous).toBe(false);
    expect(tx.donor).toBe(WALLET_A);
    expect(tx.pseudonymousId).toBeNull();
  });

  test('stores real wallet address when anonymous is omitted', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
    });

    expect(tx.anonymous).toBe(false);
    expect(tx.donor).toBe(WALLET_A);
  });

  test('anonymous donation without donor field uses "Anonymous" as donor', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      recipient: RECIPIENT,
      anonymous: true,
    });

    // No real wallet to hash — falls back to 'Anonymous'
    expect(tx.donor).toBe('Anonymous');
    expect(tx.anonymous).toBe(true);
  });
});

// ─── 3. DonationService.verifyAnonymousDonation ───────────────────────────────
describe('DonationService.verifyAnonymousDonation', () => {
  let service;

  beforeEach(() => {
    clearDb();
    service = makeDonationService();
  });

  afterEach(clearDb);

  test('returns verified=true when wallet address matches', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    const result = service.verifyAnonymousDonation(tx.id, WALLET_A);
    expect(result.verified).toBe(true);
    expect(result.donationId).toBe(tx.id);
    expect(result.pseudonymousId).toBe(tx.pseudonymousId);
    expect(result.amount).toBe(tx.amount);
    expect(result.recipient).toBe(tx.recipient);
    expect(result.timestamp).toBeDefined();
  });

  test('returns verified=false when wallet address does not match', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    const result = service.verifyAnonymousDonation(tx.id, WALLET_B);
    expect(result.verified).toBe(false);
  });

  test('throws ValidationError for non-anonymous donation', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: false,
    });

    expect(() => service.verifyAnonymousDonation(tx.id, WALLET_A)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('not anonymous') })
    );
  });

  test('throws NotFoundError for unknown donation ID', () => {
    expect(() => service.verifyAnonymousDonation('nonexistent-id', WALLET_A)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('not found') })
    );
  });

  test('throws ValidationError when donationId is missing', () => {
    expect(() => service.verifyAnonymousDonation(null, WALLET_A)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('donationId') })
    );
  });

  test('throws ValidationError when walletAddress is missing', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    expect(() => service.verifyAnonymousDonation(tx.id, null)).toThrow(
      expect.objectContaining({ message: expect.stringContaining('walletAddress') })
    );
  });
});

// ─── 4. Leaderboard exclusion ─────────────────────────────────────────────────
describe('DonationService.getLeaderboard — anonymous exclusion', () => {
  let service;

  beforeEach(() => {
    clearDb();
    service = makeDonationService();
  });

  afterEach(clearDb);

  test('anonymous donations are excluded from the leaderboard', async () => {
    await service.createDonationRecord({
      amount: 100,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    await service.createDonationRecord({
      amount: 50,
      donor: WALLET_B,
      recipient: RECIPIENT,
      idempotencyKey: 'lb-2',
    });

    const leaderboard = service.getLeaderboard();
    const donors = leaderboard.map(e => e.donor);

    // WALLET_B should appear; WALLET_A's pseudonymous ID should NOT
    expect(donors).toContain(WALLET_B);
    expect(donors.some(d => isPseudonymousId(d))).toBe(false);
    expect(donors).not.toContain(WALLET_A);
  });

  test('leaderboard is empty when all donations are anonymous', async () => {
    await service.createDonationRecord({
      amount: 100,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    const leaderboard = service.getLeaderboard();
    expect(leaderboard).toHaveLength(0);
  });
});

// ─── 5. getRecentDonations — excludeAnonymous option ─────────────────────────
describe('DonationService.getRecentDonations — excludeAnonymous', () => {
  let service;

  beforeEach(() => {
    clearDb();
    service = makeDonationService();
  });

  afterEach(clearDb);

  test('includes anonymous donations by default (donor shown as pseudonymousId)', async () => {
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });

    const recent = service.getRecentDonations(10);
    const found = recent.find(r => r.id === tx.id);
    expect(found).toBeDefined();
    expect(isPseudonymousId(found.donor)).toBe(true);
    expect(found.anonymous).toBe(true);
  });

  test('excludes anonymous donations when excludeAnonymous=true', async () => {
    const anonTx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    const publicTx = await service.createDonationRecord({
      amount: 10,
      donor: WALLET_B,
      recipient: RECIPIENT,
      idempotencyKey: 'recent-2',
    });

    const recent = service.getRecentDonations(10, { excludeAnonymous: true });
    const ids = recent.map(r => r.id);

    expect(ids).not.toContain(anonTx.id);
    expect(ids).toContain(publicTx.id);
  });
});

// ─── 6. StatsService.getDonorStats — anonymous exclusion ─────────────────────
describe('StatsService.getDonorStats — anonymous exclusion', () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  test('anonymous donations are excluded from donor stats', async () => {
    const service = makeDonationService();

    await service.createDonationRecord({
      amount: 100,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    await service.createDonationRecord({
      amount: 50,
      donor: WALLET_B,
      recipient: RECIPIENT,
      idempotencyKey: 'stats-2',
    });

    const start = new Date(Date.now() - 60000);
    const end = new Date(Date.now() + 60000);
    const stats = StatsService.getDonorStats(start, end);

    const donors = stats.map(s => s.donor);
    expect(donors).toContain(WALLET_B);
    expect(donors.some(d => isPseudonymousId(d))).toBe(false);
    expect(donors).not.toContain(WALLET_A);
  });
});

// ─── 7. HTTP endpoint: GET /donations/verify-anonymous ───────────────────────
// We build a minimal Express app that only mounts the donation router,
// avoiding the full app.js which starts background services (scheduler, etc.)
describe('GET /donations/verify-anonymous', () => {
  const request = require('supertest');
  const express = require('express');

  // Build a minimal app with just the donation router
  function buildTestApp() {
    const testApp = express();
    testApp.use(express.json());

    // Attach a minimal req.user so checkPermission passes for guest role
    testApp.use((req, _res, next) => {
      req.user = { role: 'guest', id: 'test-guest' };
      next();
    });

    // Mount only the donation router
    const donationRouter = require('../src/routes/donation');
    testApp.use('/donations', donationRouter);

    // Simple error handler
    testApp.use((err, _req, res, _next) => {
      const status = err.statusCode || err.status || 500;
      res.status(status).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
    });

    return testApp;
  }

  let testApp;
  let donationId;
  let pseudonymousId;

  beforeAll(async () => {
    clearDb();
    testApp = buildTestApp();

    // Create an anonymous donation directly via the service
    const service = makeDonationService();
    const tx = await service.createDonationRecord({
      amount: 5,
      donor: WALLET_A,
      recipient: RECIPIENT,
      anonymous: true,
    });
    donationId = tx.id;
    pseudonymousId = tx.pseudonymousId;
  });

  afterAll(clearDb);

  test('returns 400 when donationId is missing', async () => {
    const res = await request(testApp)
      .get('/donations/verify-anonymous')
      .query({ walletAddress: WALLET_A });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_REQUIRED_FIELDS');
  });

  test('returns 400 when walletAddress is missing', async () => {
    const res = await request(testApp)
      .get('/donations/verify-anonymous')
      .query({ donationId });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_REQUIRED_FIELDS');
  });

  test('returns verified=true for correct wallet address', async () => {
    const res = await request(testApp)
      .get('/donations/verify-anonymous')
      .query({ donationId, walletAddress: WALLET_A });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(true);
    expect(res.body.data.donationId).toBe(donationId);
    expect(res.body.data.pseudonymousId).toBe(pseudonymousId);
  });

  test('returns verified=false for wrong wallet address', async () => {
    const res = await request(testApp)
      .get('/donations/verify-anonymous')
      .query({ donationId, walletAddress: WALLET_B });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verified).toBe(false);
  });

  test('returns 404 for unknown donation ID', async () => {
    const res = await request(testApp)
      .get('/donations/verify-anonymous')
      .query({ donationId: 'does-not-exist', walletAddress: WALLET_A });

    expect(res.status).toBe(404);
  });
});
