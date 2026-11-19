/**
 * SQLite single-writer coordination (Issue #1959)
 *
 * SQLite allows exactly one writer at a time, even in WAL mode. When several
 * pooled connections issue writes concurrently they contend for the database
 * lock and eventually fail with SQLITE_BUSY. This module provides the pieces
 * that serialise writes through one dedicated connection:
 *
 *   - WriterQueue:      FIFO mutex around the writer connection, with queue-depth
 *                       and wait-time statistics.
 *   - isWriteStatement: classifies SQL so reads stay on the read pool.
 *   - txStorage:        AsyncLocalStorage holding the connection of the transaction
 *                       currently running, so statements issued from inside a
 *                       transaction callback join it instead of waiting on the
 *                       lock that the transaction already holds (no deadlock).
 *
 * The connection itself is owned by src/utils/database.js.
 */

'use strict';

const { AsyncLocalStorage } = require('async_hooks');

const txStorage = new AsyncLocalStorage();

// Statements that never modify the database. Everything else is treated as a
// write and goes through the writer connection.
const READ_ONLY_STATEMENT = /^\s*(SELECT|EXPLAIN)\b/i;
const WRITE_KEYWORD = /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i;

/**
 * @param {string} sql
 * @returns {boolean} true when the statement may modify the database.
 */
function isWriteStatement(sql) {
  const text = String(sql || '').trim();
  if (/^WITH\b/i.test(text)) return WRITE_KEYWORD.test(text);
  if (/^PRAGMA\b/i.test(text)) return text.includes('=');
  if (READ_ONLY_STATEMENT.test(text)) return false;
  // DML, DDL and transaction control (BEGIN/COMMIT/ROLLBACK/SAVEPOINT) are writes.
  return true;
}

/**
 * FIFO mutex around the single writer connection.
 */
class WriterQueue {
  constructor() {
    this._tail = Promise.resolve();
    this._waiting = 0;
    this._acquisitions = 0;
    this._totalWaitMs = 0;
    this._maxWaitMs = 0;
    this._maxDepth = 0;
    this._onWait = null;
  }

  /**
   * Wait for the writer slot. Resolves to a lease whose release() must be called
   * exactly once (extra calls are ignored).
   *
   * @returns {Promise<{release: function(): void}>}
   */
  acquire() {
    const enqueuedAt = process.hrtime.bigint();
    this._waiting += 1;
    this._maxDepth = Math.max(this._maxDepth, this._waiting);

    let releaseGate;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const previous = this._tail;
    this._tail = previous.then(() => gate);

    return previous.then(() => {
      this._waiting -= 1;
      const waitMs = Number(process.hrtime.bigint() - enqueuedAt) / 1e6;
      this._acquisitions += 1;
      this._totalWaitMs += waitMs;
      this._maxWaitMs = Math.max(this._maxWaitMs, waitMs);
      if (this._onWait) {
        try { this._onWait(waitMs / 1000); } catch (_) { /* metrics must never break writes */ }
      }

      let released = false;
      return {
        release: () => {
          if (released) return;
          released = true;
          releaseGate();
        },
      };
    });
  }

  /**
   * @returns {{queueDepth: number, maxQueueDepth: number, acquisitions: number,
   *            avgWaitMs: number, maxWaitMs: number}}
   */
  getStats() {
    return {
      queueDepth: this._waiting,
      maxQueueDepth: this._maxDepth,
      acquisitions: this._acquisitions,
      avgWaitMs: this._acquisitions ? this._totalWaitMs / this._acquisitions : 0,
      maxWaitMs: this._maxWaitMs,
    };
  }

  /** Test helper: forget accumulated statistics (does not affect waiters). */
  resetStats() {
    this._acquisitions = 0;
    this._totalWaitMs = 0;
    this._maxWaitMs = 0;
    this._maxDepth = this._waiting;
  }
}

const writerQueue = new WriterQueue();

/**
 * @param {function(number): void} observer - Called with each wait in seconds.
 */
function setWaitObserver(observer) {
  writerQueue._onWait = observer;
}

/**
 * @returns {{db: object}|undefined} The transaction context of the current async flow.
 */
function currentTransaction() {
  return txStorage.getStore();
}

/**
 * Run fn with `ctx` as the current transaction context.
 * @template T
 * @param {{db: object}} ctx
 * @param {function(): Promise<T>} fn
 * @returns {Promise<T>}
 */
function runInTransaction(ctx, fn) {
  return txStorage.run(ctx, fn);
}

module.exports = {
  isWriteStatement,
  writerQueue,
  setWaitObserver,
  currentTransaction,
  runInTransaction,
  getWriterStats: () => writerQueue.getStats(),
  WriterQueue,
};
