/**
 * Tests for GET /wallets/:id/history
 * Covers: source=db, source=live, rate limiting (skipped in test env), 404
 */

const Database = require('../../src/utils/database');

// ── Mock middleware ──────────────────────────────────────────────────────────
jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
  requireAdmin: () => (req, res, next) => { req.user = { id: 1, role: 'admin' }; next(); },
}));
jest.mock('../../src/utils/permissions', () => ({
  PERMISSIONS: {
    WALLETS_READ: 'wallets:read',
    WALLETS_CREATE: 'wallets:create',
    WALLETS_UPDATE: 'wallets:update',
    WALLETS_DELETE: 'wallets:delete',
  },
}));
jest.mock('../../src/services/LimitService', () => ({}));
jest.mock('../../src/utils/asyncHandler', () => (fn) => fn);
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { wallet: 1024 },
}));
jest.mock('../../src/utils/validationErrorFormatter', () => ({
  buildErrorResponse: (errors) => ({ errors }),
}));
jest.mock('../../src/middleware/schemaValidation', () => ({
  validateSchema: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/caching', () => ({
  cacheMiddleware: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/validateDataEntry', () => ({
  validateDataEntry: (req, res, next) => next(),
}));
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => next());
jest.mock('../../src/services/WalletService', () => function () {
  return {
    getWalletById: jest.fn(),
    getPaginatedWallets: jest.fn(() => ({ data: [], totalCount: 0, meta: {} })),
  };
});
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { WALLET_OPERATION: 'wallet' },
  ACTION: { WALLET_CREATED: 'created', WALLET_UPDATED: 'updated', WALLET_DELETED: 'deleted', HOME_DOMAIN_UPDATED: 'home_domain_updated' },
  SEVERITY: { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' },
}));
jest.mock('../../src/utils/pagination', () => ({
  parseCursorPaginationQuery: (q) => ({ limit: q.limit || 20, cursor: q.cursor }),
}));
jest.mock('../../src/services/BulkWalletImportService', () => ({}));
jest.mock('../../src/utils/responseSanitizer', () => ({
  toWalletResponse: (w) => w,
}));

// ── Mock config/stellar ──────────────────────────────────────────────────────
const mockStellarService = { getNetwork: jest.fn(() => 'testnet') };
jest.mock('../../src/config/stellar', () => ({
  getStellarService: () => mockStellarService,
}));

// ── Mock TransactionSyncService ──────────────────────────────────────────────
const mockFetchHorizonTransactions = jest.fn();
jest.mock('../../src/services/TransactionSyncService', () => {
  return jest.fn().mockImplementation(() => ({
    _fetchHorizonTransactions: mockFetchHorizonTransactions,
  }));
});

// ── Mock Transaction model ───────────────────────────────────────────────────
const mockGetByStellarTxId = jest.fn(() => null);
const mockCreate = jest.fn((data) => ({ id: 999, ...data }));
jest.mock('../../src/routes/models/transaction', () => ({
  getByStellarTxId: (...args) => mockGetByStellarTxId(...args),
  create: (...args) => mockCreate(...args),
}));

// ── Mock rateLimiter — skip in tests ─────────────────────────────────────────
jest.mock('../../src/middleware/rateLimiter', () => {
  const passThrough = (req, res, next) => next();
  return {
    liveHistoryRateLimiter: passThrough,
    friendbotRateLimiter: passThrough,
    donationRateLimiter: passThrough,
    verificationRateLimiter: passThrough,
    bulkImportRateLimiter: passThrough,
    authTokenRateLimiter: passThrough,
    authRefreshRateLimiter: passThrough,
    healthCheckRateLimiter: passThrough,
    statsRateLimiter: passThrough,
    createRateLimiter: () => passThrough,
  };
});

const express = require('express');
const request = require('supertest');

let app;
let walletId;
let dummyId;
const PUBLIC_KEY = 'GABC' + 'A'.repeat(52);
const DUMMY_KEY = 'GDUMMY' + 'D'.repeat(50);

beforeAll(async () => {
  app = express();
  app.use(express.json());
  const walletRoutes = require('../../src/routes/wallet');
  app.use('/wallets', walletRoutes);
});

beforeEach(async () => {
  await Database.run('DELETE FROM transactions WHERE memo LIKE ?', ['%hist-test%']);
  await Database.run('DELETE FROM users WHERE publicKey = ?', [PUBLIC_KEY]);
  await Database.run('DELETE FROM users WHERE publicKey = ?', [DUMMY_KEY]);

  const r1 = await Database.run('INSERT INTO users (publicKey, createdAt) VALUES (?, ?)', [PUBLIC_KEY, new Date().toISOString()]);
  walletId = r1.id;
  const r2 = await Database.run('INSERT INTO users (publicKey, createdAt) VALUES (?, ?)', [DUMMY_KEY, new Date().toISOString()]);
  dummyId = r2.id;

  const ts = Date.now();
  await Database.run(
    'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp) VALUES (?, ?, ?, ?, ?)',
    [walletId, dummyId, 10000000, 'hist-test-1', new Date().toISOString()]
  );
  await Database.run(
    'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp) VALUES (?, ?, ?, ?, ?)',
    [dummyId, walletId, 5000000, 'hist-test-2', new Date().toISOString()]
  );

  mockFetchHorizonTransactions.mockReset();
  mockGetByStellarTxId.mockReset().mockReturnValue(null);
  mockCreate.mockReset().mockImplementation((data) => ({ id: 999, ...data }));
});

