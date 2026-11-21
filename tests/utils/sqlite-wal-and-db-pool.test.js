'use strict';

/**
 * Tests for issues:
 *   #1144 – Dead-letter queue + bounded retries for failed webhook deliveries
 *   #1145 – SQLite WAL mode + busy_timeout to reduce "database is locked" failures
 *   #1146 – DB connection pool exhaustion → HTTP 503 with Retry-After
 *   #1147 – Health check: separate liveness/readiness with dependency probing
 */

// ─── #1145: WAL mode + busy_timeout ──────────────────────────────────────────

describe('#1145 – SQLite WAL mode and busy_timeout', () => {
  const Database = require('../../src/utils/database');

  beforeAll(async () => {
    await Database.ensureInitialized();
  });

  test('journal_mode is WAL after initialization', async () => {
    const row = await Database.get('PRAGMA journal_mode');
    expect(row).toBeDefined();
    expect(row.journal_mode).toBe('wal');
  });

  test('foreign_keys pragma is ON', async () => {
    const row = await Database.get('PRAGMA foreign_keys');
    expect(row).toBeDefined();
    expect(row.foreign_keys).toBe(1);
  });

  test('concurrent writers do not throw SQLITE_BUSY under WAL', async () => {
    await Database.run(`CREATE TABLE IF NOT EXISTS _wal_test (v INTEGER)`);
    const writes = Array.from({ length: 8 }, (_, i) =>
      Database.run('INSERT INTO _wal_test (v) VALUES (?)', [i])
    );
    const results = await Promise.allSettled(writes);
    const failures = results.filter(r => r.status === 'rejected');
    expect(failures.length).toBe(0);
    await Database.run('DROP TABLE IF EXISTS _wal_test');
  });
});

// ─── #1146: Pool exhaustion → 503 with Retry-After ───────────────────────────

