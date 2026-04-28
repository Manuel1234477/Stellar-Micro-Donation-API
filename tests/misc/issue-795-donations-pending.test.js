'use strict';

/**
 * Tests for #795 — GET /donations/pending
 */

const request = require('supertest');
const express = require('express');

const NOW = Date.now();
const OLD_TS = new Date(NOW - 900_000).toISOString(); // 15 min ago → stuck
const NEW_TS = new Date(NOW - 60_000).toISOString();  // 1 min ago → not stuck

const MOCK_PENDING = [
  { id: '1', amount: 10, donor: 'GABC', recipient: 'GXYZ', stellarTxId: 'hash1', statusUpdatedAt: OLD_TS, feeBumpCount: 2 },
  { id: '2', amount: 5,  donor: 'GDEF', recipient: 'GXYZ', stellarTxId: 'hash2', statusUpdatedAt: NEW_TS, feeBumpCount: 0 },
];

jest.mock('../../src/routes/models/transaction', () => ({
  getByStatus: jest.fn((s) => s === 'pending' ? MOCK_PENDING : []),
  getAll: jest.fn(() => []),
}));

jest.mock('../../src/services/DonationService', () =>
  jest.fn().mockImplementation(() => ({
    getPaginatedDonations: jest.fn().mockReturnValue({ data: [], totalCount: 0, meta: {} }),
    getRecentDonations: jest.fn().mockReturnValue([]),
  }))
);

jest.mock('../../src/config/serviceContainer', () => ({
  getStellarService: () => ({}),
  getIdempotencyService: () => ({}),
  getNetworkStatusService: () => ({ getStatus: () => ({}) }),
}));

jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: {}, SEVERITY: {}, ACTION: {},
}));

jest.mock('../../src/middleware/rateLimiter', () => ({
  donationRateLimiter: (_r, _s, n) => n(),
  verificationRateLimiter: (_r, _s, n) => n(),
}));

jest.mock('../../src/middleware/idempotency', () => (_r, _s, n) => n());

const donationRouter = require('../../src/routes/donation');

function buildApp(role = 'user', publicKey = 'GABC') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', role, publicKey }; next(); });
  app.use('/donations', donationRouter);
  return app;
}

describe('GET /donations/pending (#795)', () => {
  it('returns 200', async () => {
    const res = await request(buildApp()).get('/donations/pending');
    expect(res.status).toBe(200);
  });

  it('regular user sees only their own pending donations', async () => {
    const res = await request(buildApp('user', 'GABC')).get('/donations/pending');
    expect(res.body.data.every(tx => tx.donorPublicKey === 'GABC')).toBe(true);
  });

  it('admin sees all pending donations', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending');
    expect(res.body.data.length).toBe(2);
  });

  it('admin response includes summary', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending');
    expect(res.body.summary).toBeDefined();
    expect(typeof res.body.summary.total).toBe('number');
    expect(typeof res.body.summary.stuckCount).toBe('number');
    expect(typeof res.body.summary.oldestPendingSeconds).toBe('number');
  });

  it('regular user response has no summary', async () => {
    const res = await request(buildApp('user', 'GABC')).get('/donations/pending');
    expect(res.body.summary).toBeUndefined();
  });

  it('isStuck true when pendingDurationSeconds >= 600', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending');
    const tx = res.body.data.find(t => t.id === '1');
    expect(tx.isStuck).toBe(true);
    expect(tx.pendingDurationSeconds).toBeGreaterThanOrEqual(600);
  });

  it('isStuck false when pendingDurationSeconds < 600', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending');
    const tx = res.body.data.find(t => t.id === '2');
    expect(tx.isStuck).toBe(false);
  });

  it('each record has required fields', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending');
    const tx = res.body.data[0];
    ['id','pendingDurationSeconds','pendingDurationHuman','retryCount','isStuck','stuckThresholdSeconds'].forEach(f => {
      expect(tx).toHaveProperty(f);
    });
  });

  it('returns empty data array (not 404) when no pending donations', async () => {
    const Transaction = require('../../src/routes/models/transaction');
    Transaction.getByStatus.mockReturnValueOnce([]);
    const res = await request(buildApp('admin')).get('/donations/pending');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('respects custom stuckThresholdSeconds query param', async () => {
    const res = await request(buildApp('admin')).get('/donations/pending?stuckThresholdSeconds=30');
    expect(res.body.data.every(tx => tx.isStuck)).toBe(true);
  });
});
