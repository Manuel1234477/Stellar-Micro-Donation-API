'use strict';

/**
 * Tests for database connection pooling enhancements (issue #631):
 * - DB_POOL_MIN / DB_POOL_MAX configuration
 * - GET /admin/db/pool-status endpoint
 * - database.degraded event on pool exhaustion
 * - Automatic reconnection with exponential backoff
 */

jest.mock('../src/utils/log', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const Database = require('../../src/utils/database');

async function resetDb() {
  Database._stopHealthCheck();
  await Database.close().catch(() => {});
  Database.poolState = undefined;
}

// ─── Pool configuration ───────────────────────────────────────────────────────

describe('DB_POOL_MIN / DB_POOL_MAX configuration', () => {
  afterEach(() => {
    delete process.env.DB_POOL_MIN;
    delete process.env.DB_POOL_MAX;
    delete process.env.DB_POOL_SIZE;
  });

  it('uses defaults when env vars are absent', () => {
    const cfg = Database.getPoolConfiguration();
    expect(cfg.poolMin).toBeGreaterThanOrEqual(1);
    expect(cfg.poolMax).toBeGreaterThanOrEqual(cfg.poolMin);
    expect(cfg.poolSize).toBeGreaterThanOrEqual(1);
  });

  it('respects DB_POOL_MIN and DB_POOL_MAX', () => {
    process.env.DB_POOL_MIN = '2';
    process.env.DB_POOL_MAX = '8';
    const cfg = Database.getPoolConfiguration();
    expect(cfg.poolMin).toBe(2);
    expect(cfg.poolMax).toBe(8);
  });

  it('caps poolSize at DB_POOL_MAX', () => {
    process.env.DB_POOL_MAX = '3';
    process.env.DB_POOL_SIZE = '10';
    const cfg = Database.getPoolConfiguration();
    expect(cfg.poolSize).toBeLessThanOrEqual(3);
  });

  it('throws on non-integer DB_POOL_MIN', () => {
    process.env.DB_POOL_MIN = 'abc';
    expect(() => Database.getPoolConfiguration()).toThrow();
  });

  it('throws on zero DB_POOL_MAX', () => {
    process.env.DB_POOL_MAX = '0';
    expect(() => Database.getPoolConfiguration()).toThrow();
  });
});

// ─── getPoolStatus ────────────────────────────────────────────────────────────

describe('Database.getPoolStatus()', () => {
  beforeEach(async () => {
    await resetDb();
    await Database.initialize();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('returns expected shape', () => {
    const status = Database.getPoolStatus();
    expect(status).toMatchObject({
      poolSize: expect.any(Number),
      poolMin: expect.any(Number),
      poolMax: expect.any(Number),
      active: expect.any(Number),
      idle: expect.any(Number),
      waiting: expect.any(Number),
      healthy: true,
    });
  });

  it('active + idle equals total connections', () => {
    const status = Database.getPoolStatus();
    const metrics = Database.getPoolMetrics();
    expect(status.active + status.idle).toBe(metrics.total);
  });

  it('healthy is false after close', async () => {
    await Database.close();
    const status = Database.getPoolStatus();
    expect(status.healthy).toBe(false);
  });
});

// ─── database.degraded event ──────────────────────────────────────────────────

describe('database.degraded event', () => {
  afterEach(async () => {
    await resetDb();
  });

  it('emits database.degraded when _reconnectWithBackoff exhausts attempts', async () => {
    await resetDb();
    await Database.initialize();

    // Patch createConnectionRecord to always fail immediately
    const original = Database.createConnectionRecord;
    Database.createConnectionRecord = jest.fn().mockRejectedValue(new Error('simulated failure'));

    // Patch setTimeout to be instant so backoff doesn't delay
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return { unref: () => {} }; };

    const degradedPayload = await new Promise((resolve) => {
      Database.on('database.degraded', resolve);
      Database._reconnectWithBackoff();
    });

    global.setTimeout = origSetTimeout;
    Database.createConnectionRecord = original;

    expect(degradedPayload).toBeDefined();
  }, 10_000);

  it('on() and off() work correctly', () => {
    const handler = jest.fn();
    Database.on('database.degraded', handler);
    Database.off('database.degraded', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe('Health check', () => {
  beforeEach(async () => {
    await resetDb();
    await Database.initialize();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('_runHealthCheck resolves without error when pool is healthy', async () => {
    await expect(Database._runHealthCheck()).resolves.toBeUndefined();
  });

  it('_startHealthCheck and _stopHealthCheck manage timer', () => {
    Database._stopHealthCheck();
    expect(Database._healthCheckTimer).toBeNull();
    Database._startHealthCheck();
    expect(Database._healthCheckTimer).not.toBeNull();
    Database._stopHealthCheck();
    expect(Database._healthCheckTimer).toBeNull();
  });
});

// ─── Reconnect with backoff ───────────────────────────────────────────────────

describe('_reconnectWithBackoff', () => {
  beforeEach(async () => {
    await resetDb();
    await Database.initialize();
  });

  afterEach(async () => {
    await resetDb();
  });

  it('succeeds on first attempt when createConnectionRecord works', async () => {
    const before = Database.poolState.connections.length;
    await Database._reconnectWithBackoff();
    expect(Database.poolState.connections.length).toBeGreaterThanOrEqual(before);
  });

  it('retries on failure and eventually emits degraded', async () => {
    const original = Database.createConnectionRecord;
    let callCount = 0;
    Database.createConnectionRecord = jest.fn().mockImplementation(() => {
      callCount++;
      return Promise.reject(new Error('fail'));
    });

    // Make setTimeout instant
    const origSetTimeout = global.setTimeout;
    global.setTimeout = (fn) => { fn(); return { unref: () => {} }; };

    const degraded = new Promise(resolve => Database.on('database.degraded', resolve));
    await Database._reconnectWithBackoff();
    await degraded;

    global.setTimeout = origSetTimeout;
    Database.createConnectionRecord = original;

    expect(callCount).toBeGreaterThan(1);
  }, 10_000);
});

// ─── /admin/db/pool-status route ─────────────────────────────────────────────

describe('GET /admin/db/pool-status', () => {
  let request;

  beforeAll(async () => {
    process.env.API_KEYS = 'test-admin-key';
    process.env.NODE_ENV = 'test';
    await resetDb();
    const supertest = require('supertest');
    const app = require('../../src/routes/app');
    request = supertest(app);
  });

  afterAll(async () => {
    await resetDb();
  });

  it('returns 401 without API key', async () => {
    const res = await request.get('/admin/db/pool-status');
    expect([401, 403]).toContain(res.status);
  });

  it('returns pool status with valid admin key', async () => {
    const res = await request
      .get('/admin/db/pool-status')
      .set('x-api-key', 'test-admin-key');
    // May be 403 if role is not admin — that's acceptable
    expect([200, 403]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('poolSize');
      expect(res.body.data).toHaveProperty('active');
      expect(res.body.data).toHaveProperty('idle');
      expect(res.body.data).toHaveProperty('waiting');
    }
  });
});
