'use strict';

/**
 * Migration Runner
 *
 * Tracks applied migrations in schema_migrations (with SHA-256 checksum),
 * runs pending migrations in order, and supports rollback + status queries.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

async function ensureMigrationsTable() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checksum TEXT NOT NULL DEFAULT ''
    )
  `);
  // Add checksum column to existing installs that lack it
  try {
    await db.run(`ALTER TABLE schema_migrations ADD COLUMN checksum TEXT NOT NULL DEFAULT ''`);
  } catch (_) { /* column already exists */ }
}

function fileChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort()
    .map((f) => {
      const filePath = path.join(MIGRATIONS_DIR, f);
      return { file: f, filePath, migration: require(filePath), checksum: fileChecksum(filePath) };
    });
}

async function getApplied() {
  const rows = await db.query('SELECT name, checksum FROM schema_migrations', []);
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

async function runMigrations() {
  await db.initialize();
  await ensureMigrationsTable();

  const applied = await getApplied();
  const files = loadMigrationFiles();

  // Warn on modified migrations
  for (const { migration, checksum } of files) {
    const storedChecksum = applied.get(migration.name);
    if (storedChecksum && storedChecksum !== '' && storedChecksum !== checksum) {
      console.warn(`⚠ WARNING: Migration "${migration.name}" has been modified after being applied (checksum mismatch).`);
    }
  }

  const pending = files.filter(({ migration }) => !applied.has(migration.name));

  if (pending.length === 0) {
    return { applied: 0, skipped: files.length };
  }

  for (const { file, migration, checksum } of pending) {
    try {
      await migration.up(db);
      await db.run(
        'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
        [migration.name, checksum]
      );
      console.log(`✓ Migration applied: ${migration.name} (${file})`);
    } catch (err) {
      throw new Error(`Migration failed [${migration.name}]: ${err.message}`);
    }
  }

  return { applied: pending.length, skipped: files.length - pending.length };
}

async function rollbackMigration() {
  await db.initialize();
  await ensureMigrationsTable();

  const rows = await db.query(
    'SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1',
    []
  );

  if (rows.length === 0) {
    console.log('No migrations to roll back.');
    return { rolledBack: null };
  }

  const { name } = rows[0];
  const files = loadMigrationFiles();
  const entry = files.find(({ migration }) => migration.name === name);

  if (!entry) {
    throw new Error(`Migration file for "${name}" not found — cannot roll back.`);
  }

  if (typeof entry.migration.down !== 'function') {
    throw new Error(`Migration "${name}" does not export a down() function.`);
  }

  await entry.migration.down(db);
  await db.run('DELETE FROM schema_migrations WHERE name = ?', [name]);
  console.log(`✓ Rolled back: ${name}`);
  return { rolledBack: name };
}

async function migrationStatus() {
  await db.initialize();
  await ensureMigrationsTable();

  const applied = await getApplied();
  const files = loadMigrationFiles();

  return files.map(({ file, migration, checksum }) => {
    const storedChecksum = applied.get(migration.name);
    const isApplied = applied.has(migration.name);
    const modified = isApplied && storedChecksum !== '' && storedChecksum !== checksum;
    return {
      name: migration.name,
      file,
      status: isApplied ? (modified ? 'applied (modified)' : 'applied') : 'pending',
    };
  });
}

module.exports = { runMigrations, rollbackMigration, migrationStatus };
