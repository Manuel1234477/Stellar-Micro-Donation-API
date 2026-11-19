/**
 * Database error diagnostics (#1949)
 *
 * The client-facing DatabaseError message must stay generic, while the SQLite
 * code, the SQL verb and the original message are kept on the error, logged
 * server-side and counted in db_errors_total.
 */

'use strict';

const { DatabaseError } = require('../../src/utils/errors');
const Database = require('../../src/utils/database');
const log = require('../../src/utils/log');
const metrics = require('../../src/utils/metrics');

function sqliteError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

describe('mapDatabaseError diagnostics (#1949)', () => {
  let logSpy;
  let metricSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(log, 'error').mockImplementation(() => {});
    metricSpy = jest.spyOn(metrics, 'recordDatabaseError');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('keeps the SQLite code, operation and original error on the mapped error', () => {
    const raw = sqliteError('no such table: donations', 'SQLITE_ERROR');

    const mapped = Database.mapDatabaseError(raw, 'Database query failed', {
      sql: 'SELECT * FROM donations WHERE id = ?',
    });

    expect(mapped).toBeInstanceOf(DatabaseError);
    expect(mapped.cause).toBe(raw);
    expect(mapped.sqliteCode).toBe('SQLITE_ERROR');
    expect(mapped.operation).toBe('SELECT');
    expect(mapped.category).toBe('unknown');
  });

  test('logs the SQLite code and original message server-side', () => {
    const raw = sqliteError('database is locked', 'SQLITE_BUSY');

    Database.mapDatabaseError(raw, 'Database operation failed', {
      sql: 'UPDATE donations SET status = ?',
    });

    expect(logSpy).toHaveBeenCalledWith(
      'DATABASE',
      'Database operation failed',
      expect.objectContaining({
        sqliteCode: 'SQLITE_BUSY',
        category: 'busy',
        operation: 'UPDATE',
        error: 'database is locked',
      })
    );
  });

  test('increments db_errors_total labelled by SQLite code, category and operation', () => {
    Database.mapDatabaseError(sqliteError('no such column: x', 'SQLITE_ERROR'), 'failed', {
      operation: 'INSERT',
    });

    expect(metricSpy).toHaveBeenCalledWith({
      sqliteCode: 'SQLITE_ERROR',
      category: 'unknown',
      operation: 'INSERT',
    });
  });

  test('client-facing message stays generic outside NODE_ENV=test', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const mapped = Database.mapDatabaseError(
        sqliteError('no such table: secret_table', 'SQLITE_ERROR'),
        'Database query failed'
      );
      expect(mapped.message).toBe('Database query failed');
      expect(mapped.toJSON().error.message).not.toContain('secret_table');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('NODE_ENV=test includes the SQLite code and message in the error text', () => {
    expect(process.env.NODE_ENV).toBe('test');
    const mapped = Database.mapDatabaseError(
      sqliteError('no such column: idempotency_key', 'SQLITE_ERROR'),
      'Database query failed'
    );
    expect(mapped.message).toContain('SQLITE_ERROR');
    expect(mapped.message).toContain('no such column: idempotency_key');
  });

  test('duplicate violations still map to DuplicateError without logging an error', () => {
    const mapped = Database.mapDatabaseError(
      sqliteError('UNIQUE constraint failed: donations.idempotency_key', 'SQLITE_CONSTRAINT'),
      'Database operation failed'
    );
    expect(mapped.name).toBe('DuplicateError');
    expect(logSpy).not.toHaveBeenCalled();
  });
});
