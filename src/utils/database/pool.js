'use strict';

/**
 * Database pool module (#1944). Connection acquisition, wait queue and release.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const { DatabaseError } = require('../errors');
const log = require('../log');

class PoolMethods {
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

      waiter.timer = setTimeout(() => { // eslint-disable-line local/no-bare-timers
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
}

module.exports = PoolMethods;
