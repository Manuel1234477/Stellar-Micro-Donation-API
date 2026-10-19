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
const log = require('./log');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

/**
 * Maximum time (ms) to wait for the migration lock before giving up.
 */
const LOCK_TIMEOUT_MS = parseInt(process.env.MIGRATION_LOCK_TIMEOUT_MS, 10) || 30000;

/**
 * How often (ms) to poll when waiting for the migration lock.
 */
const LOCK_POLL_INTERVAL_MS = parseInt(process.env.MIGRATION_LOCK_POLL_INTERVAL_MS, 10) || 500;

/**
 * A unique instance identifier so we can tell who holds the lock.
 */
const INSTANCE_ID = `${require('os').hostname()}-${process.pid}`;

/**
 * Ensure the schema_migrations and migration_lock tables exist.
 */
async function ensureTables() {
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

  // Migration lock table for preventing concurrent migrations across instances
  await db.run(`
    CREATE TABLE IF NOT EXISTS migration_lock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      instance_id TEXT NOT NULL,
      acquired_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Attempt to acquire the exclusive migration lock.
 * @returns {Promise<boolean>} true if the lock was acquired
 */
async function acquireLock() {
  try {
    await db.run(
      `INSERT OR FAIL INTO migration_lock (id, instance_id, acquired_at)
       VALUES (1, ?, datetime('now'))`,
      [INSTANCE_ID]
    );
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Release the migration lock if we hold it.
 */
async function releaseLock() {
  try {
    await db.run(
      'DELETE FROM migration_lock WHERE id = 1 AND instance_id = ?',
      [INSTANCE_ID]
    );
  } catch (_) { /* non-critical */ }
}

/**
 * Busy-wait for the migration lock with a timeout.
 * @returns {Promise<boolean>} true if the lock was acquired within the timeout
 */
async function waitForLock() {
  const start = Date.now();
  while (Date.now() - start < LOCK_TIMEOUT_MS) {
    if (await acquireLock()) return true;
    await new Promise(resolve => setTimeout(resolve, LOCK_POLL_INTERVAL_MS)); // eslint-disable-line local/no-bare-timers -- awaited delay; must not be cancelled by clearAll()
  }
  return false;
}

function fileChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function loadMigrationFiles() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort();

  // Some historical migration sets intentionally share a numeric prefix.
  // The runner resolves them by filename and should continue processing them.
  const prefixMap = new Map();
  for (const f of files) {
    const prefix = f.match(/^(\d+)/)[1];
    if (prefixMap.has(prefix)) {
      log.warn(
        'MIGRATION',
        `Duplicate migration prefix "${prefix}" detected for "${prefixMap.get(prefix)}" and "${f}"; ` +
        'processing both entries by filename.'
      );
      continue;
    }
    prefixMap.set(prefix, f);
  }

  return files.map((f) => {
    const filePath = path.join(MIGRATIONS_DIR, f);
    const migration = require(filePath);
    const fileName = f.replace(/\.js$/, '');
    const canonicalName = fileName;
    return {
      file: f,
      filePath,
      migration,
      checksum: fileChecksum(filePath),
      canonicalName,
      legacyName: migration.name,
    };
  });
}

async function getApplied() {
  const rows = await db.query('SELECT name, checksum FROM schema_migrations', []);
  return new Map(rows.map((r) => [r.name, r.checksum]));
}

function getMigrationIdentity(entry, applied) {
  if (entry.canonicalName && applied.has(entry.canonicalName)) {
    return entry.canonicalName;
  }
  if (entry.legacyName && applied.has(entry.legacyName)) {
    return entry.legacyName;
  }
  return null;
}

function hasAppliedMigration(entry, applied) {
  return !!getMigrationIdentity(entry, applied);
}

async function runMigrations() {
  await db.initialize();
  await ensureTables();

  const acquired = await waitForLock();
  if (!acquired) {
    throw new Error(
      `Could not acquire migration lock within ${LOCK_TIMEOUT_MS}ms. ` +
      'Another instance may be holding it. If no other instance is running, ' +
      'delete the row from the migration_lock table manually.'
    );
  }

  try {
    const applied = await getApplied();
    const files = loadMigrationFiles();

    // Warn on modified migrations
    for (const entry of files) {
      const appliedName = getMigrationIdentity(entry, applied);
      const storedChecksum = applied.get(appliedName);
      if (storedChecksum && storedChecksum !== '' && storedChecksum !== entry.checksum) {
        log.warn('MIGRATION', `Migration "${entry.canonicalName}" has been modified after being applied (checksum mismatch).`);
      }
    }

    const pending = files.filter((entry) => !hasAppliedMigration(entry, applied));

    if (pending.length === 0) {
      return { applied: 0, skipped: files.length };
    }

    for (const { file, migration, checksum, canonicalName } of pending) {
      try {
        await migration.up(db);
        await db.run(
          'INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)',
          [canonicalName, checksum]
        );
        log.info('MIGRATION', `Migration applied: ${canonicalName} (${file})`);
      } catch (err) {
        throw new Error(`Migration failed [${canonicalName}]: ${err.message}`);
      }
    }

    return { applied: pending.length, skipped: files.length - pending.length };
  } finally {
    await releaseLock();
  }
}

async function rollbackMigration() {
  await db.initialize();
  await ensureTables();

  const acquired = await waitForLock();
  if (!acquired) {
    throw new Error(
      `Could not acquire migration lock within ${LOCK_TIMEOUT_MS}ms. ` +
      'Another instance may be holding it.'
    );
  }

  try {
    const rows = await db.query(
      'SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1',
      []
    );

    if (rows.length === 0) {
      log.info('MIGRATION', 'No migrations to roll back.');
      return { rolledBack: null };
    }

    const { name } = rows[0];
    const files = loadMigrationFiles();
    const entry = files.find(({ canonicalName, legacyName }) => canonicalName === name || legacyName === name);

    if (!entry) {
      throw new Error(`Migration file for "${name}" not found — cannot roll back.`);
    }

    if (typeof entry.migration.down !== 'function') {
      throw new Error(`Migration "${name}" does not export a down() function.`);
    }

    await entry.migration.down(db);
    await db.run('DELETE FROM schema_migrations WHERE name = ?', [name]);
    log.info('MIGRATION', `Rolled back: ${entry.canonicalName}`);
    return { rolledBack: entry.canonicalName };
  } finally {
    await releaseLock();
  }
}

async function migrationStatus() {
  await db.initialize();
  await ensureTables();

  const applied = await getApplied();
  const files = loadMigrationFiles();

  return files.map((entry) => {
    const name = entry.canonicalName;
    const appliedName = getMigrationIdentity(entry, applied);
    const storedChecksum = applied.get(appliedName);
    const isApplied = !!appliedName;
    const modified = isApplied && storedChecksum !== '' && storedChecksum !== entry.checksum;
    return {
      name,
      file: entry.file,
      status: isApplied ? (modified ? 'applied (modified)' : 'applied') : 'pending',
    };
  });
}

module.exports = { runMigrations, rollbackMigration, migrationStatus };
