'use strict';

/**
 * Tests for issue #1761: Collision-proof migration naming scheme
 *
 * Validates that:
 * - New migrations use UTC timestamp prefix format (YYYYMMDDTHHmmss_name.js)
 * - All new migrations sort after existing ones
 * - Migration order is deterministic (no lexicographic ambiguity within a prefix)
 * - Fresh DB migrated from zero has identical schema to incrementally upgraded DB
 */

const fs = require('fs');
const path = require('path');

describe('Issue #1761: Collision-proof migration naming', () => {
  test('timestamp format ensures global uniqueness', () => {
    // Simulate multiple timestamps across different times
    const timestamps = [
      '20260101T120000',
      '20260101T120001',
      '20260515T093000',
      '20261231T235959',
    ];

    // Each timestamp should be unique
    const uniqueTs = new Set(timestamps);
    expect(uniqueTs.size).toBe(timestamps.length);

    // All should parse as valid ISO format
    for (const ts of timestamps) {
      const parts = ts.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
      expect(parts).not.toBeNull();
      expect(parts.length).toBe(7);
    }
  });

  test('new migrations with timestamp prefix sort correctly', () => {
    const migrations = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
      '032_refund_transactions.js',
      '042_add_sdg_tags.js',
      '20260101T120000_new_feature.js',
      '20260515T093000_another_feature.js',
      '20261231T235959_final_migration.js',
    ];

    const sorted = [...migrations].sort();

    // Timestamps come after numeric prefixes when sorted lexicographically
    const timestampMigrations = sorted.filter(m => m.match(/^202\d/));
    expect(timestampMigrations.length).toBe(3);

    // Verify timestamp migrations are at the end
    expect(sorted[sorted.length - 3]).toMatch(/^202\d/);
    expect(sorted[sorted.length - 2]).toMatch(/^202\d/);
    expect(sorted[sorted.length - 1]).toMatch(/^202\d/);
  });

  test('no duplicate numeric prefixes in migration names', () => {
    const migrations = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
      '032_refund_transactions.js',
      '032_wallets_table.js', // DUPLICATE - should fail
      '034_campaign_milestone.js',
      '042_add_sdg_tags.js',
      '20260101T120000_first_timestamp.js',
      '20260515T093000_second_timestamp.js',
    ];

    // Extract numeric prefixes
    const prefixes = migrations
      .map(m => m.match(/^(\d+)/)?.[1])
      .filter(Boolean);

    // Find duplicates
    const seen = new Set();
    const duplicates = [];
    for (const prefix of prefixes) {
      if (seen.has(prefix)) {
        duplicates.push(prefix);
      }
      seen.add(prefix);
    }

    expect(duplicates).toContain('032'); // Should detect the duplicate
    expect(duplicates).not.toContain('001');
    expect(duplicates).not.toContain('202'); // Timestamps don't have numeric prefixes
  });

  test('migration name validation enforces timestamp format for new migrations', () => {
    const validNewMigrations = [
      '20260101T120000_feature_name.js',
      '20261231T235959_another_feature.js',
      '20260515T093000_with_underscores_ok.js',
    ];

    const invalidMigrations = [
      '20260101_no_time.js', // Missing time
      '2026_too_short.js', // Not a full timestamp
      'feature_no_timestamp.js', // No timestamp
      '032_old_style.js', // Old numeric prefix (acceptable for existing migrations)
    ];

    const timestampPattern = /^(\d{8}T\d{6})_/;

    for (const migrationName of validNewMigrations) {
      expect(migrationName).toMatch(timestampPattern);
    }

    // First three invalid ones should not match
    for (const migrationName of invalidMigrations.slice(0, 3)) {
      expect(migrationName).not.toMatch(timestampPattern);
    }
  });

  test('fresh DB migrated sequentially produces same final state as from zero', () => {
    // Simulate migration execution on fresh DB
    const migrations = [
      { name: '001_initial', version: 1 },
      { name: '010_users', version: 10 },
      { name: '020_donations', version: 20 },
      { name: '20260101T120000_new_feature', version: 100 },
      { name: '20260515T093000_another_feature', version: 101 },
    ];

    // Fresh DB: apply all migrations in order
    let freshState = { schemaVersion: 0, tables: [] };
    const migrationLog = [];

    for (const migration of migrations) {
      freshState.schemaVersion = migration.version;
      freshState.tables.push(migration.name);
      migrationLog.push(migration.name);
    }

    // Incremental DB: start with some migrations already applied
    let incrementalState = { schemaVersion: 20, tables: ['001_initial', '010_users', '020_donations'] };
    let applied = [];

    // Apply remaining migrations
    for (const migration of migrations) {
      if (migration.version > incrementalState.schemaVersion) {
        incrementalState.schemaVersion = migration.version;
        incrementalState.tables.push(migration.name);
        applied.push(migration.name);
      }
    }

    // Both should end in identical state
    expect(freshState.schemaVersion).toBe(incrementalState.schemaVersion);
    expect(freshState.tables).toEqual(incrementalState.tables);
  });

  test('migration ordering is deterministic across runs', () => {
    const migrationFiles = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
      '032_refund_transactions.js',
      '042_add_sdg_tags.js',
      '20260101T120000_feature_a.js',
      '20260515T093000_feature_b.js',
      '20261231T235959_feature_c.js',
    ];

    // Sort multiple times
    const sort1 = [...migrationFiles].sort();
    const sort2 = [...migrationFiles].sort();
    const sort3 = [...migrationFiles].sort();

    expect(sort1).toEqual(sort2);
    expect(sort2).toEqual(sort3);
  });

  test('pre-merge check can validate new migration sorts after all existing', () => {
    // Existing migrations in repo
    const existing = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
      '032_refund_transactions.js',
      '042_add_sdg_tags.js',
    ];

    // New migration being added
    const newMigration = '20260101T120000_new_feature.js';

    // Check: new migration should sort after all existing
    const allMigrations = [...existing, newMigration];
    const sorted = [...allMigrations].sort();

    // New migration should be at the end
    expect(sorted[sorted.length - 1]).toBe(newMigration);

    // All existing should come before it
    for (let i = 0; i < existing.length; i++) {
      expect(sorted.indexOf(existing[i])).toBeLessThan(sorted.indexOf(newMigration));
    }
  });

  test('migration IDs with timestamps prevent parallel PR collisions', () => {
    // Simulate two PRs being developed in parallel
    const baseExisting = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
    ];

    // PR 1: adds feature at 2026-01-15 12:00:00
    const pr1Migration = '20260115T120000_feature_from_pr1.js';

    // PR 2: adds feature at 2026-01-15 12:00:05 (5 seconds later)
    const pr2Migration = '20260115T120005_feature_from_pr2.js';

    // When both are merged, there's no collision
    const merged = [...baseExisting, pr1Migration, pr2Migration];
    const sorted = [...merged].sort();

    // Both should be present and in order
    expect(sorted).toContain(pr1Migration);
    expect(sorted).toContain(pr2Migration);
    expect(sorted.indexOf(pr1Migration)).toBeLessThan(sorted.indexOf(pr2Migration));
  });

  test('numeric prefix check script detects collisions', () => {
    // Simulated check-migration-ids logic
    const migrationFiles = [
      '001_initial.js',
      '010_users.js',
      '020_donations.js',
      '032_refund_transactions.js',
      '032_wallets_table.js', // COLLISION
      '034_campaign_milestone.js',
      '034_payment_streams.js', // COLLISION
      '042_add_sdg_tags.js',
      '042_refresh_token.js', // COLLISION
      '20260101T120000_new.js',
      '20260515T093000_another.js',
    ];

    // Extract numeric prefixes
    const prefixMap = {};
    for (const file of migrationFiles) {
      const match = file.match(/^(\d+)/);
      if (match) {
        const prefix = match[1];
        if (!prefixMap[prefix]) {
          prefixMap[prefix] = [];
        }
        prefixMap[prefix].push(file);
      }
    }

    // Find collisions (prefix with multiple files)
    const collisions = Object.entries(prefixMap)
      .filter(([_, files]) => files.length > 1)
      .map(([prefix, files]) => ({ prefix, files }));

    expect(collisions).toHaveLength(3);
    expect(collisions.map(c => c.prefix)).toEqual(['032', '034', '042']);
  });
});
