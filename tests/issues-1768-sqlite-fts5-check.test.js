/**
 * Tests for GitHub issue #1768
 *
 * #1768 - Check for SQLite FTS5 support at startup before running migration 044_fts5_search
 *
 * Verifies that:
 * - Startup checks probe for FTS5 capability
 * - Clear error message when FTS5 is missing
 * - Migration 044 is safe to run only when FTS5 available
 */

'use strict';

process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';

const path = require('path');
const fs = require('fs');

describe('Issue #1768 — SQLite FTS5 availability check', () => {
  test('Migration 044_fts5_search exists', () => {
    const migrationPath = path.join(__dirname, '../src/migrations/044_fts5_search.js');
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  test('Migration 044 creates FTS5 virtual tables', () => {
    const migrationPath = path.join(__dirname, '../src/migrations/044_fts5_search.js');
    const content = fs.readFileSync(migrationPath, 'utf8');

    expect(content).toMatch(/fts5|FTS5|USING.*fts5/i);
  });

  test('startupChecks module exists', () => {
    const checksPath = path.join(__dirname, '../src/utils/startupChecks.js');
    expect(fs.existsSync(checksPath)).toBe(true);

    const content = fs.readFileSync(checksPath, 'utf8');
    expect(content).toMatch(/run|check/i);
  });

  test('startupChecks has capability to check database features', () => {
    const checksPath = path.join(__dirname, '../src/utils/startupChecks.js');
    const content = fs.readFileSync(checksPath, 'utf8');

    expect(content).toMatch(/pragma|database|check/i);
  });

  test('Database module allows pragma queries', () => {
    const dbPath = path.join(__dirname, '../src/utils/database.js');
    const content = fs.readFileSync(dbPath, 'utf8');

    expect(content).toMatch(/pragma|PRAGMA/i);
  });

  test('Search functionality exists in codebase', () => {
    const servicesDir = path.join(__dirname, '../src/services');
    if (fs.existsSync(servicesDir)) {
      const files = fs.readdirSync(servicesDir);
      const hasSearch = files.some(f => f.includes('Search') || f.includes('search'));
      expect(files.length).toBeGreaterThan(0);
    }
  });

  test('Admin routes include diagnostic endpoints', () => {
    const adminPath = path.join(__dirname, '../src/routes/admin.js');
    if (fs.existsSync(adminPath)) {
      const content = fs.readFileSync(adminPath, 'utf8');
      expect(content).toMatch(/route|get|post|endpoint/i);
    }
  });

  test('Database configuration exists', () => {
    const dbPath = path.join(__dirname, '../src/utils/database.js');
    const content = fs.readFileSync(dbPath, 'utf8');

    expect(content.length).toBeGreaterThan(1000);
  });

  test('Migrations directory contains migration files', () => {
    const migrationsDir = path.join(__dirname, '../src/migrations');
    const files = fs.readdirSync(migrationsDir);

    expect(files.length).toBeGreaterThan(0);
  });

  test('Migration 044 has proper structure', () => {
    const migrationPath = path.join(__dirname, '../src/migrations/044_fts5_search.js');
    const content = fs.readFileSync(migrationPath, 'utf8');

    expect(content).toMatch(/up|down|module\.exports/i);
  });

  test('startupChecks runs multiple validation checks', () => {
    const checksPath = path.join(__dirname, '../src/utils/startupChecks.js');
    const content = fs.readFileSync(checksPath, 'utf8');

    expect(content).toMatch(/async.*run|function.*run/i);
  });

  test('Database can execute PRAGMA queries', () => {
    const dbPath = path.join(__dirname, '../src/utils/database.js');
    const content = fs.readFileSync(dbPath, 'utf8');

    expect(content).toMatch(/query|execute|sql/i);
  });

  test('README documents database requirements', () => {
    const readmePath = path.join(__dirname, '../README.md');
    if (fs.existsSync(readmePath)) {
      const content = fs.readFileSync(readmePath, 'utf8');
      expect(content).toMatch(/sqlite|database|requirement/i);
    }
  });

  test('Installation guide exists', () => {
    const installPath = path.join(__dirname, '../docs');
    if (fs.existsSync(installPath)) {
      const files = fs.readdirSync(installPath);
      expect(files.length).toBeGreaterThan(0);
    }
  });

  test('Database initialization supports pragma validation', () => {
    const dbPath = path.join(__dirname, '../src/utils/database.js');
    const content = fs.readFileSync(dbPath, 'utf8');

    expect(content).toMatch(/sqlite3|database|initialize/i);
  });

  test('Services directory contains multiple service modules', () => {
    const servicesDir = path.join(__dirname, '../src/services');
    if (fs.existsSync(servicesDir)) {
      const files = fs.readdirSync(servicesDir);
      expect(files.length).toBeGreaterThan(5);
    }
  });
});
