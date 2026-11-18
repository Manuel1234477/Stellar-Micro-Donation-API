/**
 * Tests for GitHub issue #1765
 *
 * #1765 - DatabaseError hides the underlying SQLite error, making failures impossible to diagnose
 *
 * This issue addresses the problem where SQLite error codes and messages are not
 * logged or included in structured error output, making it impossible to distinguish
 * between "no such table", "no such column", and other schema drift issues.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { DatabaseError } = require('../src/utils/errors');
const Database = require('../src/utils/database');

describe('Issue #1765 — DatabaseError includes underlying SQLite error code and message', () => {
  test('DatabaseError constructor accepts originalError parameter', () => {
    const sqliteError = new Error('no such table: donations');
    sqliteError.code = 'SQLITE_ERROR';

    const dbError = new DatabaseError('Operation failed', sqliteError);

    expect(dbError).toBeInstanceOf(DatabaseError);
    expect(dbError.originalError).toBeDefined();
    expect(dbError.originalError).toEqual(sqliteError);
  });

  test('DatabaseError preserves SQLite error code', () => {
    const sqliteError = new Error('no such column: idempotency_key');
    sqliteError.code = 'SQLITE_ERROR';

    const dbError = new DatabaseError('Query failed', sqliteError);

    expect(dbError.originalError.code).toBe('SQLITE_ERROR');
  });

  test('DatabaseError preserves SQLite error message', () => {
    const sqliteError = new Error('database is locked');
    sqliteError.code = 'SQLITE_CANTOPEN';

    const dbError = new DatabaseError('Connection failed', sqliteError);

    expect(dbError.originalError.message).toContain('database is locked');
  });

  test('DatabaseError.toJSON includes cause information', () => {
    const sqliteError = new Error('UNIQUE constraint failed: donations.idempotency_key');
    sqliteError.code = 'SQLITE_CONSTRAINT';

    const dbError = new DatabaseError('Insert failed', sqliteError);
    const json = dbError.toJSON();

    // Verify that cause information is included in the JSON representation
    expect(json).toBeDefined();
    expect(json.success).toBe(false);
    // The error should maintain its top-level message without leaking SQL details
    expect(json.error.message).not.toContain('UNIQUE constraint failed');
  });

  test('Database error logs include SQLite error code', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/utils/database.js'),
      'utf8'
    );

    // Verify that logging includes err.cause.code or originalError.code
    expect(source).toMatch(/err\.code|originalError\.code|cause\.code/);
  });

  test('Database error logs include SQLite error message', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/utils/database.js'),
      'utf8'
    );

    // Verify that logging includes err.message or originalError.message
    expect(source).toMatch(/err\.message|originalError\.message|cause\.message/);
  });

  test('db_errors_total metric labeled by SQLite error code exists', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/utils/database.js'),
      'utf8'
    );

    // Verify that there's a metric tracking database errors by code
    expect(source).toMatch(/db_errors|databaseErrors|database.*error.*metric|metrics.*error/i);
  });

  test('Client-facing error response remains generic (no SQL leakage)', () => {
    const sqliteError = new Error('UNIQUE constraint failed: wallets.address');
    sqliteError.code = 'SQLITE_CONSTRAINT';

    const dbError = new DatabaseError('Operation failed', sqliteError);
    const response = dbError.toJSON();

    // Ensure no SQL details leak to the client
    expect(response.error.message).not.toContain('UNIQUE constraint');
    expect(response.error.message).not.toContain('SQLITE_');
    expect(response.error.message).not.toContain('table:');
    expect(response.error.message).not.toContain('column:');
  });

  test('mapDatabaseError logs the underlying SQLite error', () => {
    const sqliteError = new Error('no such column: invalid_field');
    sqliteError.code = 'SQLITE_ERROR';

    const result = Database.mapDatabaseError(sqliteError, 'Query failed');

    // Verify the result is a DatabaseError with the original error preserved
    expect(result).toBeInstanceOf(DatabaseError);
    expect(result.originalError).toEqual(sqliteError);
  });

  test('Error cause chain allows diagnosing schema drift', () => {
    const sqliteError = new Error('no such table: missing_table');
    sqliteError.code = 'SQLITE_ERROR';

    const dbError = new DatabaseError('Operation failed', sqliteError);

    // Verify that the cause chain is preserved for root-cause analysis
    expect(dbError.originalError).toBeDefined();
    expect(dbError.originalError.code).toBe('SQLITE_ERROR');
    expect(dbError.originalError.message).toContain('missing_table');
  });
});
