'use strict';

/**
 * Subscription Tiers Tests
 *
 * Covers:
 * - SubscriptionTierService: tier creation, listing, subscription, cancellation, analytics
 * - POST /tiers, GET /tiers, POST /tiers/:id/subscribe, DELETE /tiers/subscriptions/:id
 * - GET /tiers/analytics
 * - Recurring donation created from tier config
 * - Auth enforcement
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../src/utils/database', () => ({
  run: jest.fn(),
  get: jest.fn(),
  query: jest.fn(),
}));
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
jest.mock('../src/services/AuditLogService', () => ({
  log: jest.fn().mockResolvedValue(undefined),
  CATEGORY: { CONFIGURATION: 'CONFIGURATION', DATA_ACCESS: 'DATA_ACCESS', FINANCIAL_OPERATION: 'FINANCIAL_OPERATION', AUTHORIZATION: 'AUTHORIZATION' },
  ACTION: {},
  SEVERITY: { HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' },
}));
jest.mock('../src/config/serviceContainer', () => ({
  getRecurringDonationScheduler: jest.fn(() => mockScheduler),
  getStellarService: jest.fn(() => ({})),
}));

// ─── Shared mock scheduler ────────────────────────────────────────────────────

const mockScheduler = {
  calculateNextExecutionDate: jest.fn((now, _interval) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() + 1);
    return d;
  }),
};

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const Database = require('../../src/utils/database');
const SubscriptionTierService = require('../../src/services/SubscriptionTierService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeService() {
  return new SubscriptionTierService(mockScheduler);
}

const TIER_ROW = { id: 1, name: 'Silver', amount: 25, interval: 'monthly', benefits: 'Newsletter', createdAt: '2026-01-01' };
const DONOR_ROW = { id: 10, publicKey: 'GDONOR123' };
const RECIPIENT_ROW = { id: 20, publicKey: 'GRECIP456' };

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionTierService unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SubscriptionTierService.createTier()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a tier and returns formatted row', async () => {
    Database.run.mockResolvedValue({ id: 1 });
    Database.get.mockResolvedValue(TIER_ROW);

    const svc = makeService();
    const tier = await svc.createTier({ name: 'Silver', amount: 25, interval: 'monthly', benefits: 'Newsletter' });

    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO subscription_tiers'),
      ['Silver', 25, 'monthly', 'Newsletter']
    );
    expect(tier.name).toBe('Silver');
    expect(tier.amount).toBe(25);
  });

  test('defaults interval to monthly', async () => {
    Database.run.mockResolvedValue({ id: 2 });
    Database.get.mockResolvedValue({ ...TIER_ROW, id: 2 });

    const svc = makeService();
    await svc.createTier({ name: 'Bronze', amount: 5 });

    expect(Database.run).toHaveBeenCalledWith(
      expect.any(String),
      ['Bronze', 5, 'monthly', null]
    );
  });

  test('throws ValidationError for missing name', async () => {
    const svc = makeService();
    await expect(svc.createTier({ amount: 10 })).rejects.toThrow('name is required');
  });

  test('throws ValidationError for non-positive amount', async () => {
    const svc = makeService();
    await expect(svc.createTier({ name: 'X', amount: -5 })).rejects.toThrow('amount must be a positive number');
    await expect(svc.createTier({ name: 'X', amount: 0 })).rejects.toThrow('amount must be a positive number');
  });

  test('throws ValidationError for invalid interval', async () => {
    const svc = makeService();
    await expect(svc.createTier({ name: 'X', amount: 10, interval: 'yearly' })).rejects.toThrow('interval must be one of');
  });

  test('throws DuplicateError on UNIQUE constraint violation', async () => {
    const uniqueErr = new Error('UNIQUE constraint failed');
    uniqueErr.code = 'SQLITE_CONSTRAINT';
    Database.run.mockRejectedValue(uniqueErr);

    const svc = makeService();
    await expect(svc.createTier({ name: 'Silver', amount: 25 })).rejects.toThrow('already exists');
  });
});

describe('SubscriptionTierService.listTiers()', () => {
  test('returns all tiers ordered by amount', async () => {
    Database.query.mockResolvedValue([
      { id: 1, name: 'Bronze', amount: 5, interval: 'monthly', benefits: null, createdAt: '2026-01-01' },
      { id: 2, name: 'Silver', amount: 25, interval: 'monthly', benefits: null, createdAt: '2026-01-01' },
    ]);

    const svc = makeService();
    const tiers = await svc.listTiers();

    expect(tiers).toHaveLength(2);
    expect(tiers[0].name).toBe('Bronze');
    expect(tiers[1].name).toBe('Silver');
  });
});

describe('SubscriptionTierService.subscribe()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates recurring donation and subscription record', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)          // getTierById
      .mockResolvedValueOnce(DONOR_ROW)          // donor lookup
      .mockResolvedValueOnce(RECIPIENT_ROW)      // recipient lookup
      .mockResolvedValueOnce(null)               // no existing active subscription
      .mockResolvedValueOnce({                   // getSubscriptionById
        id: 1, donorId: 10, tierId: 1, recurringDonationId: 5,
        status: 'active', createdAt: '2026-01-01', cancelledAt: null,
        tierName: 'Silver', tierAmount: 25, tierInterval: 'monthly',
      });

    Database.run
      .mockResolvedValueOnce({ id: 5 })  // INSERT recurring_donations
      .mockResolvedValueOnce({ id: 1 }); // INSERT donor_subscriptions

    const svc = makeService();
    const sub = await svc.subscribe({
      tierId: 1,
      donorPublicKey: 'GDONOR123',
      recipientPublicKey: 'GRECIP456',
    });

    // Recurring donation was created with tier's amount and interval
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recurring_donations'),
      expect.arrayContaining([10, 20, 25, 'monthly'])
    );

    expect(sub.recurringDonationId).toBe(5);
    expect(sub.status).toBe('active');
    expect(sub.tierName).toBe('Silver');
  });

  test('throws NotFoundError when donor does not exist', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)  // tier
      .mockResolvedValueOnce(null);     // donor not found

    const svc = makeService();
    await expect(svc.subscribe({ tierId: 1, donorPublicKey: 'GNONE', recipientPublicKey: 'GRECIP456' }))
      .rejects.toThrow('Donor wallet not found');
  });

  test('throws NotFoundError when recipient does not exist', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)
      .mockResolvedValueOnce(DONOR_ROW)
      .mockResolvedValueOnce(null); // recipient not found

    const svc = makeService();
    await expect(svc.subscribe({ tierId: 1, donorPublicKey: 'GDONOR123', recipientPublicKey: 'GNONE' }))
      .rejects.toThrow('Recipient wallet not found');
  });

  test('throws ValidationError for self-donation', async () => {
    const sameUser = { id: 10, publicKey: 'GSAME' };
    Database.get
      .mockResolvedValueOnce(TIER_ROW)
      .mockResolvedValueOnce(sameUser)
      .mockResolvedValueOnce(sameUser);

    const svc = makeService();
    await expect(svc.subscribe({ tierId: 1, donorPublicKey: 'GSAME', recipientPublicKey: 'GSAME' }))
      .rejects.toThrow('cannot be the same');
  });

  test('throws DuplicateError when donor already has active subscription to tier', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)
      .mockResolvedValueOnce(DONOR_ROW)
      .mockResolvedValueOnce(RECIPIENT_ROW)
      .mockResolvedValueOnce({ id: 99 }); // existing active subscription

    const svc = makeService();
    await expect(svc.subscribe({ tierId: 1, donorPublicKey: 'GDONOR123', recipientPublicKey: 'GRECIP456' }))
      .rejects.toThrow('already has an active subscription');
  });

  test('uses scheduler.calculateNextExecutionDate when no startDate provided', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)
      .mockResolvedValueOnce(DONOR_ROW)
      .mockResolvedValueOnce(RECIPIENT_ROW)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1, donorId: 10, tierId: 1, recurringDonationId: 5,
        status: 'active', createdAt: '2026-01-01', cancelledAt: null,
        tierName: 'Silver', tierAmount: 25, tierInterval: 'monthly',
      });
    Database.run.mockResolvedValue({ id: 1 });

    const svc = makeService();
    await svc.subscribe({ tierId: 1, donorPublicKey: 'GDONOR123', recipientPublicKey: 'GRECIP456' });

    expect(mockScheduler.calculateNextExecutionDate).toHaveBeenCalled();
  });
});

describe('SubscriptionTierService.cancelSubscription()', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cancels subscription and linked recurring donation', async () => {
    const subRow = { id: 1, donorId: 10, tierId: 1, recurringDonationId: 5, status: 'active' };
    const cancelledRow = {
      id: 1, donorId: 10, tierId: 1, recurringDonationId: 5,
      status: 'cancelled', createdAt: '2026-01-01', cancelledAt: '2026-03-27',
      tierName: 'Silver', tierAmount: 25, tierInterval: 'monthly',
    };

    Database.get
      .mockResolvedValueOnce(subRow)     // find subscription
      .mockResolvedValueOnce(cancelledRow); // getSubscriptionById after update
    Database.run.mockResolvedValue({ changes: 1 });

    const svc = makeService();
    const result = await svc.cancelSubscription(1);

    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining("status = 'cancelled'"),
      [1]
    );
    expect(Database.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE recurring_donations'),
      ['cancelled', 5]
    );
    expect(result.status).toBe('cancelled');
  });

  test('throws NotFoundError for unknown subscription', async () => {
    Database.get.mockResolvedValueOnce(null);
    const svc = makeService();
    await expect(svc.cancelSubscription(999)).rejects.toThrow('Subscription not found');
  });
});

describe('SubscriptionTierService.getTierAnalytics()', () => {
  test('returns subscriber counts and revenue per tier', async () => {
    Database.query.mockResolvedValue([
      { id: 1, name: 'Bronze', amount: 5, interval: 'monthly', activeSubscribers: 10, cancelledSubscribers: 2, totalSubscribers: 12, activeRevenue: 50 },
      { id: 2, name: 'Gold', amount: 100, interval: 'monthly', activeSubscribers: 3, cancelledSubscribers: 0, totalSubscribers: 3, activeRevenue: 300 },
    ]);

    const svc = makeService();
    const analytics = await svc.getTierAnalytics();

    expect(analytics).toHaveLength(2);
    expect(analytics[0].name).toBe('Bronze');
    expect(analytics[0].activeSubscribers).toBe(10);
    expect(analytics[0].activeRevenue).toBe(50);
    expect(analytics[1].name).toBe('Gold');
    expect(analytics[1].activeRevenue).toBe(300);
  });

  test('handles tiers with no subscribers', async () => {
    Database.query.mockResolvedValue([
      { id: 1, name: 'Bronze', amount: 5, interval: 'monthly', activeSubscribers: 0, cancelledSubscribers: 0, totalSubscribers: 0, activeRevenue: 0 },
    ]);

    const svc = makeService();
    const analytics = await svc.getTierAnalytics();

    expect(analytics[0].activeSubscribers).toBe(0);
    expect(analytics[0].activeRevenue).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route integration tests
// ─────────────────────────────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');

function buildApp() {
  const app = express();
  app.use(express.json());
  const tiersRouter = require('../../src/routes/tiers');
  app.use('/tiers', tiersRouter);
  app.use((err, req, res, _next) => {
    res.status(err.statusCode || err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

describe('POST /tiers', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a tier and returns 201', async () => {
    Database.run.mockResolvedValue({ id: 1 });
    Database.get.mockResolvedValue(TIER_ROW);

    const res = await buildApp()
      ._router
      ? request(buildApp()).post('/tiers').send({ name: 'Silver', amount: 25 })
      : null;

    const app = buildApp();
    const response = await request(app).post('/tiers').send({ name: 'Silver', amount: 25 });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.name).toBe('Silver');
  });

  test('returns 400 for missing name', async () => {
    const app = buildApp();
    const response = await request(app).post('/tiers').send({ amount: 25 });
    expect(response.status).toBe(400);
  });

  test('returns 400 for invalid amount', async () => {
    const app = buildApp();
    const response = await request(app).post('/tiers').send({ name: 'X', amount: -1 });
    expect(response.status).toBe(400);
  });
});

describe('GET /tiers', () => {
  test('returns list of tiers', async () => {
    Database.query.mockResolvedValue([TIER_ROW]);

    const app = buildApp();
    const response = await request(app).get('/tiers');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.count).toBe(1);
  });
});

describe('POST /tiers/:id/subscribe', () => {
  beforeEach(() => jest.clearAllMocks());

  test('subscribes donor and returns 201 with subscription', async () => {
    Database.get
      .mockResolvedValueOnce(TIER_ROW)
      .mockResolvedValueOnce(DONOR_ROW)
      .mockResolvedValueOnce(RECIPIENT_ROW)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 1, donorId: 10, tierId: 1, recurringDonationId: 5,
        status: 'active', createdAt: '2026-01-01', cancelledAt: null,
        tierName: 'Silver', tierAmount: 25, tierInterval: 'monthly',
      });
    Database.run.mockResolvedValue({ id: 1 });

    const app = buildApp();
    const response = await request(app)
      .post('/tiers/1/subscribe')
      .send({ donorPublicKey: 'GDONOR123', recipientPublicKey: 'GRECIP456' });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.recurringDonationId).toBe(5);
    expect(response.body.data.tierName).toBe('Silver');
  });

  test('returns 400 when donorPublicKey is missing', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/tiers/1/subscribe')
      .send({ recipientPublicKey: 'GRECIP456' });

    expect(response.status).toBe(400);
  });

  test('returns 404 when tier does not exist', async () => {
    const { NotFoundError } = require('../../src/utils/errors');
    Database.get.mockResolvedValueOnce(null); // tier not found

    const app = buildApp();
    const response = await request(app)
      .post('/tiers/999/subscribe')
      .send({ donorPublicKey: 'GDONOR123', recipientPublicKey: 'GRECIP456' });

    expect(response.status).toBe(404);
  });

  test('returns 400 for invalid tier ID', async () => {
    const app = buildApp();
    const response = await request(app)
      .post('/tiers/abc/subscribe')
      .send({ donorPublicKey: 'GDONOR123', recipientPublicKey: 'GRECIP456' });

    expect(response.status).toBe(400);
  });
});

describe('DELETE /tiers/subscriptions/:subId', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cancels subscription and returns updated record', async () => {
    const subRow = { id: 1, donorId: 10, tierId: 1, recurringDonationId: 5, status: 'active' };
    const cancelledRow = {
      id: 1, donorId: 10, tierId: 1, recurringDonationId: 5,
      status: 'cancelled', createdAt: '2026-01-01', cancelledAt: '2026-03-27',
      tierName: 'Silver', tierAmount: 25, tierInterval: 'monthly',
    };
    Database.get.mockResolvedValueOnce(subRow).mockResolvedValueOnce(cancelledRow);
    Database.run.mockResolvedValue({ changes: 1 });

    const app = buildApp();
    const response = await request(app).delete('/tiers/subscriptions/1');

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('cancelled');
  });

  test('returns 404 for unknown subscription', async () => {
    Database.get.mockResolvedValueOnce(null);

    const app = buildApp();
    const response = await request(app).delete('/tiers/subscriptions/999');

    expect(response.status).toBe(404);
  });
});

describe('GET /tiers/analytics', () => {
  test('returns analytics per tier', async () => {
    Database.query.mockResolvedValue([
      { id: 1, name: 'Bronze', amount: 5, interval: 'monthly', activeSubscribers: 10, cancelledSubscribers: 2, totalSubscribers: 12, activeRevenue: 50 },
    ]);

    const app = buildApp();
    const response = await request(app).get('/tiers/analytics');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data[0].activeSubscribers).toBe(10);
    expect(response.body.data[0].activeRevenue).toBe(50);
  });
});

describe('Auth enforcement', () => {
  test('POST /tiers uses ADMIN_ALL permission', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../src/routes/tiers.js'), 'utf8');
    expect(src).toMatch(/PERMISSIONS\.ADMIN_ALL/);
  });

  test('POST /tiers/:id/subscribe uses STREAM_CREATE permission', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../src/routes/tiers.js'), 'utf8');
    expect(src).toMatch(/PERMISSIONS\.STREAM_CREATE/);
  });

  test('GET /tiers/analytics uses STATS_ADMIN permission', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../src/routes/tiers.js'), 'utf8');
    expect(src).toMatch(/PERMISSIONS\.STATS_ADMIN/);
  });
});
