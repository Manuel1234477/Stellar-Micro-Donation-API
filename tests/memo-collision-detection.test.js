/**
 * Tests for Memo Collision Detection
 *
 * Covers:
 *  - MemoCollisionDetector unit tests (no collision, collision, suspicious flags)
 *  - Secondary validation: different donor, amount mismatch, session ID mismatch
 *  - Empty/null memo passthrough
 *  - Window expiry (stale entries not counted)
 *  - Cleanup behaviour
 *  - DonationService integration (memoCollision fields on transaction)
 *  - GET /stats/memo-collisions endpoint
 */

const { MemoCollisionDetector, DEFAULTS } = require('../src/utils/memoCollisionDetector');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDetector(windowMs = 60000) {
  return new MemoCollisionDetector({ windowMs, cleanupIntervalMs: 999999 });
}

function pay(detector, overrides = {}) {
  return detector.check({
    memo: 'STU-001',
    donor: 'DONOR_A',
    recipient: 'RECIPIENT_X',
    amount: 100,
    sessionId: 'sess-1',
    transactionId: `tx-${Date.now()}`,
    ...overrides,
  });
}

// ─── Unit: no collision ───────────────────────────────────────────────────────

describe('MemoCollisionDetector — no collision', () => {
  it('returns collision=false for the first use of a memo', () => {
    const d = makeDetector();
    const result = pay(d);
    expect(result.collision).toBe(false);
    expect(result.suspicious).toBe(false);
    expect(result.reason).toBeNull();
    expect(result.priorPayments).toEqual([]);
  });

  it('returns collision=false for empty memo', () => {
    const d = makeDetector();
    const result = d.check({ memo: '', donor: 'A', recipient: 'B', amount: 10 });
    expect(result.collision).toBe(false);
  });

  it('returns collision=false for null memo', () => {
    const d = makeDetector();
    const result = d.check({ memo: null, donor: 'A', recipient: 'B', amount: 10 });
    expect(result.collision).toBe(false);
  });

  it('returns collision=false for whitespace-only memo', () => {
    const d = makeDetector();
    const result = d.check({ memo: '   ', donor: 'A', recipient: 'B', amount: 10 });
    expect(result.collision).toBe(false);
  });

  it('treats different memos independently', () => {
    const d = makeDetector();
    pay(d, { memo: 'STU-001' });
    const result = pay(d, { memo: 'STU-002' });
    expect(result.collision).toBe(false);
  });
});

// ─── Unit: collision detected ─────────────────────────────────────────────────

describe('MemoCollisionDetector — collision detected', () => {
  it('detects collision on second use of same memo by same donor', () => {
    const d = makeDetector();
    pay(d);
    const result = pay(d);
    expect(result.collision).toBe(true);
    expect(result.priorPayments).toHaveLength(1);
  });

  it('includes prior payment details in result', () => {
    const d = makeDetector();
    pay(d, { transactionId: 'tx-first' });
    const result = pay(d, { transactionId: 'tx-second' });
    expect(result.priorPayments[0].transactionId).toBe('tx-first');
    expect(result.priorPayments[0].donor).toBe('DONOR_A');
    expect(result.priorPayments[0].amount).toBe(100);
  });

  it('collision is not suspicious when same donor, same amount, same session', () => {
    const d = makeDetector();
    pay(d);
    const result = pay(d); // same donor, amount, sessionId
    expect(result.collision).toBe(true);
    expect(result.suspicious).toBe(false);
    expect(result.reason).toBeNull();
  });
});

// ─── Unit: suspicious flags ───────────────────────────────────────────────────

describe('MemoCollisionDetector — suspicious flags', () => {
  it('flags DIFFERENT_DONOR_SAME_MEMO when donor changes', () => {
    const d = makeDetector();
    pay(d, { donor: 'DONOR_A' });
    const result = pay(d, { donor: 'DONOR_B' });
    expect(result.collision).toBe(true);
    expect(result.suspicious).toBe(true);
    expect(result.reason).toBe('DIFFERENT_DONOR_SAME_MEMO');
  });

  it('flags AMOUNT_MISMATCH when same donor sends different amount', () => {
    const d = makeDetector();
    pay(d, { donor: 'DONOR_A', amount: 100 });
    const result = pay(d, { donor: 'DONOR_A', amount: 200 });
    expect(result.suspicious).toBe(true);
    expect(result.reason).toBe('AMOUNT_MISMATCH');
  });

  it('flags SESSION_ID_MISMATCH when session IDs differ', () => {
    const d = makeDetector();
    pay(d, { donor: 'DONOR_A', amount: 100, sessionId: 'sess-1' });
    const result = pay(d, { donor: 'DONOR_A', amount: 100, sessionId: 'sess-2' });
    expect(result.suspicious).toBe(true);
    expect(result.reason).toBe('SESSION_ID_MISMATCH');
  });

  it('does not flag session mismatch when sessionId is absent', () => {
    const d = makeDetector();
    pay(d, { donor: 'DONOR_A', amount: 100, sessionId: undefined });
    const result = pay(d, { donor: 'DONOR_A', amount: 100, sessionId: undefined });
    expect(result.suspicious).toBe(false);
  });

  it('prioritises DIFFERENT_DONOR over AMOUNT_MISMATCH', () => {
    const d = makeDetector();
    pay(d, { donor: 'DONOR_A', amount: 100 });
    const result = pay(d, { donor: 'DONOR_B', amount: 999 });
    expect(result.reason).toBe('DIFFERENT_DONOR_SAME_MEMO');
  });
});

