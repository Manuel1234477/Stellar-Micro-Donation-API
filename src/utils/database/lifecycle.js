'use strict';

/**
 * Database lifecycle module (#1944). Event subscription and shutdown.
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
  dbEvents,
} = require('./shared');
const { DatabaseError } = require('../errors');
const log = require('../log');

class LifecycleMethods {
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
    state.queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS;
    state.nextConnectionId = 1;
    state.pendingCreations = 0;
    state.queueDrainInProgress = false;
    state.staleConnectionsReplaced = 0;
    state.closing = false;
    this.resetPerformanceMetrics();
  }
}

module.exports = LifecycleMethods;
