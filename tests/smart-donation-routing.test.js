'use strict';

/**
 * Tests: Smart Donation Routing
 * Covers: round-robin, weighted, priority strategies; strategy config endpoints;
 *         routing decision persistence and pagination; admin-only enforcement.
 */

// Mock heavy dependencies not installed in this project
jest.mock('uuid', () => ({ v4: () => 'mock-uuid-' + Math.random().toString(36).slice(2) }), { virtual: true });
jest.mock('@opentelemetry/api', () => ({}), { virtual: true });
jest.mock('nodemailer', () => ({}), { virtual: true });

// Mock apiKey middleware — auth is tested separately; here we inject role via req.user
jest.mock('../src/middleware/apiKey', () => (req, _res, next) => next());

// Mock rbac — requireAdmin checks req.user.role
jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: () => (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin required' } });
    }
    next();
  },
  attachUserRole: () => (_req, _res, next) => next(),
  checkPermission: () => (_req, _res, next) => next(),
}));

// Mock serviceContainer to avoid pulling in the full app bootstrap
jest.mock('../src/config/serviceContainer', () => {
  const RecipientPoolRepository = require('../src/services/RecipientPoolRepository');
  const RoundRobinStateRepository = require('../src/services/RoundRobinStateRepository');
  const RoutingDecisionRepository = require('../src/services/RoutingDecisionRepository');
  const RoutingConfigRepository = require('../src/services/RoutingConfigRepository');
  const poolRepo = new RecipientPoolRepository();
  const rrRepo = new RoundRobinStateRepository();
  const decisionRepo = new RoutingDecisionRepository();
  const configRepo = new RoutingConfigRepository();
  return {
    getRecipientPoolRepo: () => poolRepo,
    getRoundRobinStateRepo: () => rrRepo,
    getRoutingDecisionRepo: () => decisionRepo,
    getRoutingConfigRepo: () => configRepo,
  };
});

const express = require('express');
const request = require('supertest');
const Database = require('../src/utils/database');
const RoundRobinStrategy = require('../src/services/routing/RoundRobinStrategy');
const WeightedStrategy = require('../src/services/routing/WeightedStrategy');
const PriorityStrategy = require('../src/services/routing/PriorityStrategy');
const DonationRouter = require('../src/services/DonationRouter');
const RecipientPoolRepository = require('../src/services/RecipientPoolRepository');
const RoundRobinStateRepository = require('../src/services/RoundRobinStateRepository');
const RoutingDecisionRepository = require('../src/services/RoutingDecisionRepository');
const RoutingConfigRepository = require('../src/services/RoutingConfigRepository');
const DonationTotalsRepository = require('../src/services/DonationTotalsRepository');
const adminRoutingRouter = require('../src/routes/admin/routing');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp({ role = 'admin' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.apiKey = { role, isLegacy: true };
    req.user = { id: 'test-user', role };
    next();
  });
  app.use('/admin/routing', adminRoutingRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || err.statusCode || 500).json({
      success: false,
      error: { code: err.code || 'ERROR', message: err.message },
    });
  });
  return app;
}

