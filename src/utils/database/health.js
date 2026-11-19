'use strict';

/**
 * Database health module (#1944). Idle-connection checks, health checks and reconnection with backoff.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const {
  HEALTH_CHECK_INTERVAL_MS,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  RECONNECT_MAX_ATTEMPTS,
  dbEvents,
} = require('./shared');
const { withTimeout, TIMEOUT_DEFAULTS } = require('../timeoutHandler');
const log = require('../log');

class HealthMethods {
  /**
   * Start the periodic health-check ping (every 30 s).
   * @private
   */
  static _startHealthCheck() {
    if (this._healthCheckTimer) return;
    if (process.env.NODE_ENV === 'test') return;
    const timerRegistry = require('../timerRegistry');
    this._healthCheckTimer = timerRegistry.createInterval(() => {
      this._runHealthCheck().catch(() => {});
    }, HEALTH_CHECK_INTERVAL_MS, 'db-health-check');
    this._healthCheckTimer.unref();
  }

  /** @private */
  static _stopHealthCheck() {
    if (this._healthCheckTimer) {
      this._healthCheckTimer.clear();
      this._healthCheckTimer = null;
    }
  }

  /**
   * Run a SELECT 1 health check on each idle connection.
   * Stale connections are removed from the pool and replaced with a fresh one.
   * @private
   */
  static async _checkIdleConnections() {
    const state = this.poolState;
    // Snapshot idle connections — avoid mutating while iterating
    const idleConnections = state.connections.filter(c => !c.inUse);

    for (const connection of idleConnections) {
      if (state.closing) break;

      try {
        await withTimeout(
          new Promise((resolve, reject) => {
            connection.db.get('SELECT 1 AS ping', [], (err) => {
              if (err) reject(err); else resolve();
            });
          }),
          TIMEOUT_DEFAULTS.DATABASE,
          'health_check_ping'
        );
      } catch (err) {
        // Connection is stale — remove it
        const index = state.connections.findIndex(c => c.id === connection.id);
        if (index !== -1) {
          state.connections.splice(index, 1);
        }
        try {
          await this.closeConnectionRecord(connection);
        } catch (_) {
          // best-effort close
        }

        state.staleConnectionsReplaced = (state.staleConnectionsReplaced || 0) + 1;
        log.warn('DATABASE', 'Stale connection detected and removed from pool', {
          connectionId: connection.id,
          error: err.message,
          staleConnectionsReplaced: state.staleConnectionsReplaced,
        });

        // Replace with a fresh connection if pool capacity allows
        if (!state.closing && this.canCreateConnection()) {
          try {
            const fresh = await this.createConnectionRecord();
            fresh.inUse = false;
            log.info('DATABASE', 'Replaced stale connection with fresh connection', {
              newConnectionId: fresh.id,
            });
          } catch (createErr) {
            log.warn('DATABASE', 'Failed to create replacement connection', {
              error: createErr.message,
            });
          }
        }
      }
    }
  }

  /**
   * Ping idle connections individually, then check for pool exhaustion.
   * Emits 'database.degraded' when the pool wait queue is exhausted.
   * @private
   */
  static async _runHealthCheck() {
    if (!this.poolState.initialized || this.poolState.closing) return;

    await this._checkIdleConnections();

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
        await new Promise(resolve => setTimeout(resolve, delay)); // eslint-disable-line local/no-bare-timers
        delay = Math.min(delay * 2, RECONNECT_MAX_DELAY_MS);
      }
    }
    log.error('DATABASE', 'All reconnect attempts exhausted');
    dbEvents.emit('database.degraded', { reason: 'reconnect_exhausted' });
  }

  /**
   * True when a trivial query succeeds on the pool.
   *
   * @returns {Promise<boolean>}
   */
  static async isHealthy() {
    try {
      await this.get('SELECT 1 AS ok');
      return true;
    } catch (_err) {
      return false;
    }
  }
}

module.exports = HealthMethods;
