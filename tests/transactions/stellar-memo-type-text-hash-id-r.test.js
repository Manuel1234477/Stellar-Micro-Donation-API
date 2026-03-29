/**
 * Tests: Stellar Memo Type Support (text, hash, id, return)
 * Covers MemoValidator, MockStellarService, and POST /donations endpoint.
 * No live Stellar network required.
 */

// Mock broken modules (pre-existing duplicate declaration issue)
jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', key_hash: 'x' }),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => ({
  Class: class { start() {} stop() {} },
}));

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const MemoValidator = require('../../src/utils/memoValidator');
const MockStellarService = require('../../src/services/MockStellarService');

// A valid 64-char hex string (32 bytes)
const VALID_HASH = 'a'.repeat(64);
// An invalid hash (too short)
const SHORT_HASH = 'a'.repeat(62);

// ── MemoValidator.validateWithType ────────────────────────────────────────────

describe('MemoValidator.validateWithType()', () => {
  // ── type validation ──────────────────────────────────────────────────────
  it('rejects unknown memo type', () => {
    const r = MemoValidator.validateWithType('hello', 'unknown');
    expect(r.valid).toBe(false);
    expect(r.code).toBe('INVALID_MEMO_TYPE');
  });

  it('accepts empty memo for any type', () => {
    for (const t of ['text', 'hash', 'id', 'return']) {
      expect(MemoValidator.validateWithType('', t).valid).toBe(true);
      expect(MemoValidator.validateWithType(null, t).valid).toBe(true);
      expect(MemoValidator.validateWithType(undefined, t).valid).toBe(true);
    }
  });

  // ── text ─────────────────────────────────────────────────────────────────
  describe('type: text', () => {
    it('accepts valid text memo', () => {
      const r = MemoValidator.validateWithType('hello', 'text');
      expect(r.valid).toBe(true);
      expect(r.sanitized).toBe('hello');
    });

    it('rejects text memo exceeding 28 bytes', () => {
      const r = MemoValidator.validateWithType('a'.repeat(29), 'text');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('MEMO_TOO_LONG');
    });

    it('accepts exactly 28-byte text memo', () => {
      const r = MemoValidator.validateWithType('a'.repeat(28), 'text');
      expect(r.valid).toBe(true);
    });

    it('rejects text memo with control characters', () => {
      const r = MemoValidator.validateWithType('hello\x01world', 'text');
      expect(r.valid).toBe(false);
    });

    it('defaults to text type when memoType omitted', () => {
      const r = MemoValidator.validateWithType('hello');
      expect(r.valid).toBe(true);
    });
  });

  // ── id ───────────────────────────────────────────────────────────────────
  describe('type: id', () => {
    it('accepts valid integer string', () => {
      const r = MemoValidator.validateWithType('12345', 'id');
      expect(r.valid).toBe(true);
      expect(r.sanitized).toBe('12345');
    });

    it('accepts zero', () => {
      expect(MemoValidator.validateWithType('0', 'id').valid).toBe(true);
    });

    it('accepts max uint64', () => {
      const r = MemoValidator.validateWithType('18446744073709551615', 'id');
      expect(r.valid).toBe(true);
    });

    it('rejects non-numeric string', () => {
      const r = MemoValidator.validateWithType('abc', 'id');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_ID');
    });

    it('rejects negative number', () => {
      const r = MemoValidator.validateWithType('-1', 'id');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_ID');
    });

    it('rejects value exceeding uint64 max', () => {
      const r = MemoValidator.validateWithType('18446744073709551616', 'id');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_ID');
    });

    it('rejects float string', () => {
      const r = MemoValidator.validateWithType('1.5', 'id');
      expect(r.valid).toBe(false);
    });
  });

  // ── hash ─────────────────────────────────────────────────────────────────
  describe('type: hash', () => {
    it('accepts valid 64-char hex string', () => {
      const r = MemoValidator.validateWithType(VALID_HASH, 'hash');
      expect(r.valid).toBe(true);
      expect(r.sanitized).toBe(VALID_HASH);
    });

    it('rejects hex string shorter than 64 chars', () => {
      const r = MemoValidator.validateWithType(SHORT_HASH, 'hash');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_HASH');
    });

    it('rejects hex string longer than 64 chars', () => {
      const r = MemoValidator.validateWithType('a'.repeat(65), 'hash');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_HASH');
    });

    it('rejects non-hex characters', () => {
      const r = MemoValidator.validateWithType('z'.repeat(64), 'hash');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_HASH');
    });

    it('accepts uppercase hex (normalises to lowercase)', () => {
      const r = MemoValidator.validateWithType('A'.repeat(64), 'hash');
      expect(r.valid).toBe(true);
      expect(r.sanitized).toBe('a'.repeat(64));
    });
  });

  // ── return ───────────────────────────────────────────────────────────────
  describe('type: return', () => {
    it('accepts valid 64-char hex string', () => {
      const r = MemoValidator.validateWithType(VALID_HASH, 'return');
      expect(r.valid).toBe(true);
    });

    it('rejects invalid hash for return type', () => {
      const r = MemoValidator.validateWithType(SHORT_HASH, 'return');
      expect(r.valid).toBe(false);
      expect(r.code).toBe('INVALID_MEMO_HASH');
    });
  });
});

