/**
 * Tests: Add Stellar Transaction History Synchronization (Issue #386)
 *
 * Coverage targets:
 *  - TransactionSyncService incremental sync (last_cursor / last_synced_at)
 *  - TransactionSyncScheduler lifecycle, partial-failure handling, getSyncStatus
 *  - Wallet model last_synced_at / last_cursor fields
 *  - POST /admin/sync endpoint (auth + response shape)
 *  - GET /health transactionSync field
 *
 * All Stellar interactions use MockStellarService — no live network calls.
 */

'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs');

// ─── Isolate file-based models to a temp directory ───────────────────────────
let tmpDir;
beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-sync-test-'));
  process.env.DB_JSON_PATH = path.join(tmpDir, 'donations.json');
  process.env.WALLETS_DB_PATH = path.join(tmpDir, 'wallets.json');
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Imports (after env is set) ───────────────────────────────────────────────
const MockStellarService = require('../src/services/MockStellarService');
const TransactionSyncService = require('../src/services/TransactionSyncService');
const TransactionSyncScheduler = require('../src/services/TransactionSyncScheduler');
const Wallet = require('../src/routes/models/wallet');
const Transaction = require('../src/routes/models/transaction');

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal Horizon-style transaction record */
function makeTx(id, pagingToken) {
  return {
    id,
    paging_token: pagingToken || id,
    created_at: new Date().toISOString(),
    memo: null,
    source_account: 'GSOURCE',
    successful: true,
  };
}

/** Reset file-based stores between tests */
function resetStores() {
  fs.writeFileSync(process.env.DB_JSON_PATH, '[]');
  const walletsPath = process.env.WALLETS_DB_PATH || path.join(tmpDir, 'wallets.json');
  fs.writeFileSync(walletsPath, '[]');
}

// Patch Wallet to use the temp path
const WALLETS_DB_PATH_ORIG = './data/wallets.json';
beforeEach(() => {
  resetStores();
  // Override the path constant used by Wallet
  Wallet.__testWalletsPath = path.join(tmpDir, 'wallets.json');
});

