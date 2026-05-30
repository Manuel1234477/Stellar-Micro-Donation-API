'use strict';

/**
 * Bump Sequence Tests
 *
 * Covers:
 * - MockStellarService.bumpSequence() simulation
 * - StellarService.bumpSequence() method existence
 * - POST /wallets/:id/bump-sequence route (success, auth, audit)
 */

const request = require('supertest');
const express = require('express');

// ─── Mock dependencies before requiring the router ───────────────────────────

jest.mock('../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => {
    req.user = { id: 'admin-user', role: 'admin' };
    next();
  },
  requireAdmin: () => (req, res, next) => {
    req.user = { id: 'admin-user', role: 'admin' };
    next();
  },
}));

jest.mock('../src/services/AuditLogService', () => {
  const mockLog = jest.fn().mockResolvedValue(undefined);
  return {
    log: mockLog,
    CATEGORY: { WALLET_OPERATION: 'WALLET_OPERATION', AUTHORIZATION: 'AUTHORIZATION' },
    ACTION: {
      BUMP_SEQUENCE_EXECUTED: 'BUMP_SEQUENCE_EXECUTED',
      BUMP_SEQUENCE_FAILED: 'BUMP_SEQUENCE_FAILED',
      WALLET_CREATED: 'WALLET_CREATED',
      WALLET_UPDATED: 'WALLET_UPDATED',
      WALLET_QUERIED: 'WALLET_QUERIED',
      WALLET_DELETED: 'WALLET_DELETED',
      PERMISSION_GRANTED: 'PERMISSION_GRANTED',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
    },
    SEVERITY: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
  };
});

const mockBumpSequence = jest.fn();

jest.mock('../src/config/serviceContainer', () => ({
  getStellarService: jest.fn(() => ({ bumpSequence: mockBumpSequence })),
}));

jest.mock('../src/routes/models/wallet', () => ({
  getById: jest.fn(),
  getAll: jest.fn(() => []),
  getByAddress: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../src/utils/database', () => ({
  get: jest.fn(),
  query: jest.fn(() => []),
  run: jest.fn(),
}));

