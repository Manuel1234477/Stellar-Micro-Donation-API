'use strict';

/**
 * Database query module (#1944). Statement execution: run, get, all, each and the statement timeout.
 *
 * Methods are copied onto the Database facade (src/utils/database.js), so
 * `this` is the Database class at call time.
 */

const {
  DEFAULT_QUERY_TIMEOUT_MS,
  _parseSqlOperation,
  _getTracing,
} = require('./shared');
const { DatabaseError } = require('../errors');
const { withTimeout, TimeoutError } = require('../timeoutHandler');
const log = require('../log');

class QueryMethods {
  /**
   * Execute a SQLite statement on a pooled connection.
   *
   * Creates a child OpenTelemetry span for the actual query execution.
   * Connection acquisition time is excluded from the span duration.
   * SQL parameter values are NEVER included in span attributes.
   *
   * @param {'all'|'get'|'run'} method - SQLite method to invoke.
   * @param {string} sql - SQL statement.
   * @param {Array} params - Statement parameters.
   * @param {string} failureMessage - Safe error message.
   * @returns {Promise<*>} Query result payload.
   */
  static async execute(method, sql, params, failureMessage) {
    // Acquire the connection BEFORE starting the span so that connection
    // acquisition time is tracked separately, not included in query duration.
    const lease = await this.acquireConnection();

    const operation = _parseSqlOperation(sql);
    const { withSpan } = _getTracing();

    // SpanKind.CLIENT = 2 (inline to avoid a hard dep on @opentelemetry/api here)
    return withSpan(
      `db.${operation.toLowerCase()}`,
      {
        'db.system': 'sqlite',
        'db.operation': operation,
        // Include the SQL template (with ? placeholders) but NEVER the parameter values
        'db.statement': sql,
      },
      async (span) => {
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

        // `this` inside the sqlite callback is the Statement; keep the class reference (#1944).
        const database = this;
        const callback = function(err, result) {
          const statementContext = this;
          const durationMs = Number(process.hrtime.bigint() - startTimeNs) / 1e6;

          completed = true;
          database.recordQueryExecution({
            method,
            sql,
            params,
            durationMs,
            failed: Boolean(err),
            timedOut,
          });

          if (err) {
            rejectStatement(database.mapDatabaseError(err, failureMessage));
          } else if (method === 'run') {
            const runResult = { id: statementContext.lastID, changes: statementContext.changes };
            // Record rows affected for write operations
            span.setAttribute('db.rows_affected', statementContext.changes || 0);
            resolveStatement(runResult);
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
          completed = true;
          const mappedError = this.mapDatabaseError(error, failureMessage);
          rejectStatement(mappedError);
          // Retire the connection only when the failure indicates a broken handle.
          const retire = this.classifyDatabaseError(error) === 'connection';
          lease.release({ retire }).catch((releaseError) => {
            log.warn('DATABASE', 'Failed to release pooled connection after synchronous error', {
              error: releaseError.message,
            });
          });
        }

        try {
          return await withTimeout(
            statementPromise,
            this.poolState.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS,
            `database_${method}`
          );
        } catch (error) {
          if (error instanceof TimeoutError) {
            timedOut = true;
            const durationMs = Number(process.hrtime.bigint() - startTimeNs) / 1e6;
            if (!completed) {
              this.recordQueryExecution({
                method,
                sql,
                params,
                durationMs,
                failed: true,
                timedOut: true,
              });
              completed = true;
            }
            const timeoutError = new DatabaseError(
              `QUERY_TIMEOUT: query exceeded ${this.poolState.queryTimeoutMs || DEFAULT_QUERY_TIMEOUT_MS}ms (actual: ${durationMs.toFixed(1)}ms) — ${sql.slice(0, 200)}`
            );
            timeoutError.code = 'QUERY_TIMEOUT';
            timeoutError.category = 'timeout';
            timeoutError.retryable = true;
            timeoutError.sql = sql.slice(0, 200);
            timeoutError.durationMs = durationMs;
            throw timeoutError;
          }

          // Normalize anything else (e.g. connection drops surfaced by sqlite3)
          // so callers always receive a DatabaseError.
          throw this.mapDatabaseError(error, failureMessage);
        }
      },
      { kind: 2 /* SpanKind.CLIENT */ }
    );
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
   * Execute a query and process each row with a callback function.
   * Rows are processed sequentially to avoid memory bloat on large result sets.
   *
   * @param {string} sql - SQL query statement
   * @param {Array} params - Query parameters
   * @param {Function} callback - Function called for each row: (row, rowIndex) => void
   * @returns {Promise<number>} Total number of rows processed
   */
  static async each(sql, params = [], callback) {
    await this.ensureInitialized();
    const lease = await this.acquireConnection();
    const db = lease.db;

    return new Promise((resolve, reject) => {
      let rowCount = 0;
      let settled = false;

      const fail = (err, message) => {
        if (settled) return;
        settled = true;
        const mappedError = this.mapDatabaseError(err, message);
        const retire = this.classifyDatabaseError(err) === 'connection';
        lease.release({ retire }).catch(() => {});
        reject(mappedError);
      };

      db.each(sql, params, (err, row) => {
        if (err) return fail(err, 'Row processing failed');
        try {
          callback(row, rowCount);
          rowCount++;
        } catch (callbackErr) {
          if (settled) return;
          settled = true;
          lease.release().catch(() => {});
          reject(callbackErr);
        }
      }, (err) => {
        if (err) return fail(err, 'Query iteration failed');
        if (settled) return;
        settled = true;
        lease.release().catch(() => {});
        resolve(rowCount);
      });
    });
  }

  /**
   * Runs one or more SQL statements that take no parameters (for example a
   * migration with several DDL statements). Parameterised statements belong in
   * run/get/all, which bind values safely.
   *
   * @param {string} sql
   * @returns {Promise<void>}
   */
  static async exec(sql) {
    const lease = await this.acquireConnection();
    let rawError = null;
    await new Promise((resolve) => {
      try {
        lease.db.exec(sql, (err) => {
          rawError = err || null;
          resolve();
        });
      } catch (error) {
        rawError = error;
        resolve();
      }
    });

    const retire = !!rawError && this.classifyDatabaseError(rawError) === 'connection';
    await lease.release({ retire }).catch((releaseError) => {
      log.warn('DATABASE', 'Failed to release pooled connection', { error: releaseError.message });
    });

    if (rawError) throw this.mapDatabaseError(rawError, 'Statement batch failed');
  }
}

module.exports = QueryMethods;
