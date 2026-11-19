'use strict';

/**
 * Database shared constants and helpers (#1944).
 *
 * Module-level configuration and small helpers used by the database modules in
 * this directory. Imported by name; nothing here has side effects beyond
 * resolving DB_PATH from the environment.
 */

const path = require('path');
const EventEmitter = require('events');
const { TIMEOUT_DEFAULTS } = require('../timeoutHandler');

// ─── OpenTelemetry helpers ────────────────────────────────────────────────────

/**
 * Extract the SQL verb from a SQL statement for span naming and db.operation attribute.
 * Parameter values are never included — only the statement template.
 *
 * @param {string} sql - SQL statement (may contain ? placeholders)
 * @returns {string} Uppercase operation keyword (SELECT, INSERT, UPDATE, DELETE, etc.)
 */
function _parseSqlOperation(sql) {
  if (!sql) return 'UNKNOWN';
  const match = sql.trimStart().match(/^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|BEGIN|COMMIT|ROLLBACK)/i);
  return match ? match[1].toUpperCase() : 'UNKNOWN';
}

/**
 * Lazily load the tracing module to avoid circular-dependency issues at startup.
 * Returns a minimal no-op shim when the module cannot be loaded.
 *
 * @returns {{ withSpan: Function }}
 */
function _getTracing() {
  try {
    return require('../tracing');
  } catch (_err) {
    // Tracing unavailable — return no-op shim so DB still functions
    return {
      withSpan: async (_name, _attrs, fn) => fn({ setAttribute: () => {}, setStatus: () => {}, recordException: () => {} }),
    };
  }
}

const DEFAULT_POOL_SIZE = 5;
const DEFAULT_POOL_MIN = 1;
const DEFAULT_POOL_MAX = 10;
const DEFAULT_ACQUIRE_TIMEOUT = TIMEOUT_DEFAULTS.DATABASE;
const DEFAULT_QUERY_TIMEOUT_MS = 5000;
const SLOW_QUERY_WARN_MS = 1000;
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

// Resolve database path from environment or use default
const getDBPath = () => {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  return path.join(__dirname, '../../../data/stellar_donations.db');
};

const DB_PATH = getDBPath();

module.exports = {
  DEFAULT_POOL_SIZE,
  DEFAULT_POOL_MIN,
  DEFAULT_POOL_MAX,
  DEFAULT_ACQUIRE_TIMEOUT,
  DEFAULT_QUERY_TIMEOUT_MS,
  SLOW_QUERY_WARN_MS,
  HEALTH_CHECK_INTERVAL_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  dbEvents,
  DEFAULT_SLOW_QUERY_THRESHOLD_MS,
  DEFAULT_SLOW_QUERY_BUFFER_SIZE,
  MAX_SLOW_QUERY_ENTRIES,
  SLOW_QUERY_WINDOW_MS,
  DB_PATH,
  _parseSqlOperation,
  _getTracing,
};