jest.mock('../src/middleware/payloadSizeLimiter', () => ({
  payloadSizeLimiter: () => (req, res, next) => next(),
  ENDPOINT_LIMITS: { wallet: 1024 },
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const Wallet = require('../../src/routes/models/wallet');
const AuditLogService = require('../../src/services/AuditLogService');

function buildApp() {
  const app = express();
  app.use(express.json());
  // Re-require so mocks are picked up
  jest.resetModules();

  // Re-apply mocks after resetModules
  jest.mock('../src/middleware/rbac', () => ({
    checkPermission: () => (req, res, next) => {
      req.user = { id: 'admin-user', role: 'admin' };
      next();
    },
    requireAdmin: () => (req, res, next) => {
      req.user = { id: 'admin-user', role: 'admin' };
      next();
    },
  }));

  const walletRouter = require('../../src/routes/wallet');
  app.use('/wallets', walletRouter);
  return app;
}

// ─── MockStellarService unit tests ───────────────────────────────────────────

describe('MockStellarService.bumpSequence()', () => {
  const MockStellarService = require('../../src/services/MockStellarService');
  let service;

  beforeEach(() => {
    service = new MockStellarService({ network: 'testnet' });
  });

  test('bumps sequence number successfully', async () => {
    const wallet = await service.createWallet();
    await service.fundTestnetWallet(wallet.publicKey);

    // Set a known starting sequence
    const w = service.wallets.get(wallet.publicKey);
    w.sequence = '100';

    const result = await service.bumpSequence(wallet.secretKey, '200');

    expect(result).toHaveProperty('hash');
    expect(result).toHaveProperty('ledger');
    expect(result.newSequence).toBe('200');
    expect(result.hash).toMatch(/^mock_bumpseq_/);
  });

  test('updates in-memory wallet sequence after bump', async () => {
    const wallet = await service.createWallet();
    const w = service.wallets.get(wallet.publicKey);
    w.sequence = '50';

    await service.bumpSequence(wallet.secretKey, '999');

    expect(w.sequence).toBe('999');
  });

  test('rejects bumpTo <= current sequence', async () => {
    const wallet = await service.createWallet();
    const w = service.wallets.get(wallet.publicKey);
    w.sequence = '500';

    await expect(service.bumpSequence(wallet.secretKey, '500')).rejects.toThrow();
    await expect(service.bumpSequence(wallet.secretKey, '499')).rejects.toThrow();
  });

  test('rejects missing secret', async () => {
    await expect(service.bumpSequence('', '100')).rejects.toThrow();
    await expect(service.bumpSequence(null, '100')).rejects.toThrow();
  });

  test('rejects unknown secret key', async () => {
    // Valid-format secret that is not in the wallet map
    const unknownSecret = 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY7URFI5NUFQMK3Q7OV';
    await expect(service.bumpSequence(unknownSecret, '100')).rejects.toThrow();
  });
});

// ─── StellarService interface compliance ─────────────────────────────────────

describe('StellarService.bumpSequence()', () => {
  test('method exists and overrides the interface stub', () => {
    const StellarService = require('../../src/services/StellarService');
    const StellarServiceInterface = require('../../src/services/interfaces/StellarServiceInterface');
    const service = new StellarService({ network: 'testnet' });
    const iface = new StellarServiceInterface();

    expect(typeof service.bumpSequence).toBe('function');
    expect(service.bumpSequence).not.toBe(iface.bumpSequence);
  });
});

// ─── Route integration tests ─────────────────────────────────────────────────

describe('POST /wallets/:id/bump-sequence', () => {
  let app;
  const WALLET_ID = '42';
  const MOCK_SECRET = 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY7URFI5NUFQMK3Q7OV';
  const BUMP_TO = '9999999';

  beforeEach(() => {
    jest.clearAllMocks();

    Wallet.getById.mockReturnValue({
      id: WALLET_ID,
      address: 'GABC123',
    });

    mockBumpSequence.mockResolvedValue({
      hash: 'mock_bumpseq_abc123',
      ledger: 1234567,
      newSequence: BUMP_TO,
    });

    app = express();
    app.use(express.json());
    const walletRouter = require('../../src/routes/wallet');
    app.use('/wallets', walletRouter);
  });

  test('returns 200 with hash, ledger, and newSequence on success', async () => {
    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET, bumpTo: BUMP_TO });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.hash).toBe('mock_bumpseq_abc123');
    expect(res.body.data.newSequence).toBe(BUMP_TO);
    expect(mockBumpSequence).toHaveBeenCalledWith(MOCK_SECRET, BUMP_TO);
  });

  test('calls stellarService.bumpSequence with correct args', async () => {
    await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET, bumpTo: BUMP_TO });

    expect(mockBumpSequence).toHaveBeenCalledTimes(1);
    expect(mockBumpSequence).toHaveBeenCalledWith(MOCK_SECRET, BUMP_TO);
  });

  test('logs BUMP_SEQUENCE_EXECUTED in audit trail on success', async () => {
    await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET, bumpTo: BUMP_TO });

    const auditCalls = AuditLogService.log.mock.calls;
    const bumpAudit = auditCalls.find(
      ([entry]) => entry.action === 'BUMP_SEQUENCE_EXECUTED'
    );

    expect(bumpAudit).toBeDefined();
    const [entry] = bumpAudit;
    expect(entry.result).toBe('SUCCESS');
    expect(entry.severity).toBe('HIGH');
    expect(entry.details.walletId).toBe(WALLET_ID);
    expect(entry.details.bumpTo).toBe(BUMP_TO);
  });

  test('logs BUMP_SEQUENCE_FAILED in audit trail on error', async () => {
    mockBumpSequence.mockRejectedValue(new Error('sequence too low'));

    await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET, bumpTo: '1' });

    const auditCalls = AuditLogService.log.mock.calls;
    const failAudit = auditCalls.find(
      ([entry]) => entry.action === 'BUMP_SEQUENCE_FAILED'
    );

    expect(failAudit).toBeDefined();
    const [entry] = failAudit;
    expect(entry.result).toBe('FAILURE');
    expect(entry.severity).toBe('HIGH');
  });

  test('returns 400 when secret is missing', async () => {
    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ bumpTo: BUMP_TO });

    expect(res.status).toBe(400);
    expect(mockBumpSequence).not.toHaveBeenCalled();
  });

  test('returns 400 when bumpTo is missing', async () => {
    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET });

    expect(res.status).toBe(400);
    expect(mockBumpSequence).not.toHaveBeenCalled();
  });

  test('returns 404 when wallet does not exist', async () => {
    Wallet.getById.mockImplementation(() => {
      const { NotFoundError, ERROR_CODES } = require('../../src/utils/errors');
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    });

    const res = await request(app)
      .post(`/wallets/${WALLET_ID}/bump-sequence`)
      .send({ secret: MOCK_SECRET, bumpTo: BUMP_TO });

    expect(res.status).toBe(404);
    expect(mockBumpSequence).not.toHaveBeenCalled();
  });
});