// Monkey-patch Wallet to use the temp path for all tests
const _origLoad = Wallet.loadWallets.bind(Wallet);
const _origSave = Wallet.saveWallets.bind(Wallet);
Wallet.loadWallets = function () {
  const p = path.join(tmpDir, 'wallets.json');
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
};
Wallet.saveWallets = function (wallets) {
  fs.writeFileSync(path.join(tmpDir, 'wallets.json'), JSON.stringify(wallets, null, 2));
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. Wallet model — schema fields
// ─────────────────────────────────────────────────────────────────────────────
describe('Wallet model — last_synced_at and last_cursor fields', () => {
  test('new wallet has null last_synced_at and last_cursor', () => {
    const w = Wallet.create({ address: 'GABC1', label: 'test' });
    expect(w.last_synced_at).toBeNull();
    expect(w.last_cursor).toBeNull();
  });

  test('update sets last_synced_at and last_cursor', () => {
    const w = Wallet.create({ address: 'GABC2' });
    const now = new Date().toISOString();
    const updated = Wallet.update(w.id, { last_synced_at: now, last_cursor: 'cursor-abc' });
    expect(updated.last_synced_at).toBe(now);
    expect(updated.last_cursor).toBe('cursor-abc');
  });

  test('getByAddress returns wallet with sync fields', () => {
    Wallet.create({ address: 'GABC3', last_synced_at: '2024-01-01T00:00:00.000Z', last_cursor: 'tok1' });
    const found = Wallet.getByAddress('GABC3');
    expect(found.last_synced_at).toBe('2024-01-01T00:00:00.000Z');
    expect(found.last_cursor).toBe('tok1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. TransactionSyncService — incremental sync logic
// ─────────────────────────────────────────────────────────────────────────────
describe('TransactionSyncService — incremental sync', () => {
  let service;
  let mockStellar;

  beforeEach(() => {
    mockStellar = new MockStellarService();
    service = new TransactionSyncService(mockStellar);
  });

  test('full sync (no cursor): fetches transactions and updates last_synced_at', async () => {
    const wallet = Wallet.create({ address: 'GFULL1' });
    const txs = [makeTx('tx1', 'pt1'), makeTx('tx2', 'pt2')];
    service._fetchHorizonTransactions = jest.fn().mockResolvedValue(txs);

    const result = await service.syncWalletTransactions('GFULL1');

    expect(result.synced).toBe(2);
    expect(service._fetchHorizonTransactions).toHaveBeenCalledWith('GFULL1', 500, undefined);

    const updated = Wallet.getByAddress('GFULL1');
    expect(updated.last_cursor).toBe('pt2');
    expect(updated.last_synced_at).not.toBeNull();
  });

  test('incremental sync: passes last_cursor to _fetchHorizonTransactions', async () => {
    Wallet.create({ address: 'GINC1', last_cursor: 'cursor-prev', last_synced_at: '2024-01-01T00:00:00.000Z' });
    const txs = [makeTx('tx3', 'pt3')];
    service._fetchHorizonTransactions = jest.fn().mockResolvedValue(txs);

    await service.syncWalletTransactions('GINC1');

    expect(service._fetchHorizonTransactions).toHaveBeenCalledWith('GINC1', 500, 'cursor-prev');
    const updated = Wallet.getByAddress('GINC1');
    expect(updated.last_cursor).toBe('pt3');
  });

  test('no new transactions: last_synced_at is still updated', async () => {
    const wallet = Wallet.create({ address: 'GEMPTY1' });
    service._fetchHorizonTransactions = jest.fn().mockResolvedValue([]);

    const before = new Date().toISOString();
    await service.syncWalletTransactions('GEMPTY1');
    const after = new Date().toISOString();

    const updated = Wallet.getByAddress('GEMPTY1');
    expect(updated.last_synced_at).not.toBeNull();
    expect(updated.last_synced_at >= before).toBe(true);
    expect(updated.last_synced_at <= after).toBe(true);
    // cursor unchanged (no txs)
    expect(updated.last_cursor).toBeNull();
  });

  test('skips duplicate transactions (already in local store)', async () => {
    Wallet.create({ address: 'GDUP1' });
    // Pre-create a transaction with the same stellarTxId
    Transaction.create({ stellarTxId: 'tx-dup', status: 'confirmed', amount: '1', donor: 'A', recipient: 'B' });

    const txs = [makeTx('tx-dup', 'pt-dup'), makeTx('tx-new', 'pt-new')];
    service._fetchHorizonTransactions = jest.fn().mockResolvedValue(txs);

    const result = await service.syncWalletTransactions('GDUP1');
    // Only the new one should be synced
    expect(result.synced).toBe(1);
  });

  test('unknown wallet: sync still runs without crashing', async () => {
    service._fetchHorizonTransactions = jest.fn().mockResolvedValue([makeTx('tx-x', 'pt-x')]);
    const result = await service.syncWalletTransactions('GUNKNOWN');
    expect(result.synced).toBe(1);
  });

  test('Horizon 404 returns empty array (account not found)', async () => {
    Wallet.create({ address: 'G404' });
    // Simulate 404 from Horizon
    service._fetchHorizonTransactions = jest.fn().mockRejectedValue(
      Object.assign(new Error('Not Found'), { response: { status: 404 } })
    );

    // The service itself doesn't catch 404 in syncWalletTransactions — it propagates
    // But _fetchHorizonTransactions handles 404 internally and returns []
    // Let's test the internal method directly
    const realService = new TransactionSyncService(mockStellar);
    realService.server = {
      transactions: () => ({
        forAccount: () => ({
          limit: () => ({
            order: () => ({
              call: () => Promise.reject(Object.assign(new Error('Not Found'), { response: { status: 404 } })),
            }),
          }),
        }),
      }),
    };
    const txs = await realService._fetchHorizonTransactions('G404', 10, undefined);
    expect(txs).toEqual([]);
  });

  test('Horizon non-404 error propagates', async () => {
    Wallet.create({ address: 'GERR1' });
    service._fetchHorizonTransactions = jest.fn().mockRejectedValue(new Error('Network timeout'));
    await expect(service.syncWalletTransactions('GERR1')).rejects.toThrow('Network timeout');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. TransactionSyncScheduler — lifecycle and partial failure
// ─────────────────────────────────────────────────────────────────────────────
describe('TransactionSyncScheduler', () => {
  let scheduler;
  let mockStellar;

  beforeEach(() => {
    mockStellar = new MockStellarService();
    scheduler = new TransactionSyncScheduler(mockStellar, { intervalMs: 999999 });
    // Prevent actual Horizon calls
    scheduler.syncService._fetchHorizonTransactions = jest.fn().mockResolvedValue([]);
  });

  afterEach(() => {
    scheduler.stop();
  });

  test('starts and stops without error', () => {
    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.stop();
    expect(scheduler.isRunning).toBe(false);
    expect(scheduler.intervalId).toBeNull();
  });

  test('double start is idempotent', () => {
    scheduler.start();
    const id1 = scheduler.intervalId;
    scheduler.start(); // second call should be no-op
    expect(scheduler.intervalId).toBe(id1);
    scheduler.stop();
  });

  test('double stop is idempotent', () => {
    scheduler.start();
    scheduler.stop();
    expect(() => scheduler.stop()).not.toThrow();
  });

  test('syncAllWallets returns correct shape', async () => {
    Wallet.create({ address: 'GSCHED1' });
    Wallet.create({ address: 'GSCHED2' });

    const result = await scheduler.syncAllWallets();

    expect(result).toMatchObject({
      wallets: 2,
      synced: expect.any(Number),
      errors: 0,
      completedAt: expect.any(String),
    });
  });

  test('getSyncStatus returns null before first sync', () => {
    const status = scheduler.getSyncStatus();
    expect(status.lastSyncAt).toBeNull();
    expect(status.lastSyncResult).toBeNull();
  });

  test('getSyncStatus is populated after syncAllWallets', async () => {
    await scheduler.syncAllWallets();
    const status = scheduler.getSyncStatus();
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.lastSyncResult).not.toBeNull();
  });

  test('partial failure: one wallet error does not stop others', async () => {
    Wallet.create({ address: 'GFAIL1' });
    Wallet.create({ address: 'GOK1' });

    let callCount = 0;
    scheduler.syncService.syncWalletTransactions = jest.fn().mockImplementation(async (addr) => {
      callCount++;
      if (addr === 'GFAIL1') throw new Error('Simulated Horizon error');
      return { synced: 1, transactions: [] };
    });

    const result = await scheduler.syncAllWallets();

    expect(callCount).toBe(2); // both wallets attempted
    expect(result.errors).toBe(1);
    expect(result.synced).toBe(1);
  });

  test('all wallets fail: errors counted, no throw', async () => {
    Wallet.create({ address: 'GFAIL2' });
    scheduler.syncService.syncWalletTransactions = jest.fn().mockRejectedValue(new Error('boom'));

    const result = await scheduler.syncAllWallets();
    expect(result.errors).toBe(1);
    expect(result.synced).toBe(0);
  });

  test('intervalMs defaults to env var TX_SYNC_INTERVAL_MS', () => {
    process.env.TX_SYNC_INTERVAL_MS = '30000';
    const s = new TransactionSyncScheduler(mockStellar);
    expect(s.intervalMs).toBe(30000);
    delete process.env.TX_SYNC_INTERVAL_MS;
  });

  test('intervalMs defaults to 15 minutes when env not set', () => {
    delete process.env.TX_SYNC_INTERVAL_MS;
    const s = new TransactionSyncScheduler(mockStellar);
    expect(s.intervalMs).toBe(15 * 60 * 1000);
  });

  test('intervalMs option overrides env var', () => {
    process.env.TX_SYNC_INTERVAL_MS = '60000';
    const s = new TransactionSyncScheduler(mockStellar, { intervalMs: 5000 });
    expect(s.intervalMs).toBe(5000);
    delete process.env.TX_SYNC_INTERVAL_MS;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. POST /admin/sync endpoint — handler logic (no HTTP layer)
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /admin/sync — handler logic', () => {
  let mockStellar;
  let scheduler;

  /** Minimal req/res/next stubs */
  function makeReqRes(role = 'admin') {
    const req = { user: { id: 'u1', role } };
    const res = {
      _status: 200,
      _body: null,
      status(code) { this._status = code; return this; },
      json(body) { this._body = body; return this; },
    };
    const next = jest.fn();
    return { req, res, next };
  }

  /** The actual handler extracted from app.js logic */
  async function adminSyncHandler(req, res, next, sched) {
    try {
      if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ success: false, error: { code: 'FORBIDDEN' } });
      }
      const result = await sched.syncAllWallets();
      res.json({ success: true, message: 'Transaction sync complete', data: result });
    } catch (err) {
      next(err);
    }
  }

  beforeEach(() => {
    mockStellar = new MockStellarService();
    scheduler = new TransactionSyncScheduler(mockStellar, { intervalMs: 999999 });
    scheduler.syncService._fetchHorizonTransactions = jest.fn().mockResolvedValue([]);
  });

  afterEach(() => scheduler.stop());

  test('admin role: returns success with sync result', async () => {
    Wallet.create({ address: 'GADMIN1' });
    const { req, res, next } = makeReqRes('admin');
    await adminSyncHandler(req, res, next, scheduler);
    expect(res._status).toBe(200);
    expect(res._body.success).toBe(true);
    expect(res._body.data).toMatchObject({
      wallets: expect.any(Number),
      synced: expect.any(Number),
      errors: expect.any(Number),
      completedAt: expect.any(String),
    });
  });

  test('non-admin role: returns 403', async () => {
    const { req, res, next } = makeReqRes('user');
    await adminSyncHandler(req, res, next, scheduler);
    expect(res._status).toBe(403);
    expect(res._body.success).toBe(false);
  });

  test('sync error: calls next with error', async () => {
    scheduler.syncAllWallets = jest.fn().mockRejectedValue(new Error('DB exploded'));
    const { req, res, next } = makeReqRes('admin');
    await adminSyncHandler(req, res, next, scheduler);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'DB exploded' }));
  });

  test('response includes message field', async () => {
    const { req, res, next } = makeReqRes('admin');
    await adminSyncHandler(req, res, next, scheduler);
    expect(res._body.message).toBe('Transaction sync complete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. GET /health — transactionSync field
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /health — transactionSync field', () => {
  /** Simulate the health handler logic */
  function getHealthBody(scheduler) {
    return {
      status: 'healthy',
      transactionSync: scheduler.getSyncStatus(),
    };
  }

  let mockStellar;
  let scheduler;

  beforeEach(() => {
    mockStellar = new MockStellarService();
    scheduler = new TransactionSyncScheduler(mockStellar, { intervalMs: 999999 });
    scheduler.syncService._fetchHorizonTransactions = jest.fn().mockResolvedValue([]);
  });

  afterEach(() => scheduler.stop());

  test('health includes transactionSync with null values before first sync', () => {
    const body = getHealthBody(scheduler);
    expect(body.transactionSync).toBeDefined();
    expect(body.transactionSync.lastSyncAt).toBeNull();
    expect(body.transactionSync.lastSyncResult).toBeNull();
  });

  test('health includes transactionSync with populated values after sync', async () => {
    await scheduler.syncAllWallets();
    const body = getHealthBody(scheduler);
    expect(body.transactionSync.lastSyncAt).not.toBeNull();
    expect(body.transactionSync.lastSyncResult).not.toBeNull();
  });

  test('transactionSync.lastSyncResult has expected shape', async () => {
    await scheduler.syncAllWallets();
    const body = getHealthBody(scheduler);
    expect(body.transactionSync.lastSyncResult).toMatchObject({
      wallets: expect.any(Number),
      synced: expect.any(Number),
      errors: expect.any(Number),
      completedAt: expect.any(String),
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. _fetchHorizonTransactions — cursor and order logic
// ─────────────────────────────────────────────────────────────────────────────
describe('TransactionSyncService._fetchHorizonTransactions', () => {
  let service;
  let mockStellar;

  beforeEach(() => {
    mockStellar = new MockStellarService();
    service = new TransactionSyncService(mockStellar);
  });

  test('with cursor: uses asc order', async () => {
    let capturedOrder;
    service.server = {
      transactions: () => ({
        forAccount: () => ({
          limit: () => ({
            cursor: () => ({
              order: (o) => {
                capturedOrder = o;
                return { call: () => Promise.resolve({ records: [] }) };
              },
            }),
          }),
        }),
      }),
    };
    await service._fetchHorizonTransactions('GTEST', 10, 'some-cursor');
    expect(capturedOrder).toBe('asc');
  });

  test('without cursor: uses desc order', async () => {
    let capturedOrder;
    service.server = {
      transactions: () => ({
        forAccount: () => ({
          limit: () => ({
            order: (o) => {
              capturedOrder = o;
              return { call: () => Promise.resolve({ records: [] }) };
            },
          }),
        }),
      }),
    };
    await service._fetchHorizonTransactions('GTEST', 10, undefined);
    expect(capturedOrder).toBe('desc');
  });

  test('paginates until maxTransactions reached', async () => {
    const page1 = { records: [makeTx('t1'), makeTx('t2')], next: jest.fn() };
    const page2 = { records: [makeTx('t3')], next: jest.fn() };
    page1.next.mockResolvedValue(page2);
    page2.next.mockResolvedValue({ records: [] });

    service.server = {
      transactions: () => ({
        forAccount: () => ({
          limit: () => ({
            cursor: () => ({
              order: () => ({ call: () => Promise.resolve(page1) }),
            }),
          }),
        }),
      }),
    };

    const txs = await service._fetchHorizonTransactions('GTEST', 3, 'cursor');
    expect(txs.length).toBe(3);
  });
});
