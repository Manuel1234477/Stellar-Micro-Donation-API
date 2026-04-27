'use strict';

/**
 * Tests: Stellar Claimable Balance Support
 *
 * Covers:
 *  MockStellarService:
 *   - createClaimableBalance: success, balance deduction, storage, multiple claimants,
 *     predicate storage, insufficient balance, empty claimants, >10 claimants, unknown source
 *   - claimBalance: success, balance credit, double-claim, not found, ineligible claimant,
 *     notBefore, notAfter, valid time window, unactivated account auto-creation, _clearAllData
 *
 *  POST /donations/claimable:
 *   - 201 success, balanceId stored in transaction records, 401 no key,
 *     400 empty claimants, 400 missing amount, 400 missing secret,
 *     predicate passthrough, insufficient balance error
 *
 *  POST /donations/claimable/:id/claim:
 *   - 200 success, 401 no key, 400 missing secret, double-claim error,
 *     not-found error, ineligible claimant error, expired balance error
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-claimable';

// Mock AuditLogService before any requires to prevent unhandled DB rejections
jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { AUTHENTICATION: 'AUTHENTICATION', DONATION: 'DONATION' },
  ACTION: {
    API_KEY_VALIDATION_FAILED: 'API_KEY_VALIDATION_FAILED',
    API_KEY_VALIDATED: 'API_KEY_VALIDATED',
  },
  SEVERITY: { HIGH: 'HIGH', LOW: 'LOW', MEDIUM: 'MEDIUM' },
}));

const request = require('supertest');
const express = require('express');
const MockStellarService = require('../../src/services/MockStellarService');
const { attachUserRole } = require('../../src/middleware/rbac');
const { getStellarService } = require('../../src/config/stellar');
const donationRouter = require('../../src/routes/donation');
const Transaction = require('../../src/routes/models/transaction');

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function makeFundedWallet(svc, balance = '100.0000000') {
  const w = await svc.createWallet();
  svc.wallets.get(w.publicKey).balance = balance;
  return w;
}

// ─── MockStellarService unit tests ───────────────────────────────────────────

describe('MockStellarService — createClaimableBalance', () => {
  let svc, source;

  beforeEach(async () => {
    svc = new MockStellarService({ strictValidation: false });
    source = await makeFundedWallet(svc);
  });

  it('returns balanceId, transactionId, and ledger', async () => {
    const r = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '10',
      claimants: [{ destination: source.publicKey }],
    });
    expect(r.balanceId).toBeDefined();
    expect(r.transactionId).toBeDefined();
    expect(r.ledger).toBeGreaterThan(0);
  });

  it('deducts amount from source balance', async () => {
    await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '25',
      claimants: [{ destination: source.publicKey }],
    });
    expect(parseFloat(svc.wallets.get(source.publicKey).balance)).toBeCloseTo(75, 4);
  });

  it('stores balance as unclaimed in internal map', async () => {
    const { balanceId } = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '5',
      claimants: [{ destination: source.publicKey }],
    });
    expect(svc.claimableBalances.get(balanceId).claimed).toBe(false);
  });

  it('supports multiple claimants', async () => {
    const w2 = await makeFundedWallet(svc);
    const { balanceId } = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '5',
      claimants: [{ destination: source.publicKey }, { destination: w2.publicKey }],
    });
    expect(svc.claimableBalances.get(balanceId).claimants).toHaveLength(2);
  });

  it('stores predicate on the balance', async () => {
    const notAfter = Date.now() + 60000;
    const { balanceId } = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '5',
      claimants: [{ destination: source.publicKey }],
      predicate: { notAfter },
    });
    expect(svc.claimableBalances.get(balanceId).predicate.notAfter).toBe(notAfter);
  });

  it('throws on insufficient balance', async () => {
    await expect(
      svc.createClaimableBalance({
        sourceSecret: source.secretKey,
        amount: '999',
        claimants: [{ destination: source.publicKey }],
      })
    ).rejects.toThrow('Insufficient balance');
  });

  it('throws when claimants array is empty', async () => {
    await expect(
      svc.createClaimableBalance({ sourceSecret: source.secretKey, amount: '5', claimants: [] })
    ).rejects.toThrow('At least one claimant');
  });

  it('throws when more than 10 claimants', async () => {
    const claimants = Array.from({ length: 11 }, () => ({ destination: source.publicKey }));
    await expect(
      svc.createClaimableBalance({ sourceSecret: source.secretKey, amount: '5', claimants })
    ).rejects.toThrow('Maximum 10 claimants');
  });

  it('throws when source account does not exist', async () => {
    const fresh = new MockStellarService({ strictValidation: false });
    const fakeSecret = 'SDZHRQXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQ';
    await expect(
      fresh.createClaimableBalance({
        sourceSecret: fakeSecret,
        amount: '5',
        claimants: [{ destination: source.publicKey }],
      })
    ).rejects.toThrow();
  });
});

describe('MockStellarService — claimBalance', () => {
  let svc, source, claimant;

  beforeEach(async () => {
    svc = new MockStellarService({ strictValidation: false });
    source = await makeFundedWallet(svc);
    claimant = await makeFundedWallet(svc, '1.0000000');
  });

  async function makeBalance(opts = {}) {
    return svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: opts.amount || '10',
      claimants: opts.claimants || [{ destination: claimant.publicKey }],
      predicate: opts.predicate || null,
    });
  }

  it('returns transactionId, ledger, and amount', async () => {
    const { balanceId } = await makeBalance();
    const r = await svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey });
    expect(r.transactionId).toBeDefined();
    expect(r.ledger).toBeGreaterThan(0);
    expect(r.amount).toBe('10');
  });

  it('credits the claimant wallet', async () => {
    const { balanceId } = await makeBalance();
    await svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey });
    expect(parseFloat(svc.wallets.get(claimant.publicKey).balance)).toBeCloseTo(11, 4);
  });

  it('marks the balance as claimed', async () => {
    const { balanceId } = await makeBalance();
    await svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey });
    expect(svc.claimableBalances.get(balanceId).claimed).toBe(true);
    expect(svc.claimableBalances.get(balanceId).claimedBy).toBe(claimant.publicKey);
  });

  it('throws on double-claim', async () => {
    const { balanceId } = await makeBalance();
    await svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey });
    await expect(
      svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey })
    ).rejects.toThrow('already been claimed');
  });

  it('throws when balance not found', async () => {
    await expect(
      svc.claimBalance({ balanceId: 'nonexistent', claimantSecret: claimant.secretKey })
    ).rejects.toThrow('not found');
  });

  it('throws when claimant is not eligible', async () => {
    const other = await makeFundedWallet(svc);
    const { balanceId } = await makeBalance();
    await expect(
      svc.claimBalance({ balanceId, claimantSecret: other.secretKey })
    ).rejects.toThrow('not an eligible claimant');
  });

  it('throws when notBefore condition is not yet met', async () => {
    const { balanceId } = await makeBalance({ predicate: { notBefore: Date.now() + 60000 } });
    await expect(
      svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey })
    ).rejects.toThrow('not yet available');
  });

  it('throws when notAfter condition has passed', async () => {
    const { balanceId } = await makeBalance({ predicate: { notAfter: Date.now() - 1 } });
    await expect(
      svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey })
    ).rejects.toThrow('expired');
  });

  it('succeeds when notBefore is past and notAfter is future', async () => {
    const { balanceId } = await makeBalance({
      predicate: { notBefore: Date.now() - 60000, notAfter: Date.now() + 60000 },
    });
    const r = await svc.claimBalance({ balanceId, claimantSecret: claimant.secretKey });
    expect(r.transactionId).toBeDefined();
  });

  it('auto-creates wallet for unactivated claimant account', async () => {
    const newSecret = 'SNEWACCOUNTSECRETXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZXQZX';
    const newPublic = svc._secretToPublic(newSecret);
    const { balanceId } = await makeBalance({ claimants: [{ destination: newPublic }] });
    expect(svc.wallets.has(newPublic)).toBe(false);
    await svc.claimBalance({ balanceId, claimantSecret: newSecret });
    expect(svc.wallets.has(newPublic)).toBe(true);
    expect(parseFloat(svc.wallets.get(newPublic).balance)).toBeCloseTo(10, 4);
  });

  it('_clearAllData also clears claimable balances', async () => {
    await makeBalance();
    svc._clearAllData();
    expect(svc.claimableBalances.size).toBe(0);
  });
});

// ─── HTTP route tests ─────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(attachUserRole());
  app.use('/donations', donationRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({
      success: false,
      error: { code: err.errorCode || err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

describe('POST /donations/claimable', () => {
  let svc, app, source;

  beforeEach(async () => {
    svc = getStellarService();
    svc._clearAllData();
    Transaction._clearAllData();
    source = await makeFundedWallet(svc);
    app = buildApp();
  });

  it('returns 201 with balanceId on success', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ sourceSecret: source.secretKey, amount: '10', claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.balanceId).toBeDefined();
    expect(res.body.data.transactionId).toBeDefined();
  });

  it('stores balanceId in transaction records', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ sourceSecret: source.secretKey, amount: '10', claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBe(201);
    const all = Transaction.getAll();
    const stored = all.find(t => t.balanceId === res.body.data.balanceId);
    expect(stored).toBeDefined();
    expect(stored.type).toBe('claimable');
    expect(stored.stellarTxId).toBe(res.body.data.transactionId);
  });

  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .send({ sourceSecret: source.secretKey, amount: '10', claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBe(401);
  });

  it('returns 400 when claimants is empty array', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ sourceSecret: source.secretKey, amount: '10', claimants: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is missing', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ sourceSecret: source.secretKey, claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when sourceSecret is missing', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ amount: '10', claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBe(400);
  });

  it('passes predicate through to the service', async () => {
    const notAfter = Date.now() + 3600000;
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({
        sourceSecret: source.secretKey,
        amount: '5',
        claimants: [{ destination: source.publicKey }],
        predicate: { notAfter },
      });
    expect(res.status).toBe(201);
    expect(svc.claimableBalances.get(res.body.data.balanceId).predicate.notAfter).toBe(notAfter);
  });

  it('returns error when insufficient balance', async () => {
    const res = await request(app)
      .post('/donations/claimable')
      .set('x-api-key', 'test-key-claimable')
      .send({ sourceSecret: source.secretKey, amount: '9999', claimants: [{ destination: source.publicKey }] });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /donations/claimable/:id/claim', () => {
  let svc, app, source, claimant, balanceId;

  beforeEach(async () => {
    svc = getStellarService();
    svc._clearAllData();
    Transaction._clearAllData();
    source = await makeFundedWallet(svc);
    claimant = await makeFundedWallet(svc, '1.0000000');
    app = buildApp();

    const r = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '10',
      claimants: [{ destination: claimant.publicKey }],
    });
    balanceId = r.balanceId;
  });

  it('returns 200 with transactionId on success', async () => {
    const res = await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: claimant.secretKey });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.transactionId).toBeDefined();
  });

  it('returns 401 without API key', async () => {
    const res = await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .send({ claimantSecret: claimant.secretKey });
    expect(res.status).toBe(401);
  });

  it('returns 400 when claimantSecret is missing', async () => {
    const res = await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns error on double-claim', async () => {
    await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: claimant.secretKey });
    const res = await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: claimant.secretKey });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('returns error for non-existent balance ID', async () => {
    const res = await request(app)
      .post('/donations/claimable/nonexistent-id/claim')
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: claimant.secretKey });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('returns error when claimant is not eligible', async () => {
    const other = await makeFundedWallet(svc);
    const res = await request(app)
      .post(`/donations/claimable/${balanceId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: other.secretKey });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });

  it('returns error when balance has expired', async () => {
    const { balanceId: expiredId } = await svc.createClaimableBalance({
      sourceSecret: source.secretKey,
      amount: '5',
      claimants: [{ destination: claimant.publicKey }],
      predicate: { notAfter: Date.now() - 1 },
    });
    const res = await request(app)
      .post(`/donations/claimable/${expiredId}/claim`)
      .set('x-api-key', 'test-key-claimable')
      .send({ claimantSecret: claimant.secretKey });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.success).toBe(false);
  });
});
