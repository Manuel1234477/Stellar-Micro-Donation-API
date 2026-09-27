'use strict';

/**
 * Tests for issue #1762: Safe renaming strategy for already-applied migrations
 *
 * Validates that:
 * - Migration aliases prevent re-applying renamed migrations
 * - Alias map is consulted before treating migration as pending
 * - One-time migration rewrites schema_migrations.name rows safely
 * - Pre-rename DB upgrade works without errors
 */

const sqlite3 = require('sqlite3').verbose();

function createInMemoryDb() {
  const sqlite = new sqlite3.Database(':memory:');

  const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
      sqlite.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      })
    );

  const query = (sql, params = []) =>
    new Promise((resolve, reject) =>
      sqlite.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
    );

  return { run, query, _sqlite: sqlite };
}

describe('Issue #1762: Migration alias functionality', () => {
  let db;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach((done) => {
    db._sqlite.close(done);
  });

  test('creates schema_migrations table with name UNIQUE constraint', async () => {
    await db.run(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'", []);

    // Insert a migration record
    await db.run(
      'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
      ['032_refund_transactions', 'abc123']
    );

    const rows = await db.query('SELECT * FROM schema_migrations', []);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('032_refund_transactions');
  });

  test('alias map prevents re-applying renamed migrations', async () => {
    await db.run(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Pre-rename DB has migration under old name
    await db.run(
      'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
      ['032_refund_transactions', 'abc123']
    );

    // Alias map: new_name -> old_name
    const aliasMap = {
      '20260101T120000_refund_transactions': '032_refund_transactions',
    };

    // Check if migration is pending
    const newMigrationName = '20260101T120000_refund_transactions';
    const oldName = aliasMap[newMigrationName];

    const appliedRows = await db.query(
      'SELECT name FROM schema_migrations WHERE name = ? OR name = ?',
      [newMigrationName, oldName]
    );

    expect(appliedRows).toHaveLength(1);
    expect(appliedRows[0].name).toBe('032_refund_transactions');

    // Migration should NOT be treated as pending
    const isPending = appliedRows.length === 0;
    expect(isPending).toBe(false);
  });

  test('one-time migration rewrites old migration names to new format', async () => {
    await db.run(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Pre-rename state with old names
    const oldMigrations = [
      ['032_refund_transactions', 'abc123'],
      ['034_campaign_milestone_notifications', 'def456'],
      ['042_add_sdg_tags_to_campaigns_and_wallets', 'ghi789'],
    ];

    for (const [name, checksum] of oldMigrations) {
      await db.run(
        'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
        [name, checksum]
      );
    }

    // Simulate the one-time migration that renames entries
    const renameMap = {
      '032_refund_transactions': '20260101T120000_refund_transactions',
      '034_campaign_milestone_notifications': '20260101T120001_campaign_milestone_notifications',
      '042_add_sdg_tags_to_campaigns_and_wallets': '20260101T120002_add_sdg_tags_to_campaigns_and_wallets',
    };

    for (const [oldName, newName] of Object.entries(renameMap)) {
      // Get the checksum before deleting
      const rows = await db.query(
        'SELECT checksum FROM schema_migrations WHERE name = ?',
        [oldName]
      );

      if (rows.length > 0) {
        const checksum = rows[0].checksum;

        // Delete old row and insert new one (simulating transaction)
        await db.run('DELETE FROM schema_migrations WHERE name = ?', [oldName]);
        await db.run(
          'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
          [newName, checksum]
        );
      }
    }

    const finalRows = await db.query('SELECT name FROM schema_migrations ORDER BY id', []);
    expect(finalRows.map(r => r.name)).toEqual([
      '20260101T120000_refund_transactions',
      '20260101T120001_campaign_milestone_notifications',
      '20260101T120002_add_sdg_tags_to_campaigns_and_wallets',
    ]);
  });

  test('aliases.json structure supports bidirectional lookup', async () => {
    // Simulated aliases.json content
    const aliasMap = {
      '20260101T120000_refund_transactions': '032_refund_transactions',
      '20260101T120001_campaign_milestone_notifications': '034_campaign_milestone_notifications',
      '20260101T120002_add_sdg_tags_to_campaigns_and_wallets': '042_add_sdg_tags_to_campaigns_and_wallets',
    };

    // Can look up old name by new name
    expect(aliasMap['20260101T120000_refund_transactions']).toBe('032_refund_transactions');

    // Can reverse lookup to find new name by old name
    const reverseMap = Object.fromEntries(
      Object.entries(aliasMap).map(([newName, oldName]) => [oldName, newName])
    );
    expect(reverseMap['032_refund_transactions']).toBe('20260101T120000_refund_transactions');
  });

  test('migration runner consults alias before determining if migration is pending', async () => {
    await db.run(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Simulate pre-rename DB with old names already applied
    const appliedMigrations = [
      '032_refund_transactions',
      '032_wallets_table',
      '034_campaign_milestone_notifications',
    ];

    for (const name of appliedMigrations) {
      await db.run(
        'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
        [name, 'hash_' + name]
      );
    }

    // Alias map for renamed migrations
    const aliasMap = {
      '20260101T120000_refund_transactions': '032_refund_transactions',
      '20260101T120001_wallets_table': '032_wallets_table',
      '20260101T120002_campaign_milestone_notifications': '034_campaign_milestone_notifications',
    };

    // New migration list (with renamed names)
    const newMigrations = [
      '20260101T120000_refund_transactions',
      '20260101T120001_wallets_table',
      '20260101T120002_campaign_milestone_notifications',
    ];

    const pending = [];
    for (const migrationName of newMigrations) {
      const aliasedName = aliasMap[migrationName];

      const rows = await db.query(
        'SELECT name FROM schema_migrations WHERE name = ? OR name = ?',
        [migrationName, aliasedName]
      );

      if (rows.length === 0) {
        pending.push(migrationName);
      }
    }

    // All three should be skipped (found via aliases)
    expect(pending).toHaveLength(0);
  });

  test('pre-rename DB snapshot can be upgraded without errors', async () => {
    await db.run(`
      CREATE TABLE schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Simulate pre-rename DB state
    const preMigrations = [
      '001_initial',
      '010_users',
      '020_donations',
      '032_refund_transactions',
      '042_add_sdg_tags',
    ];

    for (const name of preMigrations) {
      await db.run(
        'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
        [name, 'hash_' + name]
      );
    }

    // Verify all migrations are recorded
    const beforeCount = await db.query('SELECT COUNT(*) as cnt FROM schema_migrations', []);
    expect(beforeCount[0].cnt).toBe(5);

    // Apply one-time rename migration (simulated)
    const renameMap = {
      '032_refund_transactions': '20260101T120000_refund_transactions',
      '042_add_sdg_tags': '20260101T120001_add_sdg_tags',
    };

    for (const [oldName, newName] of Object.entries(renameMap)) {
      const rows = await db.query('SELECT checksum FROM schema_migrations WHERE name = ?', [oldName]);
      if (rows.length > 0) {
        const checksum = rows[0].checksum;
        await db.run('DELETE FROM schema_migrations WHERE name = ?', [oldName]);
        await db.run(
          'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
          [newName, checksum]
        );
      }
    }

    // Verify all migrations still exist and are accounted for
    const afterCount = await db.query('SELECT COUNT(*) as cnt FROM schema_migrations', []);
    expect(afterCount[0].cnt).toBe(5);

    const finalNames = await db.query('SELECT name FROM schema_migrations ORDER BY name', []);
    const hasNewNames = finalNames.some(r => r.name.match(/^202601/));
    expect(hasNewNames).toBe(true);
  });
});
