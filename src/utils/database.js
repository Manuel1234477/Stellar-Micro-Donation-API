/**
 * Database Utility - Data Access Layer
 *
 * RESPONSIBILITY: SQLite database connection management and query execution
 * OWNER: Backend Team
 * DEPENDENCIES: sqlite3, error utilities
 *
 * Provides centralized database access with reusable SQLite connections,
 * bounded queueing, timeout handling, and query helpers for all database
 * operations across the application.
 */

const path = require('path');
const EventEmitter = require('events');
require('dotenv').config({ path: path.join(__dirname, '../../src/.env') });

// External modules
const sqlite3 = require('sqlite3').verbose();

// Internal modules
const { DatabaseError, DuplicateError } = require('./errors');
const { withTimeout, TIMEOUT_DEFAULTS, TimeoutError } = require('./timeoutHandler');
const log = require('./log');

const DEFAULT_POOL_SIZE = 5;
const DEFAULT_POOL_MIN = 1;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_ACQUIRE_TIMEOUT = TIMEOUT_DEFAULTS.DATABASE;
const HEALTH_CHECK_INTERVAL_MS = 30_000;
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;
const RECONNECT_MAX_ATTEMPTS = 10;

/** EventEmitter for database lifecycle events (e.g. 'database.degraded') */
const dbEvents = new EventEmitter();
const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 100;
const DEFAULT_SLOW_QUERY_BUFFER_SIZE = 100;
const MAX_SLOW_QUERY_ENTRIES = 1000;
const SLOW_QUERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

class Database {
  static get poolState() {
    if (!this._poolState) {
      this._poolState = {
        initialized: false,
        initializing: null,
        closing: false,
        poolSize: DEFAULT_POOL_SIZE,
        acquireTimeout: DEFAULT_ACQUIRE_TIMEOUT,
        connections: [],
        waitQueue: [],
        nextConnectionId: 1,
        pendingCreations: 0,
        queueDrainInProgress: false,
      };
    }

    return this._poolState;
  }

  static set poolState(value) {
    this._poolState = value;
  }

  static performanceState = {
    totalQueries: 0,
    totalDurationMs: 0,
    slowQueryThresholdMs: DEFAULT_SLOW_QUERY_THRESHOLD_MS,
    slowQueryBufferSize: DEFAULT_SLOW_QUERY_BUFFER_SIZE,
    slowQueries: [],
    recentDurations: [],
  };

