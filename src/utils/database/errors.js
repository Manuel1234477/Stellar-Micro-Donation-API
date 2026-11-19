'use strict';

/**
 * Database errors module (#1944). Database error classification and mapping (original error kept as cause).
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const { DatabaseError, DuplicateError } = require('../errors');
const { TimeoutError } = require('../timeoutHandler');

class ErrorsMethods {
  static isUniqueConstraintError(err) {
    return Boolean(err && err.code === 'SQLITE_CONSTRAINT' && err.message.includes('UNIQUE'));
  }

  /**
   * Classify a raw SQLite error so callers (and the chaos suite) can decide
   * whether an operation is retryable.
   *
   * @param {Error} err - Raw or normalized error.
   * @returns {'duplicate'|'timeout'|'connection'|'busy'|'constraint'|'unknown'} Error category.
   */
  static classifyDatabaseError(err) {
    if (!err) return 'unknown';

    if (err.code === 'QUERY_TIMEOUT' || err instanceof TimeoutError) {
      return 'timeout';
    }

    if (this.isUniqueConstraintError(err)) {
      return 'duplicate';
    }

    const code = typeof err.code === 'string' ? err.code : '';
    const message = typeof err.message === 'string' ? err.message : '';

    if (
      code === 'SQLITE_BUSY' ||
      code === 'SQLITE_LOCKED' ||
      /database is locked|database table is locked/i.test(message)
    ) {
      return 'busy';
    }

    if (
      code === 'SQLITE_CANTOPEN' ||
      code === 'SQLITE_IOERR' ||
      code === 'SQLITE_NOTADB' ||
      code === 'SQLITE_CORRUPT' ||
      /SQLITE_(CANTOPEN|IOERR|NOTADB|CORRUPT)/i.test(message) ||
      /database connection is not open|database handle is closed|connection (?:is )?(?:closed|dropped)/i.test(message)
    ) {
      return 'connection';
    }

    if (code === 'SQLITE_CONSTRAINT') {
      return 'constraint';
    }

    return 'unknown';
  }

  /**
   * Determine whether an error is safe to retry.
   *
   * @param {Error} err - Raw or normalized error.
   * @returns {boolean} True when the operation may be retried.
   */
  static isRetryableError(err) {
    const category = this.classifyDatabaseError(err);
    return category === 'timeout' || category === 'busy' || category === 'connection';
  }

  /**
   * Convert raw SQLite errors into application errors.
   *
   * Always returns a DatabaseError (or DuplicateError) so callers never have to
   * deal with raw sqlite3 error shapes. The original error is preserved as
   * `cause` and the classification is exposed via `code`/`category`.
   *
   * @param {Error} err - SQLite error.
   * @param {string} failureMessage - Safe top-level error message.
   * @returns {Error} Normalized application error.
   */
  static mapDatabaseError(err, failureMessage) {
    if (err instanceof DatabaseError || err instanceof DuplicateError) {
      return err;
    }

    if (this.isUniqueConstraintError(err)) {
      return new DuplicateError('Duplicate donation detected - this transaction has already been processed');
    }

    const category = this.classifyDatabaseError(err);
    const baseMessage = category === 'timeout'
      ? (err && err.message) || failureMessage
      : failureMessage;
    const diagnostic = process.env.NODE_ENV === 'test' && err && err.message
      ? ` (${err.code || 'SQLITE_ERROR'}: ${err.message})`
      : '';
    const message = `${baseMessage}${diagnostic}`;

    const mapped = new DatabaseError(message, err);
    mapped.category = category;
    mapped.retryable = this.isRetryableError(err);
    if (err && err.code && !mapped.code) {
      mapped.sqliteCode = err.code;
    }
    return mapped;
  }
}

module.exports = ErrorsMethods;