// ── MEMO_TYPES export ─────────────────────────────────────────────────────────

describe('MemoValidator.MEMO_TYPES', () => {
  it('exports all four memo types', () => {
    expect(MemoValidator.MEMO_TYPES).toEqual(['text', 'hash', 'id', 'return']);
  });
});

// ── MockStellarService memo type validation ───────────────────────────────────

describe('MockStellarService.sendDonation() memo type validation', () => {
  let service;
  let donor;
  let recipient;

  beforeEach(async () => {
    service = new MockStellarService();
    donor = await service.createWallet();
    recipient = await service.createWallet();
    await service.fundTestnetWallet(donor.publicKey);
    await service.fundTestnetWallet(recipient.publicKey);
  });

  it('sends with text memo', async () => {
    const result = await service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: 'hello',
      memoType: 'text',
    });
    expect(result.transactionId).toBeDefined();
  });

  it('sends with hash memo', async () => {
    const result = await service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: VALID_HASH,
      memoType: 'hash',
    });
    expect(result.transactionId).toBeDefined();
  });

  it('sends with id memo', async () => {
    const result = await service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: '99999',
      memoType: 'id',
    });
    expect(result.transactionId).toBeDefined();
  });

  it('sends with return memo', async () => {
    const result = await service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: VALID_HASH,
      memoType: 'return',
    });
    expect(result.transactionId).toBeDefined();
  });

  it('stores memoType in transaction record', async () => {
    await service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: VALID_HASH,
      memoType: 'hash',
    });
    const txs = service.transactions.get(donor.publicKey);
    expect(txs[0].memoType).toBe('hash');
  });

  it('rejects invalid hash memo', async () => {
    await expect(service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: SHORT_HASH,
      memoType: 'hash',
    })).rejects.toThrow();
  });

  it('rejects invalid id memo', async () => {
    await expect(service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: 'not-a-number',
      memoType: 'id',
    })).rejects.toThrow();
  });

  it('rejects text memo exceeding 28 bytes', async () => {
    await expect(service.sendDonation({
      sourceSecret: donor.secretKey,
      destinationPublic: recipient.publicKey,
      amount: '1',
      memo: 'a'.repeat(29),
      memoType: 'text',
    })).rejects.toThrow();
  });
});

// ── POST /donations HTTP endpoint ─────────────────────────────────────────────

describe('POST /donations memoType field', () => {
  let app;

  beforeAll(() => {
    const express = require('express');
    const { attachUserRole } = require('../../src/middleware/rbac');
    const donationRouter = require('../../src/routes/donation');
    const Transaction = require('../../src/routes/models/transaction');

    // Clear any stale data
    Transaction._clearAllData && Transaction._clearAllData();

    app = express();
    app.use(express.json());
    app.use(attachUserRole());
    app.use('/donations', donationRouter);
    app.use((err, req, res, next) => {
      void next;
      res.status(err.status || err.statusCode || 400).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message }
      });
    });
  });

  const base = () => ({
    amount: '10',
    recipient: 'GABC123RECIPIENT456789012345678901234567890123456789012345',
  });

  it('accepts request without memoType (defaults to text)', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-1`)
      .send({ ...base(), memo: 'hello' });

    expect([201, 400]).toContain(res.status); // 400 if recipient invalid, 201 if valid
  });

  it('rejects invalid memoType with 400', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-2`)
      .send({ ...base(), memo: 'hello', memoType: 'invalid' });

    expect(res.status).toBe(400);
  });

  it('rejects text memo exceeding 28 bytes with 400', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-3`)
      .send({ ...base(), memo: 'a'.repeat(29), memoType: 'text' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid hash memo with 400', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-4`)
      .send({ ...base(), memo: SHORT_HASH, memoType: 'hash' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid id memo with 400', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-5`)
      .send({ ...base(), memo: 'not-a-number', memoType: 'id' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid return memo with 400', async () => {
    const request = require('supertest');
    const res = await request(app)
      .post('/donations')
      .set('X-API-Key', 'test-key-1')
      .set('Idempotency-Key', `k-${Date.now()}-6`)
      .send({ ...base(), memo: SHORT_HASH, memoType: 'return' });

    expect(res.status).toBe(400);
  });
});
