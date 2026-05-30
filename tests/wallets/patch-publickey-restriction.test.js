/**
 * Tests for issue #770: publicKey must not be updatable via PATCH /wallets/:id
 */

const request = require('supertest');

// Minimal express app for isolated testing
const express = require('express');
const router = require('../../src/routes/wallet');

// Mock dependencies
jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => next(),
  requireAdmin: () => (req, res, next) => next(),
}));
jest.mock('../../src/services/WalletService', () => ({
  updateWallet: jest.fn(() => ({ id: 1, label: 'Updated', ownerName: null })),
  getWalletById: jest.fn(() => ({ id: 1, publicKey: 'GABC', label: 'Test' })),
  createWallet: jest.fn(),
  getAllWallets: jest.fn(() => []),
  getPaginatedWallets: jest.fn(() => ({ data: [], totalCount: 0, meta: {} })),
  getBalance: jest.fn(),
  revokeSponsoredAccount: jest.fn(),
  sponsorAccount: jest.fn(),
  getSponsorshipStatus: jest.fn(),
  setAccountData: jest.fn(),
  getAccountData: jest.fn(),
  deleteAccountData: jest.fn(),
  getWalletByAddress: jest.fn(),
  getUserByPublicKey: jest.fn(),
  getWalletTransactions: jest.fn(),
}));
jest.mock('../../src/utils/database', () => ({
  get: jest.fn(),
  query: jest.fn(() => []),
  run: jest.fn(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { WALLET_OPERATION: 'WALLET_OPERATION' },
  ACTION: { WALLET_UPDATED: 'WALLET_UPDATED', WALLET_CREATED: 'WALLET_CREATED', WALLET_DELETED: 'WALLET_DELETED', HOME_DOMAIN_UPDATED: 'HOME_DOMAIN_UPDATED' },
  SEVERITY: { MEDIUM: 'MEDIUM', HIGH: 'HIGH', LOW: 'LOW' },
}));
jest.mock('../../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { wallet: 1024 },
}));
jest.mock('../../src/middleware/caching', () => ({
  cacheMiddleware: () => (req, res, next) => next(),
}));
jest.mock('../../src/utils/pagination', () => ({
  parseCursorPaginationQuery: jest.fn(() => ({ cursor: null, limit: 20, direction: 'next' })),
}));
jest.mock('../../src/config/serviceContainer', () => ({
  getStellarService: jest.fn(() => ({
    getHomeDomain: jest.fn().mockResolvedValue(null),
    getInflationDestination: jest.fn().mockResolvedValue(null),
  })),
  getRecurringDonationScheduler: jest.fn(),
}));
jest.mock('../../src/services/LimitService', () => ({}));
jest.mock('../../src/middleware/validateDataEntry', () => (req, res, next) => next());
jest.mock('multer', () => {
  const m = () => ({ single: () => (req, res, next) => next() });
  m.memoryStorage = () => ({});
  return m;
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.id = 'test-req-id'; req.user = { id: 1, role: 'admin' }; next(); });
  app.use('/wallets', router);
  return app;
}

describe('PATCH /wallets/:id - publicKey restriction (#770)', () => {
  let app;

  beforeAll(() => { app = buildApp(); });

  it('returns 400 with correct message when publicKey is included in body', async () => {
    const res = await request(app)
      .patch('/wallets/1')
      .send({ publicKey: 'GNEWKEY123', label: 'Test' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('Public key cannot be changed');
  });

  it('returns 400 even when only publicKey is sent', async () => {
    const res = await request(app)
      .patch('/wallets/1')
      .send({ publicKey: 'GNEWKEY123' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Public key cannot be changed');
  });

  it('allows updating label without publicKey', async () => {
    const res = await request(app)
      .patch('/wallets/1')
      .send({ label: 'New Label' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('allows updating ownerName without publicKey', async () => {
    const res = await request(app)
      .patch('/wallets/1')
      .send({ ownerName: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