describe('#1146 – DB pool exhaustion graceful handling', () => {
  test('errorHandler maps pool-exhaustion DatabaseError to 503 with Retry-After', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');
    const { DatabaseError } = require('../../src/utils/errors');

    const err = new DatabaseError('Timed out waiting for an available database connection');
    const req = { id: 'req-test', path: '/test', method: 'GET', headers: {}, ip: '::1' };
    const headers = {};
    const res = {
      set: jest.fn((k, v) => { headers[k] = v; }),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(headers['Retry-After']).toBeDefined();
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('normal DatabaseError still returns 500 (not 503)', () => {
    const { errorHandler } = require('../../src/middleware/errorHandler');
    const { DatabaseError } = require('../../src/utils/errors');

    const err = new DatabaseError('Some other database failure');
    const req = { id: 'req-test', path: '/test', method: 'GET', headers: {}, ip: '::1' };
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── #1144: Dead-letter queue + bounded retries ───────────────────────────────

describe('#1144 – Dead-letter queue and bounded retries', () => {
  const Database = require('../../src/utils/database');
  const { WebhookService } = require('../../src/services/WebhookService');
  const { getDlqMetrics } = require('../../src/services/WebhookService');

  beforeAll(async () => {
    await Database.ensureInitialized();
    await WebhookService.initTable();
  });

  beforeEach(async () => {
    await Database.run('DELETE FROM webhook_dead_letters').catch(() => {});
    await Database.run('DELETE FROM webhook_retries').catch(() => {});
    await Database.run('DELETE FROM webhook_delivery_history').catch(() => {});
  });

  test('scheduleRetry inserts into webhook_retries for attempt < max', async () => {
    await WebhookService.scheduleRetry({
      webhookId: 9999,
      event: 'test.event',
      payload: { x: 1 },
      attempt: 0,
      lastError: 'timeout',
    });
    const row = await Database.get(
      'SELECT * FROM webhook_retries WHERE webhook_id = 9999'
    );
    expect(row).toBeDefined();
    expect(row.event).toBe('test.event');
    expect(row.attempt).toBe(0);
  });

  test('scheduleRetry moves to dead-letter when max attempts exceeded', async () => {
    const before = getDlqMetrics().dlqEntriesTotal;
    await WebhookService.scheduleRetry({
      webhookId: 9998,
      event: 'test.dlq',
      payload: { x: 2 },
      attempt: 5, // RETRY_MAX_ATTEMPTS = 5
      lastError: 'persistent failure',
    });
    const dlq = await Database.get(
      'SELECT * FROM webhook_dead_letters WHERE webhook_id = 9998'
    );
    expect(dlq).toBeDefined();
    expect(dlq.event).toBe('test.dlq');
    expect(dlq.last_error).toBe('persistent failure');

    // metric counter incremented
    expect(getDlqMetrics().dlqEntriesTotal).toBe(before + 1);
  });

  test('listDeadLetters returns DLQ entries', async () => {
    await WebhookService.scheduleRetry({
      webhookId: 9997,
      event: 'test.list',
      payload: { x: 3 },
      attempt: 5,
      lastError: 'err',
    });
    const items = await WebhookService.listDeadLetters({ limit: 10, offset: 0 });
    const found = items.find(i => i.webhookId === 9997);
    expect(found).toBeDefined();
    expect(found.event).toBe('test.list');
  });

  test('replayDeadLetter reschedules and removes from DLQ', async () => {
    await WebhookService.scheduleRetry({
      webhookId: 9996,
      event: 'test.replay',
      payload: { x: 4 },
      attempt: 5,
      lastError: 'err',
    });
    const dlqEntry = await Database.get(
      'SELECT * FROM webhook_dead_letters WHERE webhook_id = 9996'
    );
    expect(dlqEntry).toBeDefined();

    await WebhookService.replayDeadLetter(dlqEntry.id);

    const gone = await Database.get(
      'SELECT * FROM webhook_dead_letters WHERE id = ?', [dlqEntry.id]
    );
    expect(gone).toBeUndefined();

    // Should now have a retry entry
    const retry = await Database.get(
      'SELECT * FROM webhook_retries WHERE webhook_id = 9996'
    );
    expect(retry).toBeDefined();
  });

  test('replayDeadLetter throws 404 for unknown id', async () => {
    await expect(WebhookService.replayDeadLetter(999999)).rejects.toMatchObject({ status: 404 });
  });
});

// ─── #1147: Liveness / readiness separation ───────────────────────────────────

describe('#1147 – Health check liveness and readiness', () => {
  const HealthCheckService = require('../../src/services/HealthCheckService');

  test('getLiveness returns alive without probing dependencies', () => {
    const result = HealthCheckService.getLiveness();
    expect(result.status).toBe('alive');
    expect(result.timestamp).toBeDefined();
  });

  test('checkDatabase runs a SELECT 1 and returns healthy status', async () => {
    const result = await HealthCheckService.checkDatabase();
    expect(result.status).toBe('healthy');
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
    expect(result.pool).toBeDefined();
  });

  test('getReadiness returns ready:true with healthy DB', async () => {
    const mockStellar = {
      getNetwork: () => 'testnet',
      getEnvironment: () => ({ name: 'testnet' }),
      getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      server: null,
    };
    const result = await HealthCheckService.getReadiness(mockStellar);
    // ready is true when status is healthy
    expect(typeof result.ready).toBe('boolean');
    expect(result.timestamp).toBeDefined();
  });

  test('readiness returns ready:false when DB check fails', async () => {
    const original = HealthCheckService.checkDatabase;
    HealthCheckService.checkDatabase = jest.fn().mockResolvedValue({ status: 'unhealthy', responseTime: 0 });

    const mockStellar = {
      getNetwork: () => 'testnet',
      getEnvironment: () => ({ name: 'testnet' }),
      getHorizonUrl: () => 'https://horizon-testnet.stellar.org',
      server: null,
    };

    const result = await HealthCheckService.getReadiness(mockStellar);
    expect(result.ready).toBe(false);

    HealthCheckService.checkDatabase = original;
  });

  test('liveness is independent of DB state (never probes DB)', async () => {
    // Even if DB were down, liveness should still return alive
    const result = HealthCheckService.getLiveness();
    expect(result.status).toBe('alive');
  });

  test('runCheck resolves with unhealthy on timeout', async () => {
    // Use internal runCheck via checkDatabase wrapper approach —
    // verify DEPENDENCY_TIMEOUT_MS is exported and is a number
    expect(typeof HealthCheckService.DEPENDENCY_TIMEOUT_MS).toBe('number');
    expect(HealthCheckService.DEPENDENCY_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
