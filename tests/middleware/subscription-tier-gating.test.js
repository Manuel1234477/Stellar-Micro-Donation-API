'use strict';

/**
 * Tests: Subscription Tier Feature Gating (#612)
 * Covers: tier enforcement, 402 responses, X-Required-Tier header,
 *         TIER_FEATURES matrix, tierMeetsMinimum, requireTier middleware,
 *         GET /tiers/features, GET /api-keys/:id/tier
 */

const { tierMeetsMinimum, TIER_ORDER, TIER_FEATURES } = require('../../src/config/permissionMatrix');

// ─── tierMeetsMinimum ─────────────────────────────────────────────────────────

describe('tierMeetsMinimum', () => {
  it('free meets free', () => expect(tierMeetsMinimum('free', 'free')).toBe(true));
  it('basic meets free', () => expect(tierMeetsMinimum('basic', 'free')).toBe(true));
  it('basic meets basic', () => expect(tierMeetsMinimum('basic', 'basic')).toBe(true));
  it('pro meets basic', () => expect(tierMeetsMinimum('pro', 'basic')).toBe(true));
  it('pro meets pro', () => expect(tierMeetsMinimum('pro', 'pro')).toBe(true));
  it('enterprise meets pro', () => expect(tierMeetsMinimum('enterprise', 'pro')).toBe(true));
  it('enterprise meets enterprise', () => expect(tierMeetsMinimum('enterprise', 'enterprise')).toBe(true));

  it('free does NOT meet basic', () => expect(tierMeetsMinimum('free', 'basic')).toBe(false));
  it('free does NOT meet pro', () => expect(tierMeetsMinimum('free', 'pro')).toBe(false));
  it('basic does NOT meet pro', () => expect(tierMeetsMinimum('basic', 'pro')).toBe(false));
  it('pro does NOT meet enterprise', () => expect(tierMeetsMinimum('pro', 'enterprise')).toBe(false));

  it('returns false for unknown key tier', () => expect(tierMeetsMinimum('unknown', 'free')).toBe(false));
  it('returns false for undefined key tier', () => expect(tierMeetsMinimum(undefined, 'basic')).toBe(false));
  it('returns false for unknown min tier', () => expect(tierMeetsMinimum('pro', 'unknown')).toBe(false));
});

// ─── TIER_FEATURES ────────────────────────────────────────────────────────────

describe('TIER_FEATURES', () => {
  it('defines all four tiers', () => {
    expect(Object.keys(TIER_FEATURES)).toEqual(expect.arrayContaining(['free', 'basic', 'pro', 'enterprise']));
  });

  it('enterprise includes bulk_import', () => {
    expect(TIER_FEATURES.enterprise.features).toContain('bulk_import');
  });

  it('pro includes advanced_analytics and export', () => {
    expect(TIER_FEATURES.pro.features).toContain('advanced_analytics');
    expect(TIER_FEATURES.pro.features).toContain('export');
  });

  it('free does not include export or bulk_import', () => {
    expect(TIER_FEATURES.free.features).not.toContain('export');
    expect(TIER_FEATURES.free.features).not.toContain('bulk_import');
  });

  it('each tier has label, features, limits, description', () => {
    for (const tier of Object.values(TIER_FEATURES)) {
      expect(tier).toHaveProperty('label');
      expect(tier).toHaveProperty('features');
      expect(tier).toHaveProperty('limits');
      expect(tier).toHaveProperty('description');
    }
  });

  it('enterprise has unlimited donations (-1)', () => {
    expect(TIER_FEATURES.enterprise.limits.donationsPerDay).toBe(-1);
  });
});

// ─── TIER_ORDER ───────────────────────────────────────────────────────────────

describe('TIER_ORDER', () => {
  it('is ordered from lowest to highest', () => {
    expect(TIER_ORDER).toEqual(['free', 'basic', 'pro', 'enterprise']);
  });
});

// ─── requireTier middleware ───────────────────────────────────────────────────

const { requireTier } = require('../../src/middleware/rbac');