// ─── Unit: window expiry ──────────────────────────────────────────────────────

describe('MemoCollisionDetector — window expiry', () => {
  it('does not count entries outside the window', () => {
    const d = makeDetector(500); // 500 ms window

    // First payment — recorded
    pay(d);

    // Manually age the stored entry beyond the window
    const stored = d.memoStore.get('STU-001');
    stored[0].timestamp = Date.now() - 600; // 600 ms ago
    d.memoStore.set('STU-001', stored);

    // Second payment — prior entry is stale, should not collide
    const result = pay(d);
    expect(result.collision).toBe(false);
  });
});

// ─── Unit: cleanup ────────────────────────────────────────────────────────────

describe('MemoCollisionDetector — cleanup', () => {
  it('removes fully expired memo entries', () => {
    const d = makeDetector(100);
    pay(d);
    expect(d.memoStore.size).toBe(1);

    // Age the entry
    const stored = d.memoStore.get('STU-001');
    stored[0].timestamp = Date.now() - 200;
    d.memoStore.set('STU-001', stored);

    d.cleanup();
    expect(d.memoStore.size).toBe(0);
  });

  it('keeps entries still within the window', () => {
    const d = makeDetector(60000);
    pay(d);
    d.cleanup();
    expect(d.memoStore.size).toBe(1);
  });
});

// ─── Unit: getStats ───────────────────────────────────────────────────────────

describe('MemoCollisionDetector — getStats', () => {
  it('returns trackedMemos count and windowMs', () => {
    const d = makeDetector(30000);
    pay(d, { memo: 'A' });
    pay(d, { memo: 'B' });
    const stats = d.getStats();
    expect(stats.trackedMemos).toBe(2);
    expect(stats.windowMs).toBe(30000);
  });
});

// ─── Unit: DEFAULTS export ────────────────────────────────────────────────────

describe('DEFAULTS', () => {
  it('exports expected default values', () => {
    expect(typeof DEFAULTS.windowMs).toBe('number');
    expect(DEFAULTS.windowMs).toBeGreaterThan(0);
    expect(typeof DEFAULTS.cleanupIntervalMs).toBe('number');
  });
});

// ─── Integration: DonationService ────────────────────────────────────────────

describe('DonationService — memo collision fields', () => {
  const path = require('path');
  const os = require('os');
  const fs = require('fs');

  let DonationService;
  let MockStellarService;
  let detector;

  beforeEach(() => {
    jest.resetModules();
    process.env.DB_JSON_PATH = path.join(os.tmpdir(), `memo-col-${Date.now()}.json`);
    process.env.NODE_ENV = 'test';

    DonationService = require('../src/services/DonationService');
    MockStellarService = { sendDonation: jest.fn(), verifyTransaction: jest.fn() };

    // Reset the singleton detector between tests
    const mod = require('../src/utils/memoCollisionDetector');
    mod.memoStore = new Map();
  });

  afterEach(() => {
    try { fs.unlinkSync(process.env.DB_JSON_PATH); } catch (_) {}
  });

  const DONOR_A = 'GDONORAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const DONOR_B = 'GDONORBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const RECIP   = 'GRECIPIENTBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  it('sets memoCollision=false on first use of a memo', async () => {
    const service = new DonationService(MockStellarService);
    const tx = await service.createDonationRecord({
      amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-100',
    });
    expect(tx.memoCollision).toBe(false);
    expect(tx.memoSuspicious).toBe(false);
    expect(tx.memoCollisionReason).toBeNull();
  });

  it('sets memoCollision=true on second use of same memo by same donor', async () => {
    const service = new DonationService(MockStellarService);
    await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-200' });
    const tx2 = await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-200' });
    expect(tx2.memoCollision).toBe(true);
    expect(tx2.memoSuspicious).toBe(false);
  });

  it('sets memoSuspicious=true when different donor reuses memo', async () => {
    const service = new DonationService(MockStellarService);
    await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-300' });
    const tx2 = await service.createDonationRecord({ amount: 10, donor: DONOR_B, recipient: RECIP, memo: 'STU-300' });
    expect(tx2.memoCollision).toBe(true);
    expect(tx2.memoSuspicious).toBe(true);
    expect(tx2.memoCollisionReason).toBe('DIFFERENT_DONOR_SAME_MEMO');
  });

  it('sets memoSuspicious=true on session ID mismatch', async () => {
    const service = new DonationService(MockStellarService);
    await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-400', sessionId: 'sess-1' });
    const tx2 = await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP, memo: 'STU-400', sessionId: 'sess-2' });
    expect(tx2.memoSuspicious).toBe(true);
    expect(tx2.memoCollisionReason).toBe('SESSION_ID_MISMATCH');
  });

  it('does not affect transactions with empty memo', async () => {
    const service = new DonationService(MockStellarService);
    const tx = await service.createDonationRecord({ amount: 10, donor: DONOR_A, recipient: RECIP });
    expect(tx.memoCollision).toBe(false);
  });
});