async function ensureRoutingTables() {
  await Database.run(`CREATE TABLE IF NOT EXISTS recipient_pools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS recipient_pool_members (
    pool_name TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    latitude REAL, longitude REAL, campaign_deadline DATETIME,
    display_name TEXT, weight REAL DEFAULT 1, priority REAL DEFAULT 0,
    PRIMARY KEY (pool_name, recipient_id)
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS round_robin_state (
    pool_name TEXT PRIMARY KEY,
    next_index INTEGER NOT NULL DEFAULT 0,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS routing_decisions (
    id TEXT PRIMARY KEY,
    donation_id TEXT NOT NULL,
    pool_name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    selected_id TEXT NOT NULL,
    candidates TEXT NOT NULL,
    excluded TEXT NOT NULL,
    decided_at DATETIME NOT NULL,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS routing_config (
    pool_name TEXT PRIMARY KEY,
    strategy TEXT NOT NULL,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function cleanRoutingTables() {
  await Database.run(`DELETE FROM routing_decisions`);
  await Database.run(`DELETE FROM round_robin_state`);
  await Database.run(`DELETE FROM recipient_pool_members`);
  await Database.run(`DELETE FROM recipient_pools`);
  await Database.run(`DELETE FROM routing_config`);
}

// ── Unit: RoundRobinStrategy ──────────────────────────────────────────────────

describe('RoundRobinStrategy', () => {
  const strategy = new RoundRobinStrategy();
  const pool = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

  it('selects the recipient at currentIndex', () => {
    expect(strategy.select(pool, { currentIndex: 0 }).selectedId).toBe('A');
    expect(strategy.select(pool, { currentIndex: 1 }).selectedId).toBe('B');
    expect(strategy.select(pool, { currentIndex: 2 }).selectedId).toBe('C');
  });

  it('returns no excluded IDs', () => {
    expect(strategy.select(pool, { currentIndex: 0 }).excludedIds).toEqual([]);
  });

  it('distributes evenly across recipients via DonationRouter', async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();

    const poolRepo = new RecipientPoolRepository();
    const rrRepo = new RoundRobinStateRepository();
    const decisionRepo = new RoutingDecisionRepository();
    const totalsRepo = new DonationTotalsRepository();

    const poolName = 'rr-test-pool';
    await poolRepo.create(poolName, [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }]);

    const router = new DonationRouter({
      recipientPoolRepo: poolRepo,
      routingDecisionRepo: decisionRepo,
      roundRobinStateRepo: rrRepo,
      donationTotalsRepo: totalsRepo,
    });

    const counts = { X: 0, Y: 0, Z: 0 };
    for (let i = 0; i < 9; i++) {
      const { recipientId } = await router.route({
        poolName,
        routingStrategy: 'round-robin',
        donationId: `don-rr-${i}`,
      });
      counts[recipientId]++;
    }

    // Each recipient should be selected exactly 3 times
    expect(counts.X).toBe(3);
    expect(counts.Y).toBe(3);
    expect(counts.Z).toBe(3);
  });
});

// ── Unit: WeightedStrategy ────────────────────────────────────────────────────

describe('WeightedStrategy', () => {
  const strategy = new WeightedStrategy();

  it('selects from pool (basic smoke test)', () => {
    const pool = [{ id: 'A', weight: 1 }, { id: 'B', weight: 1 }];
    const { selectedId, excludedIds } = strategy.select(pool, {});
    expect(['A', 'B']).toContain(selectedId);
    expect(excludedIds).toEqual([]);
  });

  it('defaults missing weight to 1', () => {
    const pool = [{ id: 'A' }, { id: 'B' }];
    const { selectedId } = strategy.select(pool, {});
    expect(['A', 'B']).toContain(selectedId);
  });

  it('respects configured weights — high-weight recipient wins most often', () => {
    const pool = [{ id: 'LOW', weight: 1 }, { id: 'HIGH', weight: 99 }];
    const counts = { LOW: 0, HIGH: 0 };
    for (let i = 0; i < 200; i++) {
      counts[strategy.select(pool, {}).selectedId]++;
    }
    expect(counts.HIGH).toBeGreaterThan(counts.LOW);
  });

  it('works with a single recipient', () => {
    const pool = [{ id: 'ONLY', weight: 5 }];
    expect(strategy.select(pool, {}).selectedId).toBe('ONLY');
  });
});

// ── Unit: PriorityStrategy ────────────────────────────────────────────────────

describe('PriorityStrategy', () => {
  const strategy = new PriorityStrategy();

  it('selects the highest-priority recipient', () => {
    const pool = [
      { id: 'low', priority: 1 },
      { id: 'high', priority: 10 },
      { id: 'mid', priority: 5 },
    ];
    expect(strategy.select(pool, {}).selectedId).toBe('high');
  });

  it('defaults missing priority to 0', () => {
    const pool = [{ id: 'A' }, { id: 'B', priority: 3 }];
    expect(strategy.select(pool, {}).selectedId).toBe('B');
  });

  it('tiebreaks by lexicographically smallest id', () => {
    const pool = [{ id: 'beta', priority: 5 }, { id: 'alpha', priority: 5 }];
    expect(strategy.select(pool, {}).selectedId).toBe('alpha');
  });

  it('returns no excluded IDs', () => {
    const pool = [{ id: 'A', priority: 1 }];
    expect(strategy.select(pool, {}).excludedIds).toEqual([]);
  });

  it('works with a single recipient', () => {
    expect(strategy.select([{ id: 'ONLY', priority: 7 }], {}).selectedId).toBe('ONLY');
  });
});

// ── Integration: DonationRouter ───────────────────────────────────────────────

describe('DonationRouter — routing decisions persisted', () => {
  let poolRepo, rrRepo, decisionRepo, totalsRepo, router;
  const poolName = 'persist-test-pool';

  beforeAll(async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();

    poolRepo = new RecipientPoolRepository();
    rrRepo = new RoundRobinStateRepository();
    decisionRepo = new RoutingDecisionRepository();
    totalsRepo = new DonationTotalsRepository();

    router = new DonationRouter({
      recipientPoolRepo: poolRepo,
      routingDecisionRepo: decisionRepo,
      roundRobinStateRepo: rrRepo,
      donationTotalsRepo: totalsRepo,
    });

    await poolRepo.create(poolName, [
      { id: 'r1', weight: 2, priority: 5 },
      { id: 'r2', weight: 1, priority: 1 },
    ]);
  });

  it('persists a routing decision with correct fields', async () => {
    const { recipientId, routingDecisionId } = await router.route({
      poolName,
      routingStrategy: 'priority',
      donationId: 'don-persist-1',
    });

    expect(recipientId).toBe('r1'); // highest priority
    expect(routingDecisionId).toBeTruthy();

    const decisions = await decisionRepo.findByDonationId('don-persist-1');
    expect(decisions).toHaveLength(1);
    expect(decisions[0].strategy).toBe('priority');
    expect(decisions[0].selectedId).toBe('r1');
    expect(decisions[0].poolName).toBe(poolName);
    expect(decisions[0].donationId).toBe('don-persist-1');
    expect(decisions[0].candidates).toContain('r1');
    expect(decisions[0].candidates).toContain('r2');
    expect(decisions[0].decidedAt).toBeTruthy();
  });

  it('throws ValidationError for unknown strategy', async () => {
    await expect(
      router.route({ poolName, routingStrategy: 'unknown', donationId: 'x' })
    ).rejects.toThrow(/Unrecognized routing strategy/);
  });

  it('throws BusinessLogicError for empty pool', async () => {
    await poolRepo.create('empty-pool', []);
    await expect(
      router.route({ poolName: 'empty-pool', routingStrategy: 'round-robin', donationId: 'x' })
    ).rejects.toThrow(/empty/i);
  });
});

// ── API: POST /admin/routing/strategies ──────────────────────────────────────

describe('POST /admin/routing/strategies', () => {
  let app;

  beforeAll(async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();
    app = buildApp({ role: 'admin' });
  });

  it('sets a strategy for a pool', async () => {
    const res = await request(app)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-a', strategy: 'round-robin' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.poolName).toBe('pool-a');
    expect(res.body.data.strategy).toBe('round-robin');
  });

  it('updates an existing strategy (upsert)', async () => {
    await request(app)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-b', strategy: 'weighted' });

    const res = await request(app)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-b', strategy: 'priority' });

    expect(res.status).toBe(200);
    expect(res.body.data.strategy).toBe('priority');
  });

  it('returns 400 when poolName is missing', async () => {
    const res = await request(app)
      .post('/admin/routing/strategies')
      .send({ strategy: 'round-robin' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when strategy is missing', async () => {
    const res = await request(app)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-c' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid strategy name', async () => {
    const res = await request(app)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-c', strategy: 'random-nonsense' });
    expect(res.status).toBe(400);
  });

  it('rejects non-admin with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp)
      .post('/admin/routing/strategies')
      .send({ poolName: 'pool-x', strategy: 'round-robin' });
    expect(res.status).toBe(403);
  });
});

// ── API: GET /admin/routing/strategies ───────────────────────────────────────

describe('GET /admin/routing/strategies', () => {
  let app;

  beforeAll(async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();
    app = buildApp({ role: 'admin' });

    await request(app).post('/admin/routing/strategies').send({ poolName: 'pool-1', strategy: 'round-robin' });
    await request(app).post('/admin/routing/strategies').send({ poolName: 'pool-2', strategy: 'weighted' });
  });

  it('returns all configured strategies', async () => {
    const res = await request(app).get('/admin/routing/strategies');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('returns strategy for a specific pool', async () => {
    const res = await request(app).get('/admin/routing/strategies?poolName=pool-1');
    expect(res.status).toBe(200);
    expect(res.body.data.strategy).toBe('round-robin');
    expect(res.body.data.poolName).toBe('pool-1');
  });

  it('returns 404 for unconfigured pool', async () => {
    const res = await request(app).get('/admin/routing/strategies?poolName=nonexistent');
    expect(res.status).toBe(404);
  });

  it('rejects non-admin with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).get('/admin/routing/strategies');
    expect(res.status).toBe(403);
  });
});

// ── API: GET /admin/routing/decisions ────────────────────────────────────────

describe('GET /admin/routing/decisions', () => {
  let app;
  let decisionRepo;

  beforeAll(async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();
    app = buildApp({ role: 'admin' });

    // Seed some decisions directly via the repo
    decisionRepo = new RoutingDecisionRepository();
    for (let i = 0; i < 5; i++) {
      await decisionRepo.create({
        donationId: `don-${i}`,
        poolName: 'decisions-pool',
        strategy: i % 2 === 0 ? 'round-robin' : 'weighted',
        selectedId: `r${i}`,
        candidates: [`r${i}`, 'other'],
        excluded: [],
        decidedAt: new Date().toISOString(),
      });
    }
  });

  it('returns decisions filtered by poolName', async () => {
    const res = await request(app).get('/admin/routing/decisions?poolName=decisions-pool');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(5);
  });

  it('returns decisions filtered by strategy', async () => {
    const res = await request(app).get('/admin/routing/decisions?strategy=round-robin');
    expect(res.status).toBe(200);
    expect(res.body.data.every(d => d.strategy === 'round-robin')).toBe(true);
  });

  it('returns decisions filtered by donationId', async () => {
    const res = await request(app).get('/admin/routing/decisions?donationId=don-0');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].donationId).toBe('don-0');
  });

  it('returns all decisions when no filter is provided', async () => {
    const res = await request(app).get('/admin/routing/decisions');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(5);
  });

  it('paginates results with page and limit', async () => {
    const page1 = await request(app).get('/admin/routing/decisions?limit=2&page=1');
    const page2 = await request(app).get('/admin/routing/decisions?limit=2&page=2');

    expect(page1.status).toBe(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.limit).toBe(2);
    expect(page1.body.page).toBe(1);

    expect(page2.status).toBe(200);
    expect(page2.body.page).toBe(2);

    // Pages should not overlap
    const ids1 = page1.body.data.map(d => d.id);
    const ids2 = page2.body.data.map(d => d.id);
    expect(ids1.some(id => ids2.includes(id))).toBe(false);
  });

  it('includes total, count, page, limit in response', async () => {
    const res = await request(app).get('/admin/routing/decisions?limit=3&page=1');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('count');
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('limit');
  });

  it('rejects non-admin with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).get('/admin/routing/decisions');
    expect(res.status).toBe(403);
  });

  it('rejects guest with 403', async () => {
    const guestApp = buildApp({ role: 'guest' });
    const res = await request(guestApp).get('/admin/routing/decisions');
    expect(res.status).toBe(403);
  });
});

// ── API: Pool management endpoints ───────────────────────────────────────────

describe('Pool management endpoints', () => {
  let app;

  beforeAll(async () => {
    await Database.initialize();
    await ensureRoutingTables();
    await cleanRoutingTables();
    app = buildApp({ role: 'admin' });
  });

  it('creates a pool and lists its members', async () => {
    const create = await request(app)
      .post('/admin/routing/pools')
      .send({ name: 'my-pool', recipients: [{ id: 'r1', displayName: 'Recipient 1' }] });
    expect(create.status).toBe(201);

    const get = await request(app).get('/admin/routing/pools/my-pool');
    expect(get.status).toBe(200);
    expect(get.body.data.members).toHaveLength(1);
    expect(get.body.data.members[0].id).toBe('r1');
  });

  it('returns 400 when pool name is missing', async () => {
    const res = await request(app).post('/admin/routing/pools').send({});
    expect(res.status).toBe(400);
  });

  it('rejects non-admin pool creation with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp)
      .post('/admin/routing/pools')
      .send({ name: 'x' });
    expect(res.status).toBe(403);
  });
});
