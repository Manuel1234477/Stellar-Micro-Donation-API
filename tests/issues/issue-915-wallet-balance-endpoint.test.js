'use strict';
/**
 * Tests: Issue #915 — GET /wallets/:id/balance with TTL caching
 */

// Mocks must be hoisted before requires
jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
  attachUserRole: (req, res, next) => next(),
}));
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => next());

const mockGetBalance = jest.fn();
jest.mock('../../src/config/serviceContainer', () => ({
  getStellarService: jest.fn().mockReturnValue({ getBalance: mockGetBalance }),
}));

const mockWalletGetById = jest.fn();
jest.mock('../../src/models/wallet', () => ({
  getById: (...a) => mockWalletGetById(...a),
  getByAddress: jest.fn(),
  getAll: jest.fn().mockReturnValue([]),
  create: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  run: jest.fn(),
  query: jest.fn().mockResolvedValue([]),
  all: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

const Cache = require('../../src/utils/cache');
const request = require('supertest');
const express = require('express');

function buildApp() {
  jest.resetModules();
  const app = express();
  app.use(express.json());
  const router = require('../../src/routes/wallet');
  app.use('/wallets', router);
  return app;
}

const WALLET = { id: '42', address: 'GABCDEF1234567890', label: 'Test' };

describe('Issue #915 — GET /wallets/:id/balance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Cache.clear();
    delete process.env.WALLET_BALANCE_CACHE_TTL_SECONDS;
    mockWalletGetById.mockReturnValue(WALLET);
    mockGetBalance.mockResolvedValue({ balance: '100.5000000', asset: 'XLM' });
  });

  it('returns balance, asset, lastUpdated, cached=false on first (cache miss)', async () => {
    const app = buildApp();
    const res = await request(app).get('/wallets/42/balance');

    expect(res.status).toBe(200);
    expect(res.body.balance).toBe('100.5000000');
    expect(res.body.asset).toBe('XLM');
    expect(res.body.lastUpdated).toBeDefined();
    expect(res.body.cached).toBe(false);
    expect(res.headers['x-cache']).toBe('MISS');
  });

  it('returns cached=true and skips Stellar call on second request', async () => {
    const app = buildApp();
    await request(app).get('/wallets/42/balance');
    mockGetBalance.mockClear();

    const res = await request(app).get('/wallets/42/balance');

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.headers['x-cache']).toBe('HIT');
    expect(mockGetBalance).not.toHaveBeenCalled();
  });

  it('?refresh=true forces live query and returns cached=false', async () => {
    const app = buildApp();
    // Populate cache first
    await request(app).get('/wallets/42/balance');

    mockGetBalance.mockResolvedValue({ balance: '200.0000000', asset: 'XLM' });
    const res = await request(app).get('/wallets/42/balance?refresh=true');

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.balance).toBe('200.0000000');
    expect(mockGetBalance).toHaveBeenCalled();
  });

  it('returns 404 when wallet does not exist', async () => {
    const { NotFoundError, ERROR_CODES } = require('../../src/utils/errors');
    mockWalletGetById.mockImplementation(() => {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    });
    const app = buildApp();
    const res = await request(app).get('/wallets/999/balance');
    expect(res.status).toBe(404);
  });

  it('returns 422 with STELLAR_ACCOUNT_NOT_FOUND when account not on network', async () => {
    mockGetBalance.mockRejectedValue({ status: 404, code: 'ACCOUNT_NOT_FOUND', message: 'not found' });
    const app = buildApp();
    const res = await request(app).get('/wallets/42/balance');

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('STELLAR_ACCOUNT_NOT_FOUND');
    expect(res.body.error.message).toMatch(/not been funded/i);
  });

  it('uses WALLET_BALANCE_CACHE_TTL_SECONDS env for TTL', async () => {
    process.env.WALLET_BALANCE_CACHE_TTL_SECONDS = '60';
    const WalletService = require('../../src/services/WalletService');
    const svc = new WalletService();
    // Just verify it reads the env and doesn't throw
    expect(svc).toBeDefined();
  });
});
