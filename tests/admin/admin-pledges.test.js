'use strict';

/**
 * Tests for admin pledge management endpoints.
 *
 * Covers:
 *   GET  /admin/pledges              — list all pledges, ?status= filter
 *   PATCH /admin/pledges/:id/fulfil  — fulfil a pending pledge
 *   PATCH /admin/pledges/:id/cancel  — cancel a pending pledge
 *   Automatic expiry via expiryWorker / PledgeFulfillmentService.expireOverdue
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('../../src/utils/database');
jest.mock('../../src/services/WebhookService', () => ({
  deliver: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { SYSTEM: 'SYSTEM', AUTHORIZATION: 'AUTHORIZATION' },
  ACTION: { PERMISSION_DENIED: 'PERMISSION_DENIED' },
  SEVERITY: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' },
}));

// Bypass auth for all tests
jest.mock('../../src/middleware/rbac', () => ({
  checkPermission: () => (req, res, next) => {
    req.user = { id: 'admin-user', role: 'admin' };
    next();
  },
  requireAdmin: () => (req, res, next) => {
    req.user = { id: 'admin-user', role: 'admin' };
    next();
  },
  attachUserRole: (req, res, next) => {
    req.user = { id: 'admin-user', role: 'admin' };
    next();
  },
}));
jest.mock('../../src/middleware/apiKey', () => (req, res, next) => {
  req.user = { id: 'admin-user', role: 'admin' };
  next();
});

// ── Test helpers ──────────────────────────────────────────────────────────────

const Database = require('../../src/utils/database');
const WebhookService = require('../../src/services/WebhookService');

// In-memory pledge store
let _pledges = [];

function resetStore(initial = []) {
  _pledges = initial.map((p, i) => ({
    id: p.id || `pledge-${i + 1}`,
    campaign_id: p.campaign_id || 1,
    donor_wallet_id: p.donor_wallet_id || 'GDONOR123',
    amount: p.amount || 50,
    status: p.status || 'pending',
    expires_at: p.expires_at || '2099-12-31T00:00:00.000Z',
    cancel_reason: p.cancel_reason || null,
    cancelled_at: p.cancelled_at || null,
    created_at: p.created_at || new Date().toISOString(),
  }));
}

function mockDb() {
  Database.run.mockImplementation(async (sql, params = []) => {
    // UPDATE pledges SET status = 'fulfilled'
    if (sql.includes("status = 'fulfilled'") && sql.includes('WHERE id =')) {
      const id = params[params.length - 1];
      const pledge = _pledges.find(p => p.id === id);
      if (pledge && pledge.status === 'pending') {
        pledge.status = 'fulfilled';
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    // UPDATE pledges SET status = 'cancelled'
    if (sql.includes("status = 'cancelled'")) {
      const id = params[params.length - 1];
      const pledge = _pledges.find(p => p.id === id && p.status === 'pending');
      if (pledge) {
        pledge.status = 'cancelled';
        pledge.cancel_reason = params[0];
        pledge.cancelled_at = params[1];
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    // UPDATE pledges SET status = 'expired'
    if (sql.includes("status = 'expired'")) {
      const now = params[0];
      let count = 0;
      _pledges.forEach(p => {
        if (p.status === 'pending' && p.expires_at < now) {
          p.status = 'expired';
          count++;
        }
      });
      return { changes: count };
    }
    // fulfillAll by campaign
    if (sql.includes("status = 'fulfilled'") && sql.includes('campaign_id')) {
      const campaignId = params[0];
      let count = 0;
      _pledges.forEach(p => {
        if (p.campaign_id === campaignId && p.status === 'pending') {
          p.status = 'fulfilled';
          count++;
        }
      });
      return { changes: count };
    }
    return { changes: 0, id: 1 };
  });

  Database.get.mockImplementation(async (sql, params = []) => {
    if (sql.includes('FROM pledges WHERE id')) {
      return _pledges.find(p => p.id === params[0]) || null;
    }
    if (sql.includes('FROM campaigns WHERE id')) {
      // Return a campaign that has reached its goal for fulfillment tests
      return { id: params[0], goal_amount: 100, current_amount: 100 };
    }
    return null;
  });

  Database.query.mockImplementation(async (sql, params = []) => {
    // listAll with status filter
    if (sql.includes('WHERE status =')) {
      const status = params[0];
      return _pledges.filter(p => p.status === status);
    }
    // listAll without filter
    if (sql.includes('FROM pledges ORDER BY')) {
      return [..._pledges];
    }
    // getExpiredPledges
    if (sql.includes("status = 'expired'")) {
      return _pledges.filter(p => p.status === 'expired');
    }
    // fulfilled pledges for campaign
    if (sql.includes("status = 'fulfilled'") && sql.includes('campaign_id')) {
      const campaignId = params[0];
      return _pledges.filter(p => p.campaign_id === campaignId && p.status === 'fulfilled');
    }
    return [];
  });

  Database.all = Database.query;
}

// ── App setup ─────────────────────────────────────────────────────────────────

const express = require('express');
const request = require('supertest');

function buildApp() {
  const app = express();
  app.use(express.json());
  const pledgeAdminRoutes = require('../../src/routes/admin/pledges');
  app.use('/admin/pledges', pledgeAdminRoutes);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /admin/pledges', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    resetStore([
      { id: 'p1', status: 'pending', amount: 10 },
      { id: 'p2', status: 'fulfilled', amount: 20 },
      { id: 'p3', status: 'expired', amount: 30 },
      { id: 'p4', status: 'cancelled', amount: 40 },
    ]);
    mockDb();
    app = buildApp();
  });

  afterEach(() => jest.clearAllMocks());

  it('returns all pledges when no filter is applied', async () => {
    const res = await request(app).get('/admin/pledges');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(4);
  });

  it('filters pledges by ?status=pending', async () => {
    const res = await request(app).get('/admin/pledges?status=pending');
    expect(res.status).toBe(200);
    expect(res.body.data.every(p => p.status === 'pending')).toBe(true);
  });

  it('filters pledges by ?status=fulfilled', async () => {
    const res = await request(app).get('/admin/pledges?status=fulfilled');
    expect(res.status).toBe(200);
    expect(res.body.data.every(p => p.status === 'fulfilled')).toBe(true);
  });

  it('filters pledges by ?status=expired', async () => {
    const res = await request(app).get('/admin/pledges?status=expired');
    expect(res.status).toBe(200);
    expect(res.body.data.every(p => p.status === 'expired')).toBe(true);
  });

  it('filters pledges by ?status=cancelled', async () => {
    const res = await request(app).get('/admin/pledges?status=cancelled');
    expect(res.status).toBe(200);
    expect(res.body.data.every(p => p.status === 'cancelled')).toBe(true);
  });

  it('returns 400 for an invalid status value', async () => {
    const res = await request(app).get('/admin/pledges?status=bogus');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an empty array when no pledges exist', async () => {
    resetStore([]);
    mockDb();
    const res = await request(app).get('/admin/pledges');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('response shape includes expected fields', async () => {
    const res = await request(app).get('/admin/pledges?status=pending');
    expect(res.status).toBe(200);
    const pledge = res.body.data[0];
    expect(pledge).toHaveProperty('id');
    expect(pledge).toHaveProperty('donor_wallet_id');
    expect(pledge).toHaveProperty('amount');
    expect(pledge).toHaveProperty('status');
    expect(pledge).toHaveProperty('expires_at');
  });
});

describe('PATCH /admin/pledges/:id/fulfil', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    resetStore([
      { id: 'p-pending', status: 'pending', campaign_id: 1 },
      { id: 'p-fulfilled', status: 'fulfilled', campaign_id: 1 },
      { id: 'p-expired', status: 'expired', campaign_id: 1 },
      { id: 'p-cancelled', status: 'cancelled', campaign_id: 1 },
    ]);
    mockDb();
    app = buildApp();
  });

  afterEach(() => jest.clearAllMocks());

  it('fulfils a pending pledge and returns 200', async () => {
    const res = await request(app).patch('/admin/pledges/p-pending/fulfil');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pledge.status).toBe('fulfilled');
  });

  it('returns 404 when pledge does not exist', async () => {
    const res = await request(app).patch('/admin/pledges/nonexistent/fulfil');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when pledge is already fulfilled', async () => {
    const res = await request(app).patch('/admin/pledges/p-fulfilled/fulfil');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 409 when pledge is expired', async () => {
    const res = await request(app).patch('/admin/pledges/p-expired/fulfil');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 409 when pledge is cancelled', async () => {
    const res = await request(app).patch('/admin/pledges/p-cancelled/fulfil');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('fires a pledge.fulfilled webhook', async () => {
    await request(app).patch('/admin/pledges/p-pending/fulfil');
    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'pledge.fulfilled',
      expect.objectContaining({ pledge: expect.any(Object) })
    );
  });
});

describe('PATCH /admin/pledges/:id/cancel', () => {
  let app;

  beforeEach(() => {
    jest.resetModules();
    resetStore([
      { id: 'p-pending', status: 'pending' },
      { id: 'p-fulfilled', status: 'fulfilled' },
      { id: 'p-expired', status: 'expired' },
    ]);
    mockDb();
    app = buildApp();
  });

  afterEach(() => jest.clearAllMocks());

  it('cancels a pending pledge and returns 200', async () => {
    const res = await request(app)
      .patch('/admin/pledges/p-pending/cancel')
      .send({ reason: 'Donor requested cancellation' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.pledge.status).toBe('cancelled');
  });

  it('persists the cancellation reason', async () => {
    const reason = 'No longer valid';
    const res = await request(app)
      .patch('/admin/pledges/p-pending/cancel')
      .send({ reason });
    expect(res.status).toBe(200);
    expect(res.body.data.pledge.cancel_reason).toBe(reason);
  });

  it('cancels without a reason (reason is optional)', async () => {
    const res = await request(app)
      .patch('/admin/pledges/p-pending/cancel')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.pledge.status).toBe('cancelled');
  });

  it('returns 404 when pledge does not exist', async () => {
    const res = await request(app).patch('/admin/pledges/nonexistent/cancel');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 when pledge is already fulfilled', async () => {
    const res = await request(app).patch('/admin/pledges/p-fulfilled/cancel');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('returns 409 when pledge is already expired', async () => {
    const res = await request(app).patch('/admin/pledges/p-expired/cancel');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('fires a pledge.cancelled webhook', async () => {
    await request(app)
      .patch('/admin/pledges/p-pending/cancel')
      .send({ reason: 'Test' });
    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'pledge.cancelled',
      expect.objectContaining({ pledge: expect.any(Object) })
    );
  });
});

describe('Automatic pledge expiry (background job)', () => {
  beforeEach(() => {
    jest.resetModules();
    resetStore([
      { id: 'overdue-1', status: 'pending', expires_at: '2020-01-01T00:00:00.000Z' },
      { id: 'overdue-2', status: 'pending', expires_at: '2021-06-15T00:00:00.000Z' },
      { id: 'future-1',  status: 'pending', expires_at: '2099-12-31T00:00:00.000Z' },
    ]);
    mockDb();
  });

  afterEach(() => jest.clearAllMocks());

  it('expireOverdue marks past-due pending pledges as expired', async () => {
    const { expireOverdue } = require('../../src/services/PledgeFulfillmentService');
    const result = await expireOverdue('2026-01-01T00:00:00.000Z');
    expect(result.expired).toBe(2);
    const expired = _pledges.filter(p => p.status === 'expired');
    expect(expired).toHaveLength(2);
  });

  it('expireOverdue does not touch pledges with future expiry', async () => {
    const { expireOverdue } = require('../../src/services/PledgeFulfillmentService');
    await expireOverdue('2026-01-01T00:00:00.000Z');
    const future = _pledges.find(p => p.id === 'future-1');
    expect(future.status).toBe('pending');
  });

  it('expireOverdue returns {expired:0} when nothing is overdue', async () => {
    const { expireOverdue } = require('../../src/services/PledgeFulfillmentService');
    const result = await expireOverdue('1970-01-01T00:00:00.000Z');
    expect(result).toEqual({ expired: 0 });
  });

  it('fires pledge.expired webhooks for each expired pledge', async () => {
    const { expireOverdue } = require('../../src/services/PledgeFulfillmentService');
    await expireOverdue('2026-01-01T00:00:00.000Z');
    expect(WebhookService.deliver).toHaveBeenCalledWith(
      'pledge.expired',
      expect.any(Object)
    );
  });

  it('expiryWorker start/stop lifecycle does not throw', () => {
    jest.useFakeTimers();
    const worker = require('../../src/workers/expiryWorker');
    worker.stop(); // ensure clean state
    expect(() => worker.start()).not.toThrow();
    expect(() => worker.stop()).not.toThrow();
    jest.useRealTimers();
  });
});
