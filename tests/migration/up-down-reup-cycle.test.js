'use strict';

/**
 * Full up -> down -> up cycle test for every migration in src/migrations/.
 *
 * Runs all migrations up (in order) on a fresh in-memory database, rolls
 * every one of them back down (in reverse order), then re-applies up()
 * again. This proves each migration's down() actually reverses its up()
 * cleanly and that re-running up() afterwards does not error out.
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const MIGRATIONS_DIR = path.join(__dirname, '../../src/migrations');

function loadMigrations() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+.*\.js$/.test(f))
    .sort()
    .map((file) => ({ file, migration: require(path.join(MIGRATIONS_DIR, file)) }));
}

function createDbAdapter() {
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

  const exec = (sql) =>
    new Promise((resolve, reject) => sqlite.exec(sql, (err) => (err ? reject(err) : resolve())));

  return {
    run,
    query,
    all: query,
    get: (sql, params = []) =>
      new Promise((resolve, reject) =>
        sqlite.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
      ),
    exec,
    close: () => new Promise((resolve) => sqlite.close(resolve)),
  };
}

describe('migration up/down/re-up cycle', () => {
  const migrations = loadMigrations();

  test('every migration file exports up() and down()', () => {
    for (const { file, migration } of migrations) {
      expect(typeof migration.up).toBe('function');
      expect(typeof migration.down).toBe('function');
    }
  });

  test('all migrations can be applied, rolled back, and re-applied without error', async () => {
    const db = createDbAdapter();

    try {
      for (const { migration } of migrations) {
        await migration.up(db);
      }

      for (const { migration } of [...migrations].reverse()) {
        await migration.down(db);
      }

      for (const { migration } of migrations) {
        await migration.up(db);
      }
    } finally {
      await db.close();
    }
  }, 60000);

  test('rolling back an already-rolled-back migration is a no-op (idempotent down)', async () => {
    const db = createDbAdapter();

    try {
      for (const { migration } of migrations) {
        await migration.up(db);
      }
      for (const { migration } of [...migrations].reverse()) {
        await migration.down(db);
      }
      // Running down() a second time on an already-rolled-back schema
      // should not throw (DROP TABLE/INDEX IF EXISTS, guarded ALTERs, etc.)
      for (const { migration } of [...migrations].reverse()) {
        await migration.down(db);
      }
    } finally {
      await db.close();
    }
  }, 60000);
});