// ─── Admin auth enforcement ───────────────────────────────────────────────────

describe('POST /wallets/:id/bump-sequence — admin auth required', () => {
  test('checkPermission is called with ADMIN_ALL', () => {
    // Verify the route uses PERMISSIONS.ADMIN_ALL by inspecting the router source
    const fs = require('fs');
    const path = require('path');
    const routerSrc = fs.readFileSync(
      path.join(__dirname, '../src/routes/wallet.js'),
      'utf8'
    );

    // The route must reference ADMIN_ALL permission
    expect(routerSrc).toMatch(/PERMISSIONS\.ADMIN_ALL/);
    // And it must be on the bump-sequence path
    expect(routerSrc).toMatch(/bump-sequence/);
  });

  test('non-admin request is rejected (403)', async () => {
    // Build a fresh app with a restrictive RBAC mock
    const restrictedApp = express();
    restrictedApp.use(express.json());

    // Override rbac to deny
    jest.doMock('../src/middleware/rbac', () => ({
      checkPermission: () => (req, res, next) => {
        const { ForbiddenError } = require('../../src/utils/errors');
        next(new ForbiddenError('Insufficient permissions'));
      },
      requireAdmin: () => (req, res, next) => {
        const { ForbiddenError } = require('../../src/utils/errors');
        next(new ForbiddenError('Insufficient permissions'));
      },
    }));

    jest.resetModules();

    // Re-apply other mocks
    jest.doMock('../src/config/serviceContainer', () => ({
      getStellarService: jest.fn(() => ({ bumpSequence: jest.fn() })),
    }));
    jest.doMock('../src/routes/models/wallet', () => ({
      getById: jest.fn(() => ({ id: '1', address: 'GABC' })),
      getAll: jest.fn(() => []),
      getByAddress: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    }));
    jest.doMock('../src/utils/database', () => ({
      get: jest.fn(),
      query: jest.fn(() => []),
      run: jest.fn(),
    }));
    jest.doMock('../src/middleware/payloadSizeLimiter', () => ({
      payloadSizeLimiter: () => (req, res, next) => next(),
      ENDPOINT_LIMITS: { wallet: 1024 },
    }));
    jest.doMock('../src/services/AuditLogService', () => ({
      log: jest.fn().mockResolvedValue(undefined),
      CATEGORY: { WALLET_OPERATION: 'WALLET_OPERATION', AUTHORIZATION: 'AUTHORIZATION' },
      ACTION: { BUMP_SEQUENCE_EXECUTED: 'BUMP_SEQUENCE_EXECUTED', BUMP_SEQUENCE_FAILED: 'BUMP_SEQUENCE_FAILED', WALLET_CREATED: 'WALLET_CREATED', WALLET_UPDATED: 'WALLET_UPDATED', WALLET_QUERIED: 'WALLET_QUERIED', WALLET_DELETED: 'WALLET_DELETED', PERMISSION_GRANTED: 'PERMISSION_GRANTED', PERMISSION_DENIED: 'PERMISSION_DENIED' },
      SEVERITY: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
    }));

    const restrictedRouter = require('../../src/routes/wallet');
    restrictedApp.use('/wallets', restrictedRouter);
    restrictedApp.use((err, req, res, _next) => {
      res.status(err.statusCode || err.status || 500).json({ error: err.message });
    });

    const res = await request(restrictedApp)
      .post('/wallets/1/bump-sequence')
      .send({
        secret: 'SCZANGBA5YHTNYVVV3C7CAZMCLXPILHSE6PGYAY7URFI5NUFQMK3Q7OV',
        bumpTo: '9999',
      });

    expect(res.status).toBe(403);
  });
});
