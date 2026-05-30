/**
 * Tests: Database Connection Pool Health Monitoring
 *
 * Verifies stale connection detection, replacement, counter tracking,
 * and that getPoolMetrics exposes staleConnectionsReplaced.
 */

const Database = require('../../src/utils/database');

// Helper: build a fake connection record with a controllable db stub
function makeFakeConnection(id, { failPing = false } = {}) {
  return {
    id,
    inUse: false,
    db: {
      get: jest.fn((_sql, _params, cb) => {
        if (failPing) {
          cb(new Error('SQLITE_IOERR: disk I/O error'));
        } else {
          cb(null, { ping: 1 });
        }
      }),
      close: jest.fn((cb) => cb(null)),
    },
  };
}

beforeEach(async () => {
  // Reset pool state between tests
  await Database.close();
  Database.poolState = {
    initialized: true,
    initializing: null,
    closing: false,
    poolSize: 5,
    poolMin: 1,
    poolMax: 10,
    acquireTimeout: 5000,
    connections: [],
    waitQueue: [],
    nextConnectionId: 10,
    pendingCreations: 0,
    queueDrainInProgress: false,
    staleConnectionsReplaced: 0,
  };
});

afterAll(async () => {
  await Database.close();
});

describe('_checkIdleConnections', () => {
  it('leaves healthy idle connections in the pool', async () => {
    const conn = makeFakeConnection(1);
    Database.poolState.connections = [conn];

    await Database._checkIdleConnections();

    expect(Database.poolState.connections).toHaveLength(1);
    expect(Database.poolState.staleConnectionsReplaced).toBe(0);
  });

  it('removes a stale idle connection and increments staleConnectionsReplaced', async () => {
    const stale = makeFakeConnection(2, { failPing: true });
    Database.poolState.connections = [stale];

    // Mock createConnectionRecord to avoid real SQLite and push to connections
    const fresh = makeFakeConnection(99);
    jest.spyOn(Database, 'createConnectionRecord').mockImplementation(async () => {
      Database.poolState.connections.push(fresh);
      return fresh;
    });

    await Database._checkIdleConnections();

    expect(Database.poolState.staleConnectionsReplaced).toBe(1);
    expect(Database.poolState.connections.find(c => c.id === 2)).toBeUndefined();
    expect(Database.poolState.connections.find(c => c.id === 99)).toBeDefined();
  });

  it('does not check connections that are in use', async () => {
    const active = makeFakeConnection(3, { failPing: true });
    active.inUse = true;
    Database.poolState.connections = [active];

    await Database._checkIdleConnections();

    // Active connection is never pinged
    expect(active.db.get).not.toHaveBeenCalled();
    expect(Database.poolState.staleConnectionsReplaced).toBe(0);
    expect(Database.poolState.connections).toHaveLength(1);
  });

  it('replaces multiple stale connections and counts each one', async () => {
    const stale1 = makeFakeConnection(4, { failPing: true });
    const stale2 = makeFakeConnection(5, { failPing: true });
    const healthy = makeFakeConnection(6);
    Database.poolState.connections = [stale1, stale2, healthy];

    let freshId = 100;
    jest.spyOn(Database, 'createConnectionRecord').mockImplementation(async () =>
      makeFakeConnection(freshId++)
    );

    await Database._checkIdleConnections();

    expect(Database.poolState.staleConnectionsReplaced).toBe(2);
    expect(Database.poolState.connections.find(c => c.id === 4)).toBeUndefined();
    expect(Database.poolState.connections.find(c => c.id === 5)).toBeUndefined();
    expect(Database.poolState.connections.find(c => c.id === 6)).toBeDefined();
  });

  it('does not replace when pool is at capacity', async () => {
    const stale = makeFakeConnection(7, { failPing: true });
    Database.poolState.connections = [stale];
    Database.poolState.poolSize = 0; // no capacity

    await Database._checkIdleConnections();

    expect(Database.poolState.staleConnectionsReplaced).toBe(1);
    // No replacement created
    expect(Database.poolState.connections).toHaveLength(0);
  });
});

describe('getPoolMetrics', () => {
  it('includes staleConnectionsReplaced in metrics', () => {
    Database.poolState.staleConnectionsReplaced = 3;
    const metrics = Database.getPoolMetrics();
    expect(metrics).toHaveProperty('staleConnectionsReplaced', 3);
  });

  it('defaults staleConnectionsReplaced to 0', () => {
    Database.poolState.staleConnectionsReplaced = 0;
    const metrics = Database.getPoolMetrics();
    expect(metrics.staleConnectionsReplaced).toBe(0);
  });
});

describe('_runHealthCheck', () => {
  afterEach(() => jest.restoreAllMocks());

  it('calls _checkIdleConnections when pool is initialized and not closing', async () => {
    const spy = jest.spyOn(Database, '_checkIdleConnections').mockResolvedValue();
    Database.poolState.initialized = true;
    Database.poolState.closing = false;
    await Database._runHealthCheck();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('skips when pool is closing', async () => {
    Database.poolState.initialized = true;
    Database.poolState.closing = true;
    const spy = jest.spyOn(Database, '_checkIdleConnections').mockResolvedValue();
    await Database._runHealthCheck();
    expect(spy).not.toHaveBeenCalled();
  });

  it('skips when pool is not initialized', async () => {
    Database.poolState.initialized = false;
    Database.poolState.closing = false;
    const spy = jest.spyOn(Database, '_checkIdleConnections').mockResolvedValue();
    await Database._runHealthCheck();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('staleConnectionsReplaced counter reset on close', () => {
  it('resets to 0 after close()', async () => {
    Database.poolState.staleConnectionsReplaced = 7;
    await Database.close();
    // After close, poolState is reset — re-read it
    expect(Database.poolState.staleConnectionsReplaced).toBe(0);
  });
});