function mockReqRes(tier, role = 'user') {
  const req = { user: { id: 1, role }, apiKey: { tier } };
  const res = {
    _status: null, _body: null, _headers: {},
    status(s) { this._status = s; return this; },
    json(b) { this._body = b; return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return { req, res };
}

describe('requireTier middleware', () => {
  it('calls next() when tier meets minimum', () => {
    const { req, res } = mockReqRes('pro');
    const next = jest.fn();
    requireTier('pro')(req, res, next);
    expect(next).toHaveBeenCalledWith(); // called with no args = success
  });

  it('calls next() when tier exceeds minimum', () => {
    const { req, res } = mockReqRes('enterprise');
    const next = jest.fn();
    requireTier('basic')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 402 when tier is insufficient', () => {
    const { req, res } = mockReqRes('free');
    const next = jest.fn();
    requireTier('pro')(req, res, next);
    expect(res._status).toBe(402);
    expect(res._headers['X-Required-Tier']).toBe('pro');
    expect(res._body.error.code).toBe('TIER_REQUIRED');
    expect(res._body.error.requiredTier).toBe('pro');
    expect(res._body.error.currentTier).toBe('free');
    expect(next).not.toHaveBeenCalled();
  });

  it('sets X-Required-Tier header on 402', () => {
    const { req, res } = mockReqRes('basic');
    requireTier('enterprise')(req, res, jest.fn());
    expect(res._headers['X-Required-Tier']).toBe('enterprise');
  });

  it('admin role bypasses tier gating', () => {
    const { req, res } = mockReqRes('free', 'admin');
    const next = jest.fn();
    requireTier('enterprise')(req, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(res._status).toBeNull();
  });

  it('passes error to next() when no user attached', () => {
    const req = {};
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), setHeader: jest.fn() };
    const next = jest.fn();
    requireTier('pro')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('uses free tier when apiKey.tier is undefined', () => {
    const req = { user: { id: 1, role: 'user' }, apiKey: {} };
    const res = {
      _status: null, _headers: {},
      status(s) { this._status = s; return this; },
      json() { return this; },
      setHeader(k, v) { this._headers[k] = v; },
    };
    const next = jest.fn();
    requireTier('basic')(req, res, next);
    expect(res._status).toBe(402);
  });

  it('each tier level is correctly enforced', () => {
    const tiers = ['free', 'basic', 'pro', 'enterprise'];
    for (let i = 0; i < tiers.length; i++) {
      for (let j = 0; j < tiers.length; j++) {
        const { req, res } = mockReqRes(tiers[i]);
        const next = jest.fn();
        requireTier(tiers[j])(req, res, next);
        if (i >= j) {
          expect(next).toHaveBeenCalledWith(); // should pass
        } else {
          expect(res._status).toBe(402); // should be blocked
        }
      }
    }
  });
});

// ─── GET /tiers/features route handler ───────────────────────────────────────

describe('GET /tiers/features handler', () => {
  it('returns all tiers with features and limits', () => {
    const tiersRouter = require('../../src/routes/tiers');
    // Find the /features GET handler
    const featuresLayer = tiersRouter.stack.find(
      l => l.route && l.route.path === '/features' && l.route.methods.get
    );
    expect(featuresLayer).toBeDefined();

    const res = {
      _body: null,
      json(b) { this._body = b; },
    };
    featuresLayer.route.stack[0].handle({}, res);

    expect(res._body.success).toBe(true);
    expect(Array.isArray(res._body.data)).toBe(true);
    expect(res._body.data.map(t => t.tier)).toEqual(['free', 'basic', 'pro', 'enterprise']);
    for (const tier of res._body.data) {
      expect(tier).toHaveProperty('features');
      expect(tier).toHaveProperty('limits');
    }
  });
});

// ─── GET /api-keys/:id/tier route handler ────────────────────────────────────

const Database = require('../../src/utils/database');

describe('GET /api-keys/:id/tier handler', () => {
  beforeAll(async () => {
    await Database.initialize();
    try {
      await Database.run(`ALTER TABLE api_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`);
    } catch (e) { /* already exists */ }
  });

  afterAll(async () => {
    await Database.close();
  });

  it('returns tier for an existing API key', async () => {
    // Insert directly to avoid pre-existing createApiKey bug with monthlyQuota
    const crypto = require('crypto');
    const rawKey = crypto.randomBytes(32).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const result = await Database.run(
      `INSERT INTO api_keys (key_hash, key_prefix, name, role, status, created_at, grace_period_days, signing_required, tier)
       VALUES (?, ?, ?, ?, 'active', ?, 30, 0, 'pro')`,
      [keyHash, rawKey.substring(0, 8), 'tier-test-key', 'user', Date.now()]
    );

    const apiKeysRouter = require('../../src/routes/apiKeys');
    const tierLayer = apiKeysRouter.stack.find(
      l => l.route && l.route.path === '/:id/tier' && l.route.methods.get
    );
    expect(tierLayer).toBeDefined();

    const res = {
      _status: 200, _body: null,
      status(s) { this._status = s; return this; },
      json(b) { this._body = b; return this; },
    };
    const req = { params: { id: String(result.id) }, user: { id: 1, role: 'admin' } };
    const next = jest.fn();

    const handlers = tierLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, next);

    expect(res._body.success).toBe(true);
    expect(res._body.data.tier).toBe('pro');
  });

  it('returns 404 for non-existent key', async () => {
    const apiKeysRouter = require('../../src/routes/apiKeys');
    const tierLayer = apiKeysRouter.stack.find(
      l => l.route && l.route.path === '/:id/tier' && l.route.methods.get
    );
    if (!tierLayer) return;

    const res = {
      _status: 200, _body: null,
      status(s) { this._status = s; return this; },
      json(b) { this._body = b; return this; },
    };
    const req = { params: { id: '99999' }, user: { id: 1, role: 'admin' } };
    const handlers = tierLayer.route.stack;
    await handlers[handlers.length - 1].handle(req, res, jest.fn());
    expect(res._status).toBe(404);
  });
});
