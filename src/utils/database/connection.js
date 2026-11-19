'use strict';

/**
 * Database connection module (#1944). Connection pool: pool state accessors, pool configuration and connection lifecycle.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const {
  DEFAULT_POOL_SIZE,
  DEFAULT_POOL_MIN,
  DEFAULT_POOL_MAX,
  DEFAULT_ACQUIRE_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT_MS,
  DEFAULT_SLOW_QUERY_THRESHOLD_MS,
  DEFAULT_SLOW_QUERY_BUFFER_SIZE,
  DB_PATH,
} = require('./shared');
const sqlite3 = require('sqlite3').verbose();
const { DatabaseError } = require('../errors');
const { withTimeout, TIMEOUT_DEFAULTS } = require('../timeoutHandler');

class ConnectionMethods {
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
        staleConnectionsReplaced: 0,
      };
    }

    return this._poolState;
  }

  static set poolState(value) {
    this._poolState = value;
  }

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
      queryTimeoutMs: this.parsePositiveIntegerEnv(
        'DB_QUERY_TIMEOUT_MS',
        process.env.DB_QUERY_TIMEOUT_MS,
        DEFAULT_QUERY_TIMEOUT_MS
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

      // #1145: enable WAL mode for improved concurrency (readers don't block writers)
      await new Promise((resolve, reject) => {
        db.run('PRAGMA journal_mode=WAL', (err) => {
          if (err) reject(new DatabaseError('Failed to enable WAL journal mode', err));
          else resolve();
        });
      });

      // #1155: enforce FK constraints on every connection (SQLite resets per connection)
      await new Promise((resolve, reject) => {
        db.run('PRAGMA foreign_keys=ON', (err) => {
          if (err) reject(new DatabaseError('Failed to enable foreign key enforcement', err));
          else resolve();
        });
      });

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
   * Query database pragmas to report active journal mode and sync settings.
   * Used for startup diagnostics (#1483).
   *
   * @returns {Promise<{journalMode: string, synchronous: string, autoVacuum: string}>} Pragma values.
   */
  static async getDiagnosticPragmas() {
    try {
      const journalRow = await this.get('PRAGMA journal_mode');
      const syncRow = await this.get('PRAGMA synchronous');
      const vacuumRow = await this.get('PRAGMA auto_vacuum');

      return {
        journalMode: journalRow?.journal_mode || 'UNKNOWN',
        synchronous: syncRow?.synchronous || 'UNKNOWN',
        autoVacuum: vacuumRow?.auto_vacuum || 'UNKNOWN',
      };
    } catch (err) {
      return {
        journalMode: 'ERROR',
        synchronous: 'ERROR',
        autoVacuum: 'ERROR',
      };
    }
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

    state.closing = false; // Ensure we reset closing state if re-initializing
    state.initializing = (async () => {
      const config = this.getPoolConfiguration();
      const performanceConfig = this.getPerformanceConfiguration();
      state.poolSize = config.poolSize;
      state.poolMin = config.poolMin;
      state.poolMax = config.poolMax;
      state.acquireTimeout = config.acquireTimeout;
      state.queryTimeoutMs = config.queryTimeoutMs;
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
}

module.exports = ConnectionMethods;