  /**
   * Parse a positive integer environment variable with a safe default.
   *
   * @param {string} variableName - Environment variable name.
   * @param {string|undefined} rawValue - Raw environment value.
   * @param {number} defaultValue - Default value to use when unset.
   * @returns {number} Parsed positive integer.
   */
  static parsePositiveIntegerEnv(variableName, rawValue, defaultValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return defaultValue;
    }

    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new DatabaseError(
        `${variableName} must be a positive integer`,
        new Error(`Invalid value provided for ${variableName}`)
      );
    }

    return parsed;
  }

  /**
   * Parse a non-negative integer environment variable with a safe default.
   *
   * @param {string} variableName - Environment variable name.
   * @param {string|undefined} rawValue - Raw environment value.
   * @param {number} defaultValue - Default value to use when unset.
   * @returns {number} Parsed non-negative integer.
   */
  static parseNonNegativeIntegerEnv(variableName, rawValue, defaultValue) {
    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return defaultValue;
    }

    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new DatabaseError(
        `${variableName} must be a non-negative integer`,
        new Error(`Invalid value provided for ${variableName}`)
      );
    }

    return parsed;
  }

  /**
   * Read and validate pool configuration from environment variables.
   * Supports DB_POOL_MIN and DB_POOL_MAX (issue #631) as well as legacy DB_POOL_SIZE.
   *
   * @returns {{poolSize: number, poolMin: number, poolMax: number, acquireTimeout: number}} Validated pool config.
   */
  static getPoolConfiguration() {
    const poolMin = this.parsePositiveIntegerEnv(
      'DB_POOL_MIN',
      process.env.DB_POOL_MIN,
      DEFAULT_POOL_MIN
    );
    const poolMax = this.parsePositiveIntegerEnv(
      'DB_POOL_MAX',
      process.env.DB_POOL_MAX,
      DEFAULT_POOL_MAX
    );
    const poolSize = this.parsePositiveIntegerEnv(
      'DB_POOL_SIZE',
      process.env.DB_POOL_SIZE,
      Math.min(poolMax, DEFAULT_POOL_SIZE)
    );
    return {
      poolSize: Math.min(poolSize, poolMax),
      poolMin,
      poolMax,
      acquireTimeout: this.parsePositiveIntegerEnv(
        'DB_ACQUIRE_TIMEOUT',
        process.env.DB_ACQUIRE_TIMEOUT,
        DEFAULT_ACQUIRE_TIMEOUT
      ),
    };
  }

  /**
   * Read and validate query monitoring configuration from environment variables.
   *
   * @returns {{slowQueryThresholdMs: number, slowQueryBufferSize: number}} Validated monitoring config.
   */
  static getPerformanceConfiguration() {
    return {
      slowQueryThresholdMs: this.parseNonNegativeIntegerEnv(
        'SLOW_QUERY_THRESHOLD_MS',
        process.env.SLOW_QUERY_THRESHOLD_MS,
        DEFAULT_SLOW_QUERY_THRESHOLD_MS
      ),
      slowQueryBufferSize: this.parsePositiveIntegerEnv(
        'SLOW_QUERY_BUFFER_SIZE',
        process.env.SLOW_QUERY_BUFFER_SIZE,
        DEFAULT_SLOW_QUERY_BUFFER_SIZE
      ),
    };
  }

  /**
   * Remove durations and slow query entries that fall outside the reporting window.
   *
   * @returns {void}
   */
  static prunePerformanceState() {
    const cutoff = Date.now() - SLOW_QUERY_WINDOW_MS;
    const state = this.performanceState;

    state.recentDurations = state.recentDurations.filter(entry => entry.timestamp >= cutoff);
    state.slowQueries = state.slowQueries.filter(entry => entry.timestamp >= cutoff);
  }

  /**
   * Persist metrics for a completed query execution and log slow queries.
   *
   * @param {Object} entry - Query execution details.
   * @param {string} entry.method - Database method used.
   * @param {string} entry.sql - SQL statement executed.
   * @param {Array} [entry.params=[]] - Query parameters.
   * @param {number} entry.durationMs - Query duration in milliseconds.
   * @param {boolean} [entry.failed=false] - Whether the query ended in failure.
   * @param {boolean} [entry.timedOut=false] - Whether the query timed out.
   * @returns {void}
   */
  static recordQueryExecution({ method, sql, params = [], durationMs, failed = false, timedOut = false }) {
    const state = this.performanceState;
    const timestamp = Date.now();
    const normalizedDurationMs = Number.isFinite(durationMs) && durationMs >= 0
      ? Number(durationMs.toFixed(3))
      : 0;

    state.totalQueries += 1;
    state.totalDurationMs += normalizedDurationMs;
    state.recentDurations.push({ durationMs: normalizedDurationMs, timestamp });

    const thresholdMs = state.slowQueryThresholdMs;
    if (normalizedDurationMs > thresholdMs) {
      const slowQueryEntry = {
        sql,
        params,
        method,
        durationMs: normalizedDurationMs,
        timestamp,
        isoTimestamp: new Date(timestamp).toISOString(),
        failed,
        timedOut,
      };

      const bufferSize = Math.min(state.slowQueryBufferSize, MAX_SLOW_QUERY_ENTRIES);
      state.slowQueries.push(slowQueryEntry);
      if (state.slowQueries.length > bufferSize) {
        state.slowQueries.splice(0, state.slowQueries.length - bufferSize);
      }

      log.warn('DATABASE', 'Slow query detected', {
        method,
        durationMs: normalizedDurationMs,
        thresholdMs,
        sql,
        params,
        failed,
        timedOut,
      });
    }

    this.prunePerformanceState();
  }

  /**
   * Return a read-only snapshot of slow query entries from the past 24 hours.
   *
   * @param {{limit?: number}} [options={}] - Result shaping options.
   * @returns {Array<Object>} Slow queries sorted by duration descending.
   */
  static getSlowQueries(options = {}) {
    this.prunePerformanceState();

    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : this.performanceState.slowQueries.length;

    return [...this.performanceState.slowQueries]
      .sort((left, right) => right.durationMs - left.durationMs || right.timestamp - left.timestamp)
      .slice(0, limit)
      .map(entry => ({ ...entry }));
  }

  /**
   * Return aggregate query performance metrics for health checks and diagnostics.
   *
   * @returns {{thresholdMs: number, totalQueries: number, averageQueryTimeMs: number, slowQueryCount: number, recentQueryCount: number}}
   */
  static getPerformanceMetrics() {
    this.prunePerformanceState();

    const recentQueryCount = this.performanceState.recentDurations.length;
    const recentDurationTotal = this.performanceState.recentDurations.reduce(
      (sum, entry) => sum + entry.durationMs,
      0
    );

    return {
      thresholdMs: this.performanceState.slowQueryThresholdMs,
      totalQueries: this.performanceState.totalQueries,
      averageQueryTimeMs: recentQueryCount === 0
        ? 0
        : Number((recentDurationTotal / recentQueryCount).toFixed(3)),
      slowQueryCount: this.performanceState.slowQueries.length,
      recentQueryCount,
    };
  }

  /**
   * Compute aggregate query statistics including p95 and p99 latency percentiles.
   *
   * @returns {{totalQueries: number, averageDurationMs: number, p95Ms: number, p99Ms: number, slowQueryCount: number, thresholdMs: number}}
   */
  static getQueryStats() {
    this.prunePerformanceState();

    const state = this.performanceState;
    const durations = state.recentDurations.map(entry => entry.durationMs).sort((a, b) => a - b);
    const count = durations.length;

    const percentile = (p) => {
      if (count === 0) return 0;
      const idx = Math.ceil((p / 100) * count) - 1;
      return durations[Math.max(0, idx)];
    };

    const avg = count === 0 ? 0 : Number((durations.reduce((s, d) => s + d, 0) / count).toFixed(3));

    return {
      totalQueries: state.totalQueries,
      averageDurationMs: avg,
      p95Ms: percentile(95),
      p99Ms: percentile(99),
      slowQueryCount: state.slowQueries.length,
      thresholdMs: state.slowQueryThresholdMs,
    };
  }

  /**
   * Reset query performance state for test isolation and shutdown cleanup.
   *
   * @returns {void}
   */
  static resetPerformanceMetrics() {
    const config = this.getPerformanceConfiguration();
    this.performanceState = {
      totalQueries: 0,
      totalDurationMs: 0,
      slowQueryThresholdMs: config.slowQueryThresholdMs,
      slowQueryBufferSize: config.slowQueryBufferSize,
      slowQueries: [],
      recentDurations: [],
    };
  }

  /**
   * Check whether a SQLite error is caused by a UNIQUE constraint.
   *
   * @param {Error} err - SQLite error.
   * @returns {boolean} True when the error maps to a duplicate violation.
   */
  static isUniqueConstraintError(err) {
    return Boolean(err && err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE'));
  }

  /**
   * Convert raw SQLite errors into application errors.
   *
   * @param {Error} err - SQLite error.
   * @param {string} failureMessage - Safe top-level error message.
   * @returns {Error} Normalized application error.
   */
  static mapDatabaseError(err, failureMessage) {
    if (this.isUniqueConstraintError(err)) {
      return new DuplicateError('Duplicate donation detected - this transaction has already been processed');
    }

    return new DatabaseError(failureMessage, err);
  }

  /**
   * Determine whether the pool can create one more connection.
   *
   * @returns {boolean} True when capacity remains.
   */
  static canCreateConnection() {
    const state = this.poolState;
    return (state.connections.length + state.pendingCreations) < state.poolSize;
  }

  /**
   * Find the next idle connection in the pool.
   *
   * @returns {Object|null} Idle connection record or null.
   */
  static findIdleConnection() {
    return this.poolState.connections.find(connection => !connection.inUse) || null;
  }

  /**
   * Build a connection lease that guarantees idempotent release.
   *
   * @param {Object} connection - Internal connection record.
   * @returns {{id: number, db: Object, release: Function}} Lease wrapper.
   */
  static createLease(connection) {
    let released = false;

    return {
      id: connection.id,
      db: connection.db,
      release: async (options = {}) => {
        if (released) {
          return;
        }

        released = true;
        await this.releaseConnection(connection, options);
      },
    };
  }

  /**
   * Open a new SQLite connection and apply connection-level settings.
   *
   * @returns {Promise<Object>} Newly created connection record.
   */
  static async createConnectionRecord() {
    const state = this.poolState;
    state.pendingCreations += 1;

    try {
      const db = await withTimeout(
        new Promise((resolve, reject) => {
          const connection = new sqlite3.Database(DB_PATH, (err) => {
            if (err) {
              reject(new DatabaseError('Failed to connect to database', err));
            } else {
              resolve(connection);
            }
          });
        }),
        TIMEOUT_DEFAULTS.DATABASE,
        'database_connection'
      );

      if (typeof db.configure === 'function') {
        db.configure('busyTimeout', TIMEOUT_DEFAULTS.DATABASE);
      }

      const connectionRecord = {
        id: state.nextConnectionId++,
        db,
        inUse: false,
      };

      state.connections.push(connectionRecord);

      return connectionRecord;
    } finally {
      state.pendingCreations -= 1;
    }
  }

  /**
   * Close a single SQLite connection record.
   *
   * @param {Object} connection - Connection record to close.
   * @returns {Promise<void>} Resolves when close completes.
   */
  static async closeConnectionRecord(connection) {
    await new Promise((resolve, reject) => {
      connection.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Ensure the pool is initialized exactly once.
   *
   * @returns {Promise<void>} Resolves when initialization completes.
   */
  static async initialize() {
    const state = this.poolState;

    if (state.initialized) {
      return;
    }

    if (state.initializing) {
      await state.initializing;
      return;
    }

    state.initializing = (async () => {
      const config = this.getPoolConfiguration();
      const performanceConfig = this.getPerformanceConfiguration();
      state.poolSize = config.poolSize;
      state.poolMin = config.poolMin;
      state.poolMax = config.poolMax;
      state.acquireTimeout = config.acquireTimeout;
      state.closing = false;
      this.performanceState.slowQueryThresholdMs = performanceConfig.slowQueryThresholdMs;
      this.performanceState.slowQueryBufferSize = performanceConfig.slowQueryBufferSize;

      const connection = await this.createConnectionRecord();
      connection.inUse = false;
      state.initialized = true;

      this._startHealthCheck();
    })();

    try {
      await state.initializing;
    } finally {
      state.initializing = null;
    }
  }

  /**
   * Ensure the pool is ready before serving work.
   *
   * @returns {Promise<void>} Resolves when the pool is ready.
   */
  static async ensureInitialized() {
    if (!this.poolState.initialized) {
      await this.initialize();
    }
  }

  /**
   * Queue a waiter for the next available connection lease.
   *
   * @returns {Promise<{id: number, db: Object, release: Function}>} Connection lease.
   */
  static async enqueueWaiter() {
    const state = this.poolState;

    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: null,
      };

      waiter.timer = setTimeout(() => {
        const index = state.waitQueue.indexOf(waiter);
        if (index !== -1) {
          state.waitQueue.splice(index, 1);
        }

        reject(new DatabaseError('Timed out waiting for an available database connection'));
      }, state.acquireTimeout);

      state.waitQueue.push(waiter);
    });
  }

  /**
   * Hand an available connection to the next queued waiter in FIFO order.
   *
   * @param {Object} connection - Idle connection record to hand off.
   * @returns {boolean} True when a waiter was resumed.
   */
  static handConnectionToNextWaiter(connection) {
    const waiter = this.poolState.waitQueue.shift();

    if (!waiter) {
      return false;
    }

    clearTimeout(waiter.timer);
    connection.inUse = true;
    waiter.resolve(this.createLease(connection));
    return true;
  }

  /**
   * Create replacement capacity for queued waiters after a connection retires.
   *
   * @returns {Promise<void>} Resolves when the queue has been serviced as far as possible.
   */
  static async drainWaitQueue() {
    const state = this.poolState;

    if (state.queueDrainInProgress || state.closing) {
      return;
    }

    state.queueDrainInProgress = true;

    try {
      while (state.waitQueue.length > 0) {
        const idleConnection = this.findIdleConnection();
        if (idleConnection) {
          if (!this.handConnectionToNextWaiter(idleConnection)) {
            break;
          }
          continue;
        }

        if (!this.canCreateConnection()) {
          break;
        }

        const connection = await this.createConnectionRecord();
        connection.inUse = true;

        const waiter = state.waitQueue.shift();
        if (!waiter) {
          connection.inUse = false;
          break;
        }

        clearTimeout(waiter.timer);
        waiter.resolve(this.createLease(connection));
      }
    } finally {
      state.queueDrainInProgress = false;
    }
  }

  /**
   * Acquire a pooled SQLite connection lease.
   *
   * @returns {Promise<{id: number, db: Object, release: Function}>} Connection lease.
   */
  static async acquireConnection() {
    await this.ensureInitialized();

    const state = this.poolState;

    if (state.closing) {
      throw new DatabaseError('Database pool is shutting down');
    }

    if (state.waitQueue.length === 0) {
      const idleConnection = this.findIdleConnection();
      if (idleConnection) {
        idleConnection.inUse = true;
        return this.createLease(idleConnection);
      }

      if (this.canCreateConnection()) {
        const connection = await this.createConnectionRecord();
        connection.inUse = true;
        return this.createLease(connection);
      }
    }

    return this.enqueueWaiter();
  }

  /**
   * Backwards-compatible alias for acquiring a pooled connection.
   *
   * @returns {Promise<{id: number, db: Object, release: Function}>} Connection lease.
   */
  static async getConnection() {
    return this.acquireConnection();
  }

  /**
   * Return a leased connection to the pool or retire it safely.
   *
   * @param {Object} connection - Internal connection record.
   * @param {{retire?: boolean}} [options={}] - Release options.
   * @returns {Promise<void>} Resolves when release bookkeeping finishes.
   */
  static async releaseConnection(connection, options = {}) {
    if (!connection) {
      return;
    }

    const shouldRetire = Boolean(options.retire);
    const state = this.poolState;

    if (shouldRetire) {
      const index = state.connections.findIndex(item => item.id === connection.id);
      if (index !== -1) {
        state.connections.splice(index, 1);
      }

      try {
        await this.closeConnectionRecord(connection);
      } catch (error) {
        log.warn('DATABASE', 'Failed to close retired pooled connection', {
          error: error.message,
        });
      }

      if (!state.closing) {
        await this.drainWaitQueue();
      }

      return;
    }

    connection.inUse = false;

    if (!this.handConnectionToNextWaiter(connection)) {
      return;
    }
  }

  /**
   * Execute a SQLite statement on a pooled connection.
   *
   * @param {'all'|'get'|'run'} method - SQLite method to invoke.
   * @param {string} sql - SQL statement.
   * @param {Array} params - Statement parameters.
   * @param {string} failureMessage - Safe error message.
   * @returns {Promise<*>} Query result payload.
   */
  static async execute(method, sql, params, failureMessage) {
    const lease = await this.acquireConnection();
    let timedOut = false;
    let completed = false;
    const startTimeNs = process.hrtime.bigint();

    let resolveStatement;
    let rejectStatement;

    const statementPromise = new Promise((resolve, reject) => {
      resolveStatement = resolve;
      rejectStatement = reject;
    });

    statementPromise.catch(() => {});

    const callback = function(err, result) {
      const statementContext = this;
      const durationMs = Number(process.hrtime.bigint() - startTimeNs) / 1e6;

      completed = true;
      Database.recordQueryExecution({
        method,
        sql,
        params,
        durationMs,
        failed: Boolean(err),
        timedOut,
      });

      if (err) {
        rejectStatement(Database.mapDatabaseError(err, failureMessage));
      } else if (method === 'run') {
        resolveStatement({ id: statementContext.lastID, changes: statementContext.changes });
      } else {
        resolveStatement(result);
      }

      lease.release({ retire: timedOut }).catch((releaseError) => {
        log.warn('DATABASE', 'Failed to release pooled connection', {
          error: releaseError.message,
        });
      });
    };

    try {
      lease.db[method](sql, params, callback);
    } catch (error) {
      rejectStatement(Database.mapDatabaseError(error, failureMessage));
      lease.release({ retire: true }).catch((releaseError) => {
        log.warn('DATABASE', 'Failed to retire pooled connection after synchronous error', {
          error: releaseError.message,
        });
      });
    }

    try {
      return await withTimeout(
        statementPromise,
        TIMEOUT_DEFAULTS.DATABASE,
        `database_${method}`
      );
    } catch (error) {
      if (error instanceof TimeoutError) {
        timedOut = true;
        if (!completed) {
          const durationMs = Number(process.hrtime.bigint() - startTimeNs) / 1e6;
          Database.recordQueryExecution({
            method,
            sql,
            params,
            durationMs,
            failed: true,
            timedOut: true,
          });
          completed = true;
        }
      }

      throw error;
    }
  }

  /**
   * Execute a query that returns zero or more rows.
   *
   * @param {string} sql - SQL statement.
   * @param {Array} [params=[]] - Statement parameters.
   * @returns {Promise<Array>} Query rows.
   */
  static async query(sql, params = []) {
    return this.execute('all', sql, params, 'Database query failed');
  }

  /**
   * Execute a statement that mutates the database.
   *
   * @param {string} sql - SQL statement.
   * @param {Array} [params=[]] - Statement parameters.
   * @returns {Promise<{id: number, changes: number}>} Statement metadata.
   */
  static async run(sql, params = []) {
    return this.execute('run', sql, params, 'Database operation failed');
  }

  /**
   * Execute a query that returns a single row.
   *
   * @param {string} sql - SQL statement.
   * @param {Array} [params=[]] - Statement parameters.
   * @returns {Promise<Object|undefined>} Single row or undefined.
   */
  static async get(sql, params = []) {
    return this.execute('get', sql, params, 'Database query failed');
  }

  /**
   * Alias for query() to preserve the existing public API.
   *
   * @param {string} sql - SQL statement.
   * @param {Array} [params=[]] - Statement parameters.
   * @returns {Promise<Array>} Query rows.
   */
  static async all(sql, params = []) {
    return this.query(sql, params);
  }

  /**
   * Expose pool metrics for health checks and diagnostics.
   *
   * @returns {{total: number, active: number, idle: number, waiting: number, size: number, acquireTimeout: number}}
   * Pool metrics snapshot.
   */
  static getPoolMetrics() {
    const state = this.poolState;
    const active = state.connections.filter(connection => connection.inUse).length;
    const total = state.connections.length;

    return {
      total,
      active,
      idle: total - active,
      waiting: state.waitQueue.length,
      size: state.poolSize,
      acquireTimeout: state.acquireTimeout,
    };
  }

  /**
   * Return pool status including min/max config and health info (issue #631).
   *
   * @returns {{poolSize: number, poolMin: number, poolMax: number, active: number, idle: number, waiting: number, healthy: boolean}}
   */
  static getPoolStatus() {
    const state = this.poolState;
    const active = state.connections.filter(c => c.inUse).length;
    const total = state.connections.length;
    return {
      poolSize: state.poolSize,
      poolMin: state.poolMin || DEFAULT_POOL_MIN,
      poolMax: state.poolMax || DEFAULT_POOL_MAX,
      active,
      idle: total - active,
      waiting: state.waitQueue.length,
      healthy: state.initialized && !state.closing,
    };
  }

  /**
   * Start the periodic health-check ping (every 30 s).
   * @private
   */
  static _startHealthCheck() {
    if (this._healthCheckTimer) return;
    this._healthCheckTimer = setInterval(() => {
      this._runHealthCheck().catch(() => {});
    }, HEALTH_CHECK_INTERVAL_MS);
    if (this._healthCheckTimer.unref) this._healthCheckTimer.unref();
  }

  /** @private */
  static _stopHealthCheck() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  /**
   * Ping the database with a lightweight query. On failure, attempt reconnect.
   * Emits 'database.degraded' when the pool wait queue is exhausted.
   * @private
   */
  static async _runHealthCheck() {
    if (!this.poolState.initialized || this.poolState.closing) return;
    try {
      await this.get('SELECT 1 AS ping');
    } catch (err) {
      log.warn('DATABASE', 'Health check failed — attempting reconnect', { error: err.message });
      await this._reconnectWithBackoff();
    }

    // Emit degraded event when pool is exhausted
    const state = this.poolState;
    if (state.waitQueue.length > 0 && state.connections.filter(c => !c.inUse).length === 0) {
      dbEvents.emit('database.degraded', {
        waiting: state.waitQueue.length,
        active: state.connections.filter(c => c.inUse).length,
        total: state.connections.length,
      });
      log.warn('DATABASE', 'Pool exhausted — database.degraded event emitted', {
        waiting: state.waitQueue.length,
      });
    }
  }

  /**
   * Attempt to create a fresh connection with exponential backoff.
   * @private
   */
  static async _reconnectWithBackoff() {
    let delay = RECONNECT_BASE_DELAY_MS;
    for (let attempt = 1; attempt <= RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (this.poolState.closing) return;
      try {
        const conn = await this.createConnectionRecord();
        conn.inUse = false;
        log.info('DATABASE', 'Reconnected successfully', { attempt });
        return;
      } catch (err) {
        log.warn('DATABASE', 'Reconnect attempt failed', { attempt, error: err.message });
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    }
    log.error('DATABASE', 'All reconnect attempts exhausted');
    dbEvents.emit('database.degraded', { reason: 'reconnect_exhausted' });
  }

  /**
   * Subscribe to database lifecycle events.
   * Supported events: 'database.degraded'
   *
   * @param {string} event
   * @param {Function} listener
   */
  static on(event, listener) {
    dbEvents.on(event, listener);
  }

  /**
   * Remove a database lifecycle event listener.
   *
   * @param {string} event
   * @param {Function} listener
   */
  static off(event, listener) {
    dbEvents.off(event, listener);
  }

  /**
   * Close all pooled connections and reject queued waiters.
   *
   * @returns {Promise<void>} Resolves when shutdown bookkeeping completes.
   */
  static async close() {
    const state = this.poolState;
    state.closing = true;

    this._stopHealthCheck();

    while (state.waitQueue.length > 0) {
      const waiter = state.waitQueue.shift();
      clearTimeout(waiter.timer);
      waiter.reject(new DatabaseError('Database pool is shutting down'));
    }

    const connections = [...state.connections];
    state.connections = [];

    await Promise.all(connections.map(async (connection) => {
      try {
        await this.closeConnectionRecord(connection);
      } catch (error) {
        log.warn('DATABASE', 'Failed to close pooled connection during shutdown', {
          error: error.message,
        });
      }
    }));

    state.initialized = false;
    state.initializing = null;
    state.poolSize = DEFAULT_POOL_SIZE;
    state.poolMin = DEFAULT_POOL_MIN;
    state.poolMax = DEFAULT_POOL_MAX;
    state.acquireTimeout = DEFAULT_ACQUIRE_TIMEOUT;
    state.nextConnectionId = 1;
    state.pendingCreations = 0;
    state.queueDrainInProgress = false;
    state.closing = false;
    this.resetPerformanceMetrics();
  }
}

Database.resetPerformanceMetrics();

module.exports = Database;
