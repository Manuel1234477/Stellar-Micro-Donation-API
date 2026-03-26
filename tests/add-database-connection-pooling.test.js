const request = require('supertest');

const DEFAULT_TEST_ENV = {
  MOCK_STELLAR: 'true',
  API_KEYS: 'test-key-1,test-key-2,test-key,admin-test-key',
  NODE_ENV: 'test',
};

const POOL_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS pool_test_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL
  )
`;

const ENV_KEYS = ['DB_POOL_SIZE', 'DB_ACQUIRE_TIMEOUT'];

/**
 * Pause execution long enough for queue state to settle.
 *
 * @param {number} ms - Delay duration in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reset process environment variables used by the database pool tests.
 *
 * @param {Object} overrides - Environment overrides for the current test.
 * @returns {void}
 */
function applyTestEnvironment(overrides = {}) {
  Object.assign(process.env, DEFAULT_TEST_ENV);

  ENV_KEYS.forEach((key) => {
    delete process.env[key];
  });

  Object.assign(process.env, overrides);
}

/**
 * Load a fresh Database module instance with optional env overrides.
 *
 * @param {Object} envOverrides - Environment overrides for the module load.
 * @returns {Promise<Object>} Fresh Database module.
 */
async function loadDatabase(envOverrides = {}) {
  jest.resetModules();
  applyTestEnvironment(envOverrides);

  const Database = require('../src/utils/database');
  await Database.initialize();
  await Database.run(POOL_TABLE_SQL);
  await Database.run('DELETE FROM pool_test_records');

  return Database;
}

/**
 * Load fresh app and database modules that share the same module graph.
 *
 * @param {Object} envOverrides - Environment overrides for the module load.
 * @returns {Promise<{app: Object, Database: Object}>} Fresh app/database pair.
 */
async function loadAppWithDatabase(envOverrides = {}) {
  jest.resetModules();
  applyTestEnvironment(envOverrides);

  const app = require('../src/routes/app');
  const Database = require('../src/utils/database');

  await Database.initialize();
  return { app, Database };
}

describe('Database connection pooling', () => {
  let Database;

  afterEach(async () => {
    jest.restoreAllMocks();

    if (Database && typeof Database.close === 'function') {
      await Database.close();
    }

    Database = null;
    jest.resetModules();
    applyTestEnvironment();
  });

  test('uses default pool configuration when env variables are not set', async () => {
    Database = await loadDatabase();

    expect(Database.getPoolConfiguration()).toEqual({
      poolSize: 5,
      acquireTimeout: 10000,
    });
    expect(Database.getPoolMetrics()).toMatchObject({
      size: 5,
      acquireTimeout: 10000,
      idle: 1,
      active: 0,
      waiting: 0,
    });
  });

  test('respects custom DB_POOL_SIZE and DB_ACQUIRE_TIMEOUT values', async () => {
    Database = await loadDatabase({
      DB_POOL_SIZE: '2',
      DB_ACQUIRE_TIMEOUT: '250',
    });

    expect(Database.getPoolConfiguration()).toEqual({
      poolSize: 2,
      acquireTimeout: 250,
    });
    expect(Database.getPoolMetrics()).toMatchObject({
      size: 2,
      acquireTimeout: 250,
    });
  });

  test('rejects invalid DB_POOL_SIZE values clearly', async () => {
    jest.resetModules();
    applyTestEnvironment({ DB_POOL_SIZE: 'zero' });

    Database = require('../src/utils/database');

    await expect(Database.initialize()).rejects.toThrow('DB_POOL_SIZE must be a positive integer');
  });

  test('rejects invalid DB_ACQUIRE_TIMEOUT values clearly', async () => {
    jest.resetModules();
    applyTestEnvironment({ DB_ACQUIRE_TIMEOUT: '-1' });

    Database = require('../src/utils/database');

    await expect(Database.initialize()).rejects.toThrow('DB_ACQUIRE_TIMEOUT must be a positive integer');
  });

  test('reuses pooled connections instead of opening a new connection for every query', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '2' });

    const createConnectionSpy = jest.spyOn(Database, 'createConnectionRecord');

    await Database.get('SELECT 1 AS value');
    await Database.get('SELECT 2 AS value');
    await Database.get('SELECT 3 AS value');

    expect(createConnectionSpy).not.toHaveBeenCalled();
    expect(Database.getPoolMetrics()).toMatchObject({
      total: 1,
      active: 0,
      idle: 1,
    });
  });

  test('supports concurrent database operations without exceeding pool capacity', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '2' });

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        Database.run('INSERT INTO pool_test_records (value) VALUES (?)', [`value-${index}`])
      )
    );

    const count = await Database.get('SELECT COUNT(*) AS count FROM pool_test_records');

    expect(results).toHaveLength(6);
    expect(count.count).toBe(6);
    expect(Database.getPoolMetrics().total).toBeLessThanOrEqual(2);
  });

  test('queues acquisition requests in FIFO order when the pool is exhausted', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '1', DB_ACQUIRE_TIMEOUT: '1000' });

    const firstLease = await Database.acquireConnection();
    const acquisitionOrder = [];

    const secondLeasePromise = Database.acquireConnection().then((lease) => {
      acquisitionOrder.push('second');
      return lease;
    });
    const thirdLeasePromise = Database.acquireConnection().then((lease) => {
      acquisitionOrder.push('third');
      return lease;
    });

    await sleep(25);

    expect(Database.getPoolMetrics()).toMatchObject({
      active: 1,
      idle: 0,
      waiting: 2,
      size: 1,
    });

    await firstLease.release();

    const secondLease = await secondLeasePromise;
    expect(acquisitionOrder).toEqual(['second']);
    expect(secondLease.id).toBe(firstLease.id);
    expect(Database.getPoolMetrics().waiting).toBe(1);

    await secondLease.release();

    const thirdLease = await thirdLeasePromise;
    expect(acquisitionOrder).toEqual(['second', 'third']);
    expect(thirdLease.id).toBe(firstLease.id);

    await thirdLease.release();
  });

  test('times out queued acquisition requests and cleans up stale waiters', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '1', DB_ACQUIRE_TIMEOUT: '20' });

    const lease = await Database.acquireConnection();
    const waitingLease = Database.acquireConnection();

    await expect(waitingLease).rejects.toThrow('Timed out waiting for an available database connection');
    expect(Database.getPoolMetrics().waiting).toBe(0);

    await lease.release();

    const nextLease = await Database.acquireConnection();
    expect(nextLease.id).toBe(lease.id);
    await nextLease.release();
  });

  test('releases connections after query failures so later queries still succeed', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '1' });

    const release = jest.fn().mockResolvedValue();
    const acquireSpy = jest.spyOn(Database, 'acquireConnection').mockResolvedValue({
      db: {
        get: (sql, params, callback) => setImmediate(() => callback(new Error('simulated query failure'))),
      },
      release,
    });

    let error;
    try {
      await Database.get('SELECT 1 AS ok');
    } catch (caughtError) {
      error = caughtError;
    }

    expect(error).toBeDefined();
    expect(error.message).toBe('Database query failed');
    expect(release).toHaveBeenCalledWith({ retire: false });

    acquireSpy.mockRestore();

    expect(Database.getPoolMetrics()).toMatchObject({
      active: 0,
      idle: 1,
      waiting: 0,
    });

    const result = await Database.get('SELECT 1 AS ok');
    expect(result.ok).toBe(1);
  });

  test('pool size of 1 and a very small acquire timeout both work predictably', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '1', DB_ACQUIRE_TIMEOUT: '5' });

    const lease = await Database.getConnection();
    expect(Database.getPoolMetrics()).toMatchObject({
      size: 1,
      active: 1,
      idle: 0,
    });

    const pending = Database.acquireConnection();
    await expect(pending).rejects.toThrow('Timed out waiting for an available database connection');

    await lease.release();
  });

  test('close drains the pool and allows clean reinitialization', async () => {
    Database = await loadDatabase({ DB_POOL_SIZE: '2' });

    const firstLease = await Database.acquireConnection();
    const secondLease = await Database.acquireConnection();

    await firstLease.release();
    await secondLease.release();
    await Database.close();

    expect(Database.getPoolMetrics()).toMatchObject({
      total: 0,
      active: 0,
      idle: 0,
      waiting: 0,
      size: 5,
      acquireTimeout: 10000,
    });

    await Database.initialize();
    expect(Database.getPoolMetrics()).toMatchObject({
      total: 1,
      idle: 1,
      active: 0,
    });
  });

  test('health endpoint exposes database pool metrics', async () => {
    const loaded = await loadAppWithDatabase({ DB_POOL_SIZE: '1', DB_ACQUIRE_TIMEOUT: '1000' });
    const app = loaded.app;
    Database = loaded.Database;

    jest.spyOn(Database, 'get').mockResolvedValue({ ok: 1, count: 0 });

    const busyLease = await Database.acquireConnection();
    const queuedLease = Database.acquireConnection();

    await sleep(25);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.dependencies.database.pool).toMatchObject({
      active: 1,
      idle: 0,
      waiting: 1,
      size: 1,
      acquireTimeout: 1000,
    });

    await busyLease.release();
    const releasedLease = await queuedLease;
    await releasedLease.release();
  });
});
