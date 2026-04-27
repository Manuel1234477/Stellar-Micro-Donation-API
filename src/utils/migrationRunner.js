'use strict';

/**
 * Migration Runner
 *
 * Discovers numbered migration files in src/migrations/, tracks applied
 * migrations in a schema_migrations table, and runs pending ones in order.
 * A failed migration rolls back (via SQLite ROLLBACK) and halts startup.
 */

const fs = require('fs');
const path = require('path');
const db = require('./database');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

async function ensureMigrationsTable() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort()
    .map((f) => ({ file: f, migration: require(path.join(MIGRATIONS_DIR, f)) }));
}

async function getApplied() {
  const rows = await db.query('SELECT name FROM schema_migrations', []);
  return new Set(rows.map((r) => r.name));
}

async function runMigrations() {
  await db.initialize();
  await ensureMigrationsTable();

  const applied = await getApplied();
  const files = loadMigrationFiles();
  const pending = files.filter(({ migration }) => !applied.has(migration.name));

  if (pending.length === 0) {
    return { applied: 0, skipped: files.length };
  }

  for (const { file, migration } of pending) {
    await db.run('BEGIN');
    try {
      await migration.up(db);
      await db.run('INSERT INTO schema_migrations (name) VALUES (?)', [migration.name]);
      await db.run('COMMIT');
      console.log(`✓ Migration applied: ${migration.name} (${file})`);
    } catch (err) {
      await db.run('ROLLBACK');
      throw new Error(`Migration failed [${migration.name}]: ${err.message}`);
    }
  }

  return { applied: pending.length, skipped: files.length - pending.length };
}

module.exports = { runMigrations };