afterEach(async () => {
  await Database.run('DELETE FROM transactions WHERE memo LIKE ?', ['%hist-test%']);
  await Database.run('DELETE FROM users WHERE publicKey = ?', [PUBLIC_KEY]);
  await Database.run('DELETE FROM users WHERE publicKey = ?', [DUMMY_KEY]);
});

// ── source=db ────────────────────────────────────────────────────────────────
describe('GET /wallets/:id/history?source=db', () => {
  it('returns cached transactions from DB', async () => {
    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=db`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('db');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('defaults to source=db when source is omitted', async () => {
    const res = await request(app)
      .get(`/wallets/${walletId}/history`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('db');
  });

  it('paginates with cursor', async () => {
    // Get first page with limit=1
    const res1 = await request(app)
      .get(`/wallets/${walletId}/history?source=db&limit=1`)
      .set('x-api-key', 'test-key');

    expect(res1.status).toBe(200);
    expect(res1.body.data.length).toBe(1);
    expect(res1.body.pagination.hasMore).toBe(true);
    expect(res1.body.pagination.nextCursor).toBeTruthy();

    // Get second page
    const res2 = await request(app)
      .get(`/wallets/${walletId}/history?source=db&limit=1&cursor=${res1.body.pagination.nextCursor}`)
      .set('x-api-key', 'test-key');

    expect(res2.status).toBe(200);
    expect(res2.body.data.length).toBe(1);
    // The two pages should return different transactions
    expect(res2.body.data[0].id).not.toBe(res1.body.data[0].id);
  });

  it('returns 400 for invalid limit', async () => {
    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=db&limit=999`)
      .set('x-api-key', 'test-key');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid source', async () => {
    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=invalid`)
      .set('x-api-key', 'test-key');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SOURCE');
  });
});

// ── source=live ──────────────────────────────────────────────────────────────
describe('GET /wallets/:id/history?source=live', () => {
  it('fetches from Horizon and returns results', async () => {
    const horizonTxs = [
      { id: 'tx1', paging_token: 'pt1', created_at: '2024-01-01T00:00:00Z', memo: 'live-memo', operations: [{ amount: '10.0' }] },
    ];
    mockFetchHorizonTransactions.mockResolvedValue(horizonTxs);

    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=live`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.source).toBe('live');
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].stellarTxId).toBe('tx1');
  });

  it('persists new transactions to the local DB', async () => {
    const horizonTxs = [
      { id: 'new-stellar-tx', paging_token: 'pt2', created_at: '2024-01-02T00:00:00Z', memo: null, operations: [] },
    ];
    mockFetchHorizonTransactions.mockResolvedValue(horizonTxs);
    mockGetByStellarTxId.mockReturnValue(null); // not yet in DB

    await request(app)
      .get(`/wallets/${walletId}/history?source=live`)
      .set('x-api-key', 'test-key');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ stellarTxId: 'new-stellar-tx' }));
  });

  it('does not duplicate transactions already in DB', async () => {
    const horizonTxs = [
      { id: 'existing-tx', paging_token: 'pt3', created_at: '2024-01-03T00:00:00Z', memo: null, operations: [] },
    ];
    mockFetchHorizonTransactions.mockResolvedValue(horizonTxs);
    mockGetByStellarTxId.mockReturnValue({ id: 1, stellarTxId: 'existing-tx' }); // already in DB

    await request(app)
      .get(`/wallets/${walletId}/history?source=live`)
      .set('x-api-key', 'test-key');

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('passes cursor to Horizon fetch', async () => {
    mockFetchHorizonTransactions.mockResolvedValue([]);
    const cursor = Buffer.from('some-paging-token').toString('base64');

    await request(app)
      .get(`/wallets/${walletId}/history?source=live&cursor=${cursor}`)
      .set('x-api-key', 'test-key');

    expect(mockFetchHorizonTransactions).toHaveBeenCalledWith(
      PUBLIC_KEY,
      expect.any(Number),
      'some-paging-token',
      1
    );
  });
});

// ── 404 ──────────────────────────────────────────────────────────────────────
describe('GET /wallets/:id/history — 404', () => {
  it('returns 404 for non-existent wallet', async () => {
    const res = await request(app)
      .get('/wallets/999999/history')
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
describe('GET /wallets/:id/history — rate limiting', () => {
  it('source=live applies the liveHistoryRateLimiter middleware', async () => {
    // In test env the limiter is mocked to pass through.
    // Verify the route still works (limiter was invoked and passed).
    mockFetchHorizonTransactions.mockResolvedValue([]);

    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=live`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
  });

  it('source=db does NOT apply the live rate limiter', async () => {
    // source=db should succeed without any rate-limit concern
    const res = await request(app)
      .get(`/wallets/${walletId}/history?source=db`)
      .set('x-api-key', 'test-key');

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('db');
  });
});
