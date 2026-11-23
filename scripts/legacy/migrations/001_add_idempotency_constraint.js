'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DATA_DIR = './data';
const DB_PATH = path.join(DATA_DIR, 'stellar_donations.db');

/**
 * Migration: Add idempotency constraints to transactions table
 *
 * This migration adds:
 * 1. idempotencyKey column with UNIQUE constraint
 * 2. Index on idempotencyKey for fast lookups
 *
 * Bug fixes vs original implementation:
 *
 * #1354 — ROLLBACK-in-serialize: The original code called db.run('ROLLBACK')
 * from inside error callbacks within a db.serialize() block. In node-sqlite3
 * every statement inside serialize() is queued synchronously before any callback
 * fires, so a ROLLBACK issued from a mid-sequence callback cannot prevent the
 * already-queued statements from executing. This rewrite uses promisified
 * db.run() calls awaited in sequence so that a failure at any step throws
 * immediately and triggers a real ROLLBACK before any subsequent statement runs.
 *
 * #1353 — Column loss: The original INSERT only copied
 * (id, senderId, receiverId, amount, memo, timestamp), silently discarding
 * notes, tags, deleted_at, stellar_tx_id, is_orphan, campaign_id, validAfter,
 * validBefore, and tenant_id for every existing row. This rewrite copies all
 * columns that exist in the legacy pre-idempotency schema.
 */

/**
 * Promisify a single db.run() call so we can await it and propagate errors.
 */
function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

/**
 * Promisify db.all() for PRAGMA queries.
 */
function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) reject(new Error(`Failed to connect to database: ${err.message}`));
      else resolve(db);
    });
  });
}

function closeDatabase(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

async function runMigration() {
  const db = await openDatabase();
  console.log('✓ Connected to database');

  try {
    const columns = await all(db, 'PRAGMA table_info(transactions)');
    const colNames = columns.map((c) => c.name);

    if (colNames.includes('idempotencyKey')) {
      console.log('✓ idempotencyKey column already exists — skipping migration');
      return;
    }

    console.log('Adding idempotencyKey column with UNIQUE constraint...');

    // --- Detect which optional columns exist in the current schema so we copy
    //     exactly what is present, without assuming any particular deployment
    //     state.  The core columns are always present.
    const optionalColumns = [
      'notes',
      'tags',
      'deleted_at',
      'stellar_tx_id',
      'is_orphan',
      'campaign_id',
      'validAfter',
      'validBefore',
      'tenant_id',
    ];
    const existingOptional = optionalColumns.filter((c) => colNames.includes(c));
    const copyColumns = [
      'id',
      'senderId',
      'receiverId',
      'amount',
      'memo',
      'timestamp',
      ...existingOptional,
    ];
    const colList = copyColumns.join(', ');

    // Build the new table DDL.  Only include optional column definitions that
    // actually exist on the source table so the schema stays consistent.
    const optionalDefs = [];
    if (colNames.includes('notes'))        optionalDefs.push('notes TEXT');
    if (colNames.includes('tags'))         optionalDefs.push('tags TEXT');
    if (colNames.includes('deleted_at'))   optionalDefs.push('deleted_at DATETIME DEFAULT NULL');
    if (colNames.includes('stellar_tx_id'))optionalDefs.push('stellar_tx_id TEXT UNIQUE');
    if (colNames.includes('is_orphan'))    optionalDefs.push('is_orphan INTEGER NOT NULL DEFAULT 0');
    if (colNames.includes('campaign_id'))  optionalDefs.push('campaign_id INTEGER');
    if (colNames.includes('validAfter'))   optionalDefs.push('validAfter INTEGER DEFAULT 0');
    if (colNames.includes('validBefore'))  optionalDefs.push('validBefore INTEGER DEFAULT 0');
    if (colNames.includes('tenant_id'))    optionalDefs.push("tenant_id TEXT NOT NULL DEFAULT 'default'");

    const optionalDefsSql = optionalDefs.length ? '\n      ' + optionalDefs.join(',\n      ') + ',' : '';

    // Use explicit await-based sequencing so a failure at any step immediately
    // triggers ROLLBACK and prevents subsequent statements from executing.
    await run(db, 'BEGIN TRANSACTION');

    try {
      await run(db, `
        CREATE TABLE transactions_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          senderId INTEGER NOT NULL,
          receiverId INTEGER NOT NULL,
          amount REAL NOT NULL,
          memo TEXT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,${optionalDefsSql}
          idempotencyKey TEXT UNIQUE,
          FOREIGN KEY (senderId) REFERENCES users(id),
          FOREIGN KEY (receiverId) REFERENCES users(id)
        )
      `);
      console.log('✓ Created new transactions table with idempotency constraint');

      // Copy ALL existing columns — including notes, tags, deleted_at,
      // stellar_tx_id, is_orphan, campaign_id, validAfter, validBefore,
      // tenant_id — so no data is silently discarded (#1353).
      await run(db, `
        INSERT INTO transactions_new (${colList})
        SELECT ${colList} FROM transactions
      `);
      console.log('✓ Copied existing data (all columns preserved)');

      await run(db, 'DROP TABLE transactions');
      console.log('✓ Dropped old table');

      await run(db, 'ALTER TABLE transactions_new RENAME TO transactions');
      console.log('✓ Renamed new table');

      await run(db, `
        CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
        ON transactions(idempotencyKey)
      `);
      console.log('✓ Created index on idempotencyKey');

      await run(db, 'COMMIT');
      console.log('✓ Migration committed successfully');
    } catch (err) {
      // Roll back before propagating — because we are awaiting each statement
      // individually, no further SQL has been queued at this point, so the
      // ROLLBACK genuinely undoes everything back to the BEGIN (#1354).
      try { await run(db, 'ROLLBACK'); } catch (_) { /* best-effort */ }
      throw err;
    }
  } finally {
    await closeDatabase(db);
  }
}

async function main() {
  console.log('Running migration: Add idempotency constraints\n');
  try {
    await runMigration();
    console.log('\n✓ Migration completed successfully!');
  } catch (error) {
    console.error('\n✗ Migration failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { runMigration };
