'use strict';
/**
 * Wallet Balance Caching — Stale-While-Revalidate (Issue #1545)
 *
 * Verifies:
 * - X-Cache: MISS on first request / cache miss, synchronous fetch
 * - X-Cache: HIT on subsequent requests inside the TTL window
 * - X-Cache: HIT-STALE between TTL and 2×TTL, with a background revalidation
 * - X-Cache: MISS again once the entry is older than 2×TTL (or purged)
 * - ?refresh=true forces a synchronous MISS
 * - POST /wallets/:id/refresh-balance (admin-only) purges and refetches
 */
const request = require('supertest');
const express = require('express');
const WalletService = require('../../src/services/WalletService');
const Cache = require('../../src/utils/cache');
const Wallet = require('../../src/models/wallet');

jest.mock('../../src/models/wallet');
jest.mock('../../src/utils/database', () => ({
  get: jest.fn().mockResolvedValue(null),
  run: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
  all: jest.fn().mockResolvedValue([]),
}));
jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue({}),
  CATEGORY: { WALLET_OPERATION: 'WALLET_OPERATION' },
  SEVERITY: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}));

const mockGetBalance = jest.fn();
jest.mock('../../src/config/serviceContainer', () => ({
  getStellarService: jest.fn().mockReturnValue({ getBalance: (...a) => mockGetBalance(...a) }),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  const router = require('../../src/routes/wallet');
  app.use('/wallets', router);
  return app;
}

const WALLET = { id: '123', address: 'G12345' };

describe('Wallet Balance Caching — Stale-While-Revalidate (Issue #1545)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Cache.clear();
    delete process.env.WALLET_BALANCE_CACHE_TTL_SECONDS;

    Wallet.getById.mockReturnValue(WALLET);
    mockGetBalance.mockResolvedValue({ balance: '100.00', asset: 'XLM' });
  });

  it('returns X-Cache: MISS on first request and caches the result', async () => {
    const app = buildApp();
    const res = await request(app).get('/wallets/123/balance');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.body.balance).toBe('100.00');
    expect(res.body.cached).toBe(false);
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    const cached = Cache.get('wallet_balance_G12345');
    expect(cached).toBeDefined();
    expect(cached.balance).toBe('100.00');
    expect(cached.cachedAt).toEqual(expect.any(Number));
  });

  it('returns X-Cache: HIT on a subsequent request inside the TTL', async () => {
    const app = buildApp();
    await request(app).get('/wallets/123/balance');

    const res2 = await request(app).get('/wallets/123/balance');
    expect(res2.status).toBe(200);
    expect(res2.headers['x-cache']).toBe('HIT');
    expect(res2.body.cached).toBe(true);
    expect(mockGetBalance).toHaveBeenCalledTimes(1); // no second Horizon call
  });

  it('returns X-Cache: HIT-STALE between TTL and 2×TTL and revalidates in the background', async () => {
    process.env.WALLET_BALANCE_CACHE_TTL_SECONDS = '30';
    const app = buildApp();

    await request(app).get('/wallets/123/balance');
    expect(mockGetBalance).toHaveBeenCalledTimes(1);

    // Simulate the entry aging past the TTL (30s) but within 2×TTL (60s).
    const cached = Cache.get('wallet_balance_G12345');
    cached.cachedAt = Date.now() - 45_000;
    Cache.set('wallet_balance_G12345', cached, 60_000);

    mockGetBalance.mockResolvedValue({ balance: '150.00', asset: 'XLM' });
    const res = await request(app).get('/wallets/123/balance');

    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('HIT-STALE');
    expect(res.body.cached).toBe(true);
    // Stale data is served immediately — the OLD balance, not the new one yet.
    expect(res.body.balance).toBe('100.00');

    // Background revalidation was triggered.
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockGetBalance).toHaveBeenCalledTimes(2);

    // The cache now holds the revalidated value for subsequent requests.
    const revalidated = Cache.get('wallet_balance_G12345');
    expect(revalidated.balance).toBe('150.00');
  });

  it('returns X-Cache: MISS when no cache entry exists (expired/purged)', async () => {
    const app = buildApp();
    Cache.delete('wallet_balance_G12345');

    const res = await request(app).get('/wallets/123/balance');
    expect(res.status).toBe(200);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(res.body.cached).toBe(false);
  });

  it('forces X-Cache: MISS when ?refresh=true is provided', async () => {
    const app = buildApp();
    await request(app).get('/wallets/123/balance');

    mockGetBalance.mockResolvedValue({ balance: '200.00', asset: 'XLM' });
    const res2 = await request(app).get('/wallets/123/balance?refresh=true');

    expect(res2.status).toBe(200);
    expect(res2.headers['x-cache']).toBe('MISS');
    expect(res2.body.balance).toBe('200.00');
    expect(mockGetBalance).toHaveBeenCalledTimes(2);
  });

  it('uses WALLET_BALANCE_CACHE_TTL_SECONDS to size the SWR window', async () => {
    process.env.WALLET_BALANCE_CACHE_TTL_SECONDS = '10';
    expect(WalletService.getBalanceCacheTtlMs()).toBe(10_000);
  });

  it('defaults the TTL to 30s when unset or invalid', () => {
    delete process.env.WALLET_BALANCE_CACHE_TTL_SECONDS;
    expect(WalletService.getBalanceCacheTtlMs()).toBe(30_000);

    process.env.WALLET_BALANCE_CACHE_TTL_SECONDS = 'not-a-number';
    expect(WalletService.getBalanceCacheTtlMs()).toBe(30_000);
  });

  it('returns 404 cleanly when the wallet does not exist', async () => {
    Wallet.getById.mockReturnValue(null);
    const app = buildApp();

    const res = await request(app).get('/wallets/bad-id/balance');
    expect(res.status).not.toBe(200);
  });

  describe('POST /wallets/:id/refresh-balance (admin)', () => {
    it('purges the cache and fetches a fresh balance synchronously', async () => {
      const app = buildApp();
      await request(app).get('/wallets/123/balance');
      expect(mockGetBalance).toHaveBeenCalledTimes(1);

      mockGetBalance.mockResolvedValue({ balance: '999.00', asset: 'XLM' });
      const res = await request(app).post('/wallets/123/refresh-balance');

      expect(res.status).toBe(200);
      expect(res.headers['x-cache']).toBe('MISS');
      expect(res.body.balance).toBe('999.00');
      expect(mockGetBalance).toHaveBeenCalledTimes(2);

      const cached = Cache.get('wallet_balance_G12345');
      expect(cached.balance).toBe('999.00');
    });

    it('logs an audit event for the manual refresh', async () => {
      const AuditLogService = require('../../src/services/AuditLogService');
      const app = buildApp();

      await request(app).post('/wallets/123/refresh-balance');

      expect(AuditLogService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'WALLET_BALANCE_CACHE_REFRESHED' })
      );
    });

    it('returns 404 cleanly when the wallet does not exist', async () => {
      Wallet.getById.mockReturnValue(null);
      const app = buildApp();

      const res = await request(app).post('/wallets/bad-id/refresh-balance');
      expect(res.status).not.toBe(200);
    });
  });
});