// ─── Integration: GET /stats/memo-collisions ─────────────────────────────────

describe('GET /stats/memo-collisions', () => {
  const request = require('supertest');
  const path = require('path');
  const os = require('os');
  const fs = require('fs');

  let app;
  let tmpDb;

  beforeEach(() => {
    jest.resetModules();
    tmpDb = path.join(os.tmpdir(), `memo-stats-${Date.now()}.json`);
    process.env.DB_JSON_PATH = tmpDb;
    process.env.NODE_ENV = 'test';
    app = require('../src/routes/app');
  });

  afterEach(() => {
    try { fs.unlinkSync(tmpDb); } catch (_) {}
  });

  it('returns 200 with empty data when no collisions exist', async () => {
    const res = await request(app)
      .get('/stats/memo-collisions')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCollisions).toBe(0);
    expect(res.body.data.totalSuspicious).toBe(0);
    expect(res.body.data.transactions).toEqual([]);
  });

  it('returns flagged collision transactions', async () => {
    const tx = {
      id: 'col-1', memo: 'STU-001', donor: 'DONOR_B', recipient: 'REC',
      amount: 10, timestamp: new Date().toISOString(), status: 'pending',
      memoCollision: true, memoSuspicious: true, memoCollisionReason: 'DIFFERENT_DONOR_SAME_MEMO',
    };
    fs.writeFileSync(tmpDb, JSON.stringify([tx], null, 2));

    const res = await request(app)
      .get('/stats/memo-collisions')
      .set('x-api-key', 'test-key');

    expect(res.body.data.totalCollisions).toBe(1);
    expect(res.body.data.totalSuspicious).toBe(1);
    expect(res.body.data.transactions[0].id).toBe('col-1');
    expect(res.body.data.transactions[0].memoCollisionReason).toBe('DIFFERENT_DONOR_SAME_MEMO');
  });

  it('excludes non-collision transactions', async () => {
    const txs = [
      { id: 'ok-1', memo: 'STU-002', donor: 'A', recipient: 'B', amount: 5, timestamp: new Date().toISOString(), status: 'pending', memoCollision: false },
      { id: 'col-2', memo: 'STU-003', donor: 'C', recipient: 'D', amount: 5, timestamp: new Date().toISOString(), status: 'pending', memoCollision: true, memoSuspicious: false, memoCollisionReason: null },
    ];
    fs.writeFileSync(tmpDb, JSON.stringify(txs, null, 2));

    const res = await request(app)
      .get('/stats/memo-collisions')
      .set('x-api-key', 'test-key');

    expect(res.body.data.totalCollisions).toBe(1);
    expect(res.body.data.transactions[0].id).toBe('col-2');
  });

  it('filters by date range', async () => {
    const old = new Date('2024-01-01T00:00:00Z').toISOString();
    const recent = new Date().toISOString();
    const txs = [
      { id: 'old', memo: 'M', donor: 'A', recipient: 'B', amount: 1, timestamp: old, status: 'pending', memoCollision: true, memoSuspicious: false, memoCollisionReason: null },
      { id: 'new', memo: 'M', donor: 'A', recipient: 'B', amount: 1, timestamp: recent, status: 'pending', memoCollision: true, memoSuspicious: false, memoCollisionReason: null },
    ];
    fs.writeFileSync(tmpDb, JSON.stringify(txs, null, 2));

    const res = await request(app)
      .get('/stats/memo-collisions?startDate=2025-01-01')
      .set('x-api-key', 'test-key');

    expect(res.body.data.totalCollisions).toBe(1);
    expect(res.body.data.transactions[0].id).toBe('new');
  });

  it('returns 400 for invalid startDate', async () => {
    const res = await request(app)
      .get('/stats/memo-collisions?startDate=bad-date')
      .set('x-api-key', 'test-key');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE');
  });

  it('returns 400 when startDate is after endDate', async () => {
    const res = await request(app)
      .get('/stats/memo-collisions?startDate=2026-12-01&endDate=2026-01-01')
      .set('x-api-key', 'test-key');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_DATE_RANGE');
  });

  it('includes metadata note in response', async () => {
    const res = await request(app)
      .get('/stats/memo-collisions')
      .set('x-api-key', 'test-key');
    expect(res.body.metadata.note).toBeDefined();
  });
});
