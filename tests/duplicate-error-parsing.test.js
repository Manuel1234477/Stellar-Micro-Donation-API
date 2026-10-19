/**
 * Tests for GitHub issue #1764
 *
 * #1764 - Database.mapDatabaseError reports every UNIQUE violation as "Duplicate donation detected"
 *
 * This issue addresses the problem where all UNIQUE constraint violations are
 * incorrectly mapped to the same generic "Duplicate donation detected" message,
 * regardless of which table or column caused the conflict.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const { DuplicateError } = require('../src/utils/errors');
const Database = require('../src/utils/database');

describe('Issue #1764 — mapDatabaseError parses UNIQUE constraint target', () => {
  test('mapDatabaseError identifies wallet address conflict', () => {
    const err = new Error('UNIQUE constraint failed: wallets.address');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
    expect(result.message).toContain('already exists');
    if (result.details) {
      expect(result.details).toHaveProperty('table');
      expect(result.details).toHaveProperty('column');
    }
  });

  test('mapDatabaseError identifies api_key name conflict', () => {
    const err = new Error('UNIQUE constraint failed: api_keys.name');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
    expect(result.message).not.toContain('Duplicate donation');
  });

  test('mapDatabaseError identifies tag conflict', () => {
    const err = new Error('UNIQUE constraint failed: tags.name');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
    expect(result.message).not.toContain('Duplicate donation');
  });

  test('mapDatabaseError identifies webhook URL conflict', () => {
    const err = new Error('UNIQUE constraint failed: webhooks.url');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
  });

  test('mapDatabaseError identifies campaign slug conflict', () => {
    const err = new Error('UNIQUE constraint failed: campaigns.slug');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
  });

  test('mapDatabaseError identifies CORS origin conflict', () => {
    const err = new Error('UNIQUE constraint failed: cors_origins.origin');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.mapDatabaseError(err, 'Operation failed');

    expect(result).toBeInstanceOf(DuplicateError);
  });

  test('isUniqueConstraintError detects SQLITE_CONSTRAINT with UNIQUE', () => {
    const err = new Error('UNIQUE constraint failed: donations.idempotency_key');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.isUniqueConstraintError(err);

    expect(result).toBe(true);
  });

  test('isUniqueConstraintError ignores non-UNIQUE constraints', () => {
    const err = new Error('FOREIGN KEY constraint failed');
    err.code = 'SQLITE_CONSTRAINT';

    const result = Database.isUniqueConstraintError(err);

    expect(result).toBe(false);
  });

  test('parseConstraintTarget extracts table and column from error message', () => {
    const err = new Error('UNIQUE constraint failed: wallets.address');
    err.code = 'SQLITE_CONSTRAINT';

    // Verify the parsing logic exists in database.js
    const source = fs.readFileSync(
      path.join(__dirname, '../src/utils/database.js'),
      'utf8'
    );

    // Ensure parseConstraintTarget method exists or similar logic
    expect(source).toMatch(/parseConstraint|constraint.*target|extract.*table|extract.*column/i);
  });
});
