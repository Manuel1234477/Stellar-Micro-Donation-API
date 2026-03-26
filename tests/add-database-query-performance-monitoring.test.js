/**
 * Tests: Database Query Performance Monitoring
 *
 * Covers slow query detection, in-memory retention, admin slow-query endpoint,
 * and health check performance metrics.
 * Uses MockStellarService - no live Stellar network required.
 */

process.env.MOCK_STELLAR = 'true';

const express = require('express');
const request = require('supertest');
const Database = require('../src/utils/database');
const HealthCheckService = require('../src/services/HealthCheckService');
const log = require('../src/utils/log');
const dbAdminRoutes = require('../src/routes/admin/db');
const { errorHandler } = require('../src/middleware/errorHandler');

/**
 * Build a minimal app containing only the admin DB monitoring route.
 *
 * @returns {import('express').Express} Express app for route testing.
 */
function createDbAdminTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const apiKey = req.headers['x-api-key'];

    if (apiKey === 'admin-test-key') {
      req.user = { id: 'test-admin', role: 'admin' };
    } else if (apiKey === 'test-key') {
      req.user = { id: 'test-user', role: 'user' };
    }

    next();
  });
  app.use('/admin/db', dbAdminRoutes);
  app.use(errorHandler);
  return app;
}

describe('Database query performance monitoring', () => {
  const originalThreshold = process.env.SLOW_QUERY_THRESHOLD_MS;
  const adminApp = createDbAdminTestApp();

  beforeAll(async () => {
    await Database.initialize();
  });

  beforeEach(() => {
    process.env.SLOW_QUERY_THRESHOLD_MS = '0';
    Database.resetPerformanceMetrics();
    jest.restoreAllMocks();
    jest.spyOn(log, 'warn').mockImplementation(() => {});
    jest.spyOn(log, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalThreshold === undefined) {
      delete process.env.SLOW_QUERY_THRESHOLD_MS;
    } else {
      process.env.SLOW_QUERY_THRESHOLD_MS = originalThreshold;
    }

    Database.resetPerformanceMetrics();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    if (originalThreshold === undefined) {
      delete process.env.SLOW_QUERY_THRESHOLD_MS;
    } else {
      process.env.SLOW_QUERY_THRESHOLD_MS = originalThreshold;
    }

    await Database.close();
  });

  describe('Database metrics collection', () => {
    test('adds timing to all public query methods', async () => {
      await Database.query('SELECT 1 AS value');
      await Database.get('SELECT 2 AS value');
      await Database.all('SELECT 3 AS value');
      await Database.run('CREATE TABLE IF NOT EXISTS query_perf_test (id INTEGER PRIMARY KEY, name TEXT)');

      const metrics = Database.getPerformanceMetrics();

      expect(metrics.totalQueries).toBe(4);
      expect(metrics.recentQueryCount).toBe(4);
      expect(metrics.averageQueryTimeMs).toBeGreaterThan(0);
      expect(metrics.thresholdMs).toBe(0);
    });

    test('logs slow queries with SQL and duration when threshold is exceeded', async () => {
      const warnSpy = log.warn;

      await Database.get('SELECT 1 AS slow_query_probe');

      const slowQueries = Database.getSlowQueries();

      expect(slowQueries).toHaveLength(1);
      expect(slowQueries[0]).toMatchObject({
        sql: 'SELECT 1 AS slow_query_probe',
        method: 'get',
      });
      expect(slowQueries[0].durationMs).toBeGreaterThan(0);
      expect(typeof slowQueries[0].isoTimestamp).toBe('string');
      expect(warnSpy).toHaveBeenCalledWith(
        'DATABASE',
        'Slow query detected',
        expect.objectContaining({
          sql: 'SELECT 1 AS slow_query_probe',
          durationMs: expect.any(Number),
          thresholdMs: 0,
        })
      );
    });

    test('does not log queries that are exactly at the slow query threshold', () => {
      process.env.SLOW_QUERY_THRESHOLD_MS = '100';
      Database.resetPerformanceMetrics();

      Database.recordQueryExecution({
        method: 'get',
        sql: 'SELECT 1 AS threshold_probe',
        durationMs: 100,
      });

      expect(Database.getSlowQueries()).toEqual([]);
      expect(log.warn).not.toHaveBeenCalled();
    });

    test('stores failed slow queries with failure metadata', () => {
      Database.recordQueryExecution({
        method: 'run',
        sql: 'UPDATE missing_table SET value = 1',
        durationMs: 125,
        failed: true,
        timedOut: false,
      });

      const [entry] = Database.getSlowQueries();
      expect(entry.failed).toBe(true);
      expect(entry.timedOut).toBe(false);
      expect(entry.sql).toBe('UPDATE missing_table SET value = 1');
    });

    test('retains only the last 1000 slow query entries', () => {
      for (let index = 1; index <= 1005; index += 1) {
        Database.recordQueryExecution({
          method: 'get',
          sql: `SELECT ${index} AS retained_query`,
          durationMs: index,
        });
      }

      const slowQueries = Database.getSlowQueries();

      expect(slowQueries).toHaveLength(1000);
      expect(slowQueries.some(entry => entry.sql === 'SELECT 1 AS retained_query')).toBe(false);
      expect(slowQueries.some(entry => entry.sql === 'SELECT 1005 AS retained_query')).toBe(true);
    });

    test('returns only slow queries from the last 24 hours sorted by duration', () => {
      Database.recordQueryExecution({
        method: 'get',
        sql: 'SELECT 1 AS recent_fast',
        durationMs: 105,
      });
      Database.recordQueryExecution({
        method: 'get',
        sql: 'SELECT 2 AS recent_slowest',
        durationMs: 220,
      });
      Database.recordQueryExecution({
        method: 'get',
        sql: 'SELECT 3 AS recent_mid',
        durationMs: 180,
      });

      Database.performanceState.slowQueries.push({
        sql: 'SELECT 4 AS old_query',
        method: 'get',
        durationMs: 999,
        timestamp: Date.now() - (25 * 60 * 60 * 1000),
        isoTimestamp: new Date(Date.now() - (25 * 60 * 60 * 1000)).toISOString(),
        failed: false,
        timedOut: false,
      });

      const slowQueries = Database.getSlowQueries();

      expect(slowQueries.map(entry => entry.sql)).toEqual([
        'SELECT 2 AS recent_slowest',
        'SELECT 3 AS recent_mid',
        'SELECT 1 AS recent_fast',
      ]);
    });

    test('returns a bounded result set when a limit is provided', () => {
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 1', durationMs: 101 });
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 2', durationMs: 150 });
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 3', durationMs: 200 });

      const slowQueries = Database.getSlowQueries({ limit: 2 });

      expect(slowQueries).toHaveLength(2);
      expect(slowQueries[0].sql).toBe('SELECT 3');
      expect(slowQueries[1].sql).toBe('SELECT 2');
    });

    test('returns defensive copies of slow query entries', () => {
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 1 AS immutable', durationMs: 101 });

      const [entry] = Database.getSlowQueries();
      entry.sql = 'SELECT tampered';

      expect(Database.getSlowQueries()[0].sql).toBe('SELECT 1 AS immutable');
    });

    test('validates SLOW_QUERY_THRESHOLD_MS configuration', () => {
      process.env.SLOW_QUERY_THRESHOLD_MS = '-1';

      expect(() => Database.resetPerformanceMetrics()).toThrow('SLOW_QUERY_THRESHOLD_MS must be a non-negative integer');
    });
  });

  describe('GET /admin/db/slow-queries', () => {
    test('returns the slowest queries for admin users', async () => {
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 1 AS slow_a', durationMs: 140 });
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 2 AS slow_b', durationMs: 240 });
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 3 AS slow_c', durationMs: 180 });

      const response = await request(adminApp)
        .get('/admin/db/slow-queries')
        .set('x-api-key', 'admin-test-key');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.thresholdMs).toBe(0);
      expect(response.body.data.slowQueryCount).toBe(3);
      expect(response.body.data.queries.map(entry => entry.sql)).toEqual([
        'SELECT 2 AS slow_b',
        'SELECT 3 AS slow_c',
        'SELECT 1 AS slow_a',
      ]);
    });

    test('supports the optional limit query parameter', async () => {
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 1 AS limited_a', durationMs: 120 });
      Database.recordQueryExecution({ method: 'get', sql: 'SELECT 2 AS limited_b', durationMs: 220 });

      const response = await request(adminApp)
        .get('/admin/db/slow-queries?limit=1')
        .set('x-api-key', 'admin-test-key');

      expect(response.status).toBe(200);
      expect(response.body.data.queries).toHaveLength(1);
      expect(response.body.data.queries[0].sql).toBe('SELECT 2 AS limited_b');
    });

    test('rejects requests without authentication', async () => {
      const response = await request(adminApp).get('/admin/db/slow-queries');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('rejects authenticated non-admin requests', async () => {
      const response = await request(adminApp)
        .get('/admin/db/slow-queries')
        .set('x-api-key', 'test-key');

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
    });

    test('returns validation error for an invalid limit query', async () => {
      const response = await request(adminApp)
        .get('/admin/db/slow-queries?limit=0')
        .set('x-api-key', 'admin-test-key');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('limit must be a positive integer');
    });

    test('rejects malformed limit values that parseInt would previously coerce', async () => {
      const response = await request(adminApp)
        .get('/admin/db/slow-queries?limit=1abc')
        .set('x-api-key', 'admin-test-key');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    test('rejects decimal limit values', async () => {
      const response = await request(adminApp)
        .get('/admin/db/slow-queries?limit=1.5')
        .set('x-api-key', 'admin-test-key');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Health check integration', () => {
    test('includes query performance metrics in the database health check', async () => {
      await Database.get('SELECT 10 AS health_metric_probe');

      const result = await HealthCheckService.checkDatabase();

      expect(result.performance).toEqual(
        expect.objectContaining({
          thresholdMs: 0,
          totalQueries: expect.any(Number),
          averageQueryTimeMs: expect.any(Number),
          slowQueryCount: expect.any(Number),
          recentQueryCount: expect.any(Number),
        })
      );
      expect(result.performance.averageQueryTimeMs).toBeGreaterThan(0);
    });

    test('reports zero average query time when no recent queries have been recorded', () => {
      const metrics = Database.getPerformanceMetrics();

      expect(metrics.averageQueryTimeMs).toBe(0);
      expect(metrics.recentQueryCount).toBe(0);
    });
  });
});
