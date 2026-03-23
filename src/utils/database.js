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
require('dotenv').config({ path: path.join(__dirname, '../../src/.env') });

// External modules
const sqlite3 = require('sqlite3').verbose();

// Internal modules
const { DatabaseError, DuplicateError } = require('./errors');
const { withTimeout, TIMEOUT_DEFAULTS, TimeoutError } = require('./timeoutHandler');
const log = require('./log');

const DEFAULT_POOL_SIZE = 5;
const DEFAULT_ACQUIRE_TIMEOUT = TIMEOUT_DEFAULTS.DATABASE;
const DB_PATH = path.join(__dirname, '../../data/stellar_donations.db');

class Database {
  static poolState = {
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
   * Read and validate pool configuration from environment variables.
   *
   * @returns {{poolSize: number, acquireTimeout: number}} Validated pool config.
   */
  static getPoolConfiguration() {
    return {
      poolSize: this.parsePositiveIntegerEnv(
        'DB_POOL_SIZE',
        process.env.DB_POOL_SIZE,
        DEFAULT_POOL_SIZE
      ),
      acquireTimeout: this.parsePositiveIntegerEnv(
        'DB_ACQUIRE_TIMEOUT',
        process.env.DB_ACQUIRE_TIMEOUT,
        DEFAULT_ACQUIRE_TIMEOUT
      ),
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
      state.poolSize = config.poolSize;
      state.acquireTimeout = config.acquireTimeout;
      state.closing = false;

      const connection = await this.createConnectionRecord();
      connection.inUse = false;
      state.initialized = true;
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

    let resolveStatement;
    let rejectStatement;

    const statementPromise = new Promise((resolve, reject) => {
      resolveStatement = resolve;
      rejectStatement = reject;
    });

    statementPromise.catch(() => {});

    const callback = function(err, result) {
      const statementContext = this;

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
   * Close all pooled connections and reject queued waiters.
   *
   * @returns {Promise<void>} Resolves when shutdown bookkeeping completes.
   */
  static async close() {
    const state = this.poolState;
    state.closing = true;

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
    state.acquireTimeout = DEFAULT_ACQUIRE_TIMEOUT;
    state.nextConnectionId = 1;
    state.pendingCreations = 0;
    state.queueDrainInProgress = false;
    state.closing = false;
  }
}

module.exports = Database;
