'use strict';

/**
 * src/utils/database split (#1944)
 *
 * - The Database facade keeps every static member the original class exposed.
 * - No module in src/utils/database/ exceeds the file size budget.
 * - The facade loads the modules and does not load environment files (#1943).
 */

const fs = require('fs');
const path = require('path');
const Database = require('../../src/utils/database');

const DB_DIR = path.join(__dirname, '../../src/utils/database');
const FACADE = path.join(__dirname, '../../src/utils/database.js');
const MAX_LINES = 400;

// Static members of the original single-file Database class (#1944 acceptance criteria).
const ORIGINAL_STATIC_MEMBERS = [
  '_checkIdleConnections', '_reconnectWithBackoff', '_runHealthCheck', '_startHealthCheck', '_stopHealthCheck',
  'acquireConnection', 'all', 'canCreateConnection', 'classifyDatabaseError', 'close', 'closeConnectionRecord',
  'createConnectionRecord', 'createLease', 'drainWaitQueue', 'each', 'enqueueWaiter', 'ensureInitialized',
  'execute', 'findIdleConnection', 'get', 'getConnection', 'getDiagnosticPragmas', 'getPerformanceConfiguration',
  'getPerformanceMetrics', 'getPoolConfiguration', 'getPoolMetrics', 'getPoolStatus', 'getQueryStats',
  'getSlowQueries', 'handConnectionToNextWaiter', 'initialize', 'isRetryableError', 'isUniqueConstraintError',
  'mapDatabaseError', 'off', 'on', 'parseNonNegativeIntegerEnv', 'parsePositiveIntegerEnv', 'performanceState',
  'poolState', 'prunePerformanceState', 'query', 'recordQueryExecution', 'releaseConnection',
  'resetPerformanceMetrics', 'run', 'runTransaction', 'withTransaction',
];

describe('database module layout (#1944)', () => {
  it.each(ORIGINAL_STATIC_MEMBERS)('facade exposes Database.%s', (name) => {
    expect(name in Database).toBe(true);
  });

  it('keeps the poolState and performanceState accessors working through the facade', () => {
    expect(Database.poolState).toBeDefined();
    expect(Database.performanceState).toBeDefined();
  });

  it('every module in src/utils/database/ is within the file size budget', () => {
    const files = fs.readdirSync(DB_DIR).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const lines = fs.readFileSync(path.join(DB_DIR, file), 'utf8').split('\n').length;
      expect(lines).toBeLessThanOrEqual(MAX_LINES);
    }
  });

  it('the facade is a thin re-export and loads no environment file (#1943)', () => {
    const source = fs.readFileSync(FACADE, 'utf8');
    expect(source.split('\n').length).toBeLessThan(100);
    expect(source).not.toMatch(/require\(['"]dotenv['"]\)/);
  });
});
