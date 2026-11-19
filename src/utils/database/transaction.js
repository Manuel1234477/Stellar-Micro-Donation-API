'use strict';

/**
 * Database transaction module (#1944). Transaction helpers.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const { DatabaseError } = require('../errors');
const log = require('../log');

class TransactionMethods {
  /**
   * Execute multiple operations within a single SQLite transaction on one connection.
   * All operations either commit or rollback together.
   *
   * @param {function(tx: {run, get, all}): Promise<*>} callback - Async function receiving bound DB methods.
   * @returns {Promise<*>} The value returned by the callback.
   */
  static async runTransaction(callback) {
    await this.ensureInitialized();
    const lease = await this.acquireConnection();
    const db = lease.db;
    // `this` inside the sqlite callbacks is the Statement; keep the class reference (#1944).
    const database = this;

    const runOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) return reject(database.mapDatabaseError(err, 'Transaction operation failed'));
        resolve({ id: this.lastID, changes: this.changes });
      });
    });

    const getOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(this.mapDatabaseError(err, 'Transaction query failed'));
        resolve(row);
      });
    });

    const allOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(this.mapDatabaseError(err, 'Transaction query failed'));
        resolve(rows);
      });
    });

    const tx = { run: runOnConn, get: getOnConn, all: allOnConn };

    try {
      await runOnConn('BEGIN IMMEDIATE');
      const result = await callback(tx);
      await runOnConn('COMMIT');
      return result;
    } catch (err) {
      try { await runOnConn('ROLLBACK'); } catch (_) {}
      // Never surface raw sqlite errors from a transaction.
      throw this.mapDatabaseError(err, 'Transaction failed');
    } finally {
      await lease.release().catch(() => {});
    }
  }

  /**
   * Execute a callback inside a single SQLite transaction on one pooled connection.
   *
   * This is the preferred helper for multi-step writes that must be atomic:
   * every statement issued through the provided transaction handle runs on the
   * same connection, and the whole unit is either committed or rolled back.
   * If the callback throws (or the COMMIT fails), a ROLLBACK is issued so that
   * failed operations leave no partial writes behind.
   *
   * The callback receives a transaction handle with `run`, `get` and `all`
   * methods bound to the transaction's connection. Nested calls are not
   * supported and will throw.
   *
   * @param {function(tx: {run: Function, get: Function, all: Function}): Promise<*>} callback
   *   Async function receiving the bound transaction handle.
   * @returns {Promise<*>} The value returned by the callback.
   */
  static async withTransaction(callback) {
    if (typeof callback !== 'function') {
      throw new DatabaseError('withTransaction requires a callback function');
    }

    await this.ensureInitialized();

    const state = this.poolState;
    if (state.closing) {
      throw new DatabaseError('Database pool is shutting down');
    }

    const lease = await this.acquireConnection();
    const db = lease.db;
    // `this` inside the sqlite callbacks is the Statement; keep the class reference (#1944).
    const database = this;

    const runOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) return reject(database.mapDatabaseError(err, 'Transaction operation failed'));
        resolve({ id: this.lastID, changes: this.changes });
      });
    });

    const getOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) return reject(this.mapDatabaseError(err, 'Transaction query failed'));
        resolve(row);
      });
    });

    const allOnConn = (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) return reject(this.mapDatabaseError(err, 'Transaction query failed'));
        resolve(rows);
      });
    });

    const tx = { run: runOnConn, get: getOnConn, all: allOnConn };

    let began = false;
    let settled = false;

    try {
      await runOnConn('BEGIN IMMEDIATE');
      began = true;

      const result = await callback(tx);

      await runOnConn('COMMIT');
      settled = true;
      return result;
    } catch (err) {
      if (began && !settled) {
        try {
          await runOnConn('ROLLBACK');
        } catch (rollbackErr) {
          log.warn('DATABASE', 'Failed to roll back transaction', {
            error: rollbackErr.message,
          });
        }
      }
      throw err;
    } finally {
      await lease.release().catch((releaseError) => {
        log.warn('DATABASE', 'Failed to release pooled connection after transaction', {
          error: releaseError.message,
        });
      });
    }
  }

  /**
   * Alias of withTransaction(), kept for callers that use the older name.
   *
   * @param {Function} callback
   * @returns {Promise<*>}
   */
  static transaction(callback) {
    return this.withTransaction(callback);
  }
}

module.exports = TransactionMethods;
