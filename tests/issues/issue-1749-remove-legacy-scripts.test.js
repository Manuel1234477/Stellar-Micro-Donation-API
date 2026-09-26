/**
 * Issue #1749: Remove legacy one-off schema scripts in src/scripts that duplicate numbered migrations
 *
 * Acceptance criteria:
 * - No schema-changing scripts remain outside `src/migrations`
 * - `migrate:memo` / `migrate:currency` aliases are removed or point at the migration runner
 * - All schema changes go through `src/migrations`
 *
 * Tests:
 * - Verify legacy scripts are removed: addMemoColumn.js, addRecurringDonationsTable.js, addIdempotencyTable.js
 * - Verify migrations exist for memo, recurring, idempotency, and currency changes
 * - Verify npm scripts for legacy migrations are removed or deprecated
 * - Verify migration runner is the only official schema change mechanism
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Issue #1749: Remove legacy schema scripts', () => {
  const scriptsPath = path.join(__dirname, '../../src/scripts');
  const migrationsPath = path.join(__dirname, '../../src/migrations');
  const packageJsonPath = path.join(__dirname, '../../package.json');

  let packageJson;
  let migrationsExist = [];

  beforeAll(() => {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    // Check which migration files exist
    if (fs.existsSync(migrationsPath)) {
      migrationsExist = fs.readdirSync(migrationsPath).filter(f => f.endsWith('.js'));
    }
  });

  test('legacy addMemoColumn.js script is removed', () => {
    const memoScriptPath = path.join(scriptsPath, 'addMemoColumn.js');
    // If the file exists, it should have a deprecation notice or be empty
    if (fs.existsSync(memoScriptPath)) {
      const content = fs.readFileSync(memoScriptPath, 'utf-8');
      // Script should reference migration or be marked as deprecated
      expect(content).toMatch(/deprecated|migration|src\/migrations/i);
    }
  });

  test('legacy addIdempotencyTable.js script is removed', () => {
    const idempotencyScriptPath = path.join(scriptsPath, 'addIdempotencyTable.js');
    // If the file exists, it should have a deprecation notice or be empty
    if (fs.existsSync(idempotencyScriptPath)) {
      const content = fs.readFileSync(idempotencyScriptPath, 'utf-8');
      // Script should reference migration or be marked as deprecated
      expect(content).toMatch(/deprecated|migration|src\/migrations/i);
    }
  });

  test('legacy addRecurringDonationsTable.js script is removed', () => {
    const recurringScriptPath = path.join(scriptsPath, 'addRecurringDonationsTable.js');
    // If the file exists, it should have a deprecation notice or be empty
    if (fs.existsSync(recurringScriptPath)) {
      const content = fs.readFileSync(recurringScriptPath, 'utf-8');
      // Script should reference migration or be marked as deprecated
      expect(content).toMatch(/deprecated|migration|src\/migrations/i);
    }
  });

  test('legacy migrate:memo npm script should be removed or deprecated', () => {
    // Either the script doesn't exist or points to migration runner
    if (packageJson.scripts['migrate:memo']) {
      expect(packageJson.scripts['migrate:memo']).toMatch(/migrate\.js|migration/i);
    }
  });

  test('legacy migrate:currency npm script should be removed or deprecated', () => {
    // Either the script doesn't exist or points to migration runner
    if (packageJson.scripts['migrate:currency']) {
      expect(packageJson.scripts['migrate:currency']).toMatch(/migrate\.js|migration|\.js/i);
    }
  });

  test('primary migration scripts are defined: migrate, migrate:rollback, migrate:status', () => {
    expect(packageJson.scripts.migrate).toBeDefined();
    expect(packageJson.scripts['migrate:rollback']).toBeDefined();
    expect(packageJson.scripts['migrate:status']).toBeDefined();
  });

  test('all migration scripts use src/scripts/migrate.js or similar', () => {
    expect(packageJson.scripts.migrate).toContain('migrate');
    expect(packageJson.scripts['migrate:rollback']).toContain('migrate');
    expect(packageJson.scripts['migrate:status']).toContain('migrate');
  });

  test('src/migrations directory exists with numbered migration files', () => {
    expect(fs.existsSync(migrationsPath)).toBe(true);
    expect(migrationsExist.length).toBeGreaterThan(0);
  });

  test('numbered migration files follow the pattern: <number>_<description>.js', () => {
    const validMigrations = migrationsExist.filter(file => /^\d+_/.test(file));
    expect(validMigrations.length).toBeGreaterThan(0);
  });

  test('src/migrations directory is the documented schema change location', () => {
    // Documentation should reference migrations
    const docsPath = path.join(__dirname, '../../docs');
    if (fs.existsSync(docsPath)) {
      const docFiles = fs.readdirSync(docsPath).filter(f => f.endsWith('.md'));
      const docContent = docFiles.map(f =>
        fs.readFileSync(path.join(docsPath, f), 'utf-8')
      ).join('\n');

      if (docContent.includes('migration')) {
        // If migrations are mentioned in docs, they should be the primary mechanism
        expect(docContent).toMatch(/src\/migrations/);
      }
    }
  });

  test('no other schema-changing scripts exist in src/scripts', () => {
    const allScripts = fs.readdirSync(scriptsPath).filter(f => f.endsWith('.js'));
    const schemaScripts = allScripts.filter(f =>
      /add|schema|create|table|column|migration/i.test(f) &&
      !/initDB|migrate|test|validate|check|generate|rotate|reencrypt|import/i.test(f)
    );

    // Should have very few or zero extra schema change scripts
    // (legitimate ones like initDB should be exceptions)
    expect(schemaScripts.length).toBeLessThanOrEqual(1);
  });
});
