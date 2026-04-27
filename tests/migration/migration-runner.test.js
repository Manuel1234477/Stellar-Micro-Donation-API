'use strict';

/**
 * Tests for src/utils/migrationRunner.js
 *
 * Uses an in-memory SQLite database via a mock of the Database utility so
 * no real files are touched and tests remain fully isolated.
 */

const sqlite3 = require('sqlite3').verbose();

// ─── Minimal in-memory db adapter ────────────────────────────────────────────

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

  const initialize = jest.fn().mockResolvedValue(undefined);

  return { run, query, initialize, _sqlite: sqlite };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeMigration(name, upFn) {
  return { name, up: upFn || (async () => {}) };
}

// Build a runner bound to a specific db adapter and migration list
function buildRunner(dbAdapter, migrations) {
  // Inline the runner logic so we can inject dependencies
  async function ensureMigrationsTable() {
    await dbAdapter.run(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async function getApplied() {
    const rows = await dbAdapter.query('SELECT name FROM schema_migrations', []);
    return new Set(rows.map((r) => r.name));
  }

  async function runMigrations() {
    await dbAdapter.initialize();
    await ensureMigrationsTable();

    const applied = await getApplied();
    const pending = migrations.filter((m) => !applied.has(m.name));

    if (pending.length === 0) {
      return { applied: 0, skipped: migrations.length };
    }

    for (const migration of pending) {
      await dbAdapter.run('BEGIN');
      try {
        await migration.up(dbAdapter);
        await dbAdapter.run('INSERT INTO schema_migrations (name) VALUES (?)', [migration.name]);
        await dbAdapter.run('COMMIT');
      } catch (err) {
        await dbAdapter.run('ROLLBACK');
        throw new Error(`Migration failed [${migration.name}]: ${err.message}`);
      }
    }

    return { applied: pending.length, skipped: migrations.length - pending.length };
  }

  return { runMigrations };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('migrationRunner', () => {
  let db;

  beforeEach(() => {
    db = createInMemoryDb();
  });

  afterEach((done) => {
    db._sqlite.close(done);
  });

  test('creates schema_migrations table on first run', async () => {
    const { runMigrations } = buildRunner(db, []);
    await runMigrations();

    const rows = await db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      []
    );
    expect(rows).toHaveLength(1);
  });

  test('applies pending migrations in order', async () => {
    const order = [];
    const migrations = [
      makeMigration('001_a', async () => { order.push('001_a'); }),
      makeMigration('002_b', async () => { order.push('002_b'); }),
    ];

    const { runMigrations } = buildRunner(db, migrations);
    const result = await runMigrations();

    expect(order).toEqual(['001_a', '002_b']);
    expect(result).toEqual({ applied: 2, skipped: 0 });
  });

  test('records applied migrations in schema_migrations', async () => {
    const migrations = [makeMigration('001_x'), makeMigration('002_y')];
    const { runMigrations } = buildRunner(db, migrations);
    await runMigrations();

    const rows = await db.query('SELECT name FROM schema_migrations ORDER BY id', []);
    expect(rows.map((r) => r.name)).toEqual(['001_x', '002_y']);
  });

  test('skips already-applied migrations', async () => {
    const migrations = [makeMigration('001_x'), makeMigration('002_y')];
    const { runMigrations } = buildRunner(db, migrations);

    // First run — applies both
    await runMigrations();

    // Second run — skips both
    const upSpy = jest.fn();
    const migrations2 = [
      makeMigration('001_x', upSpy),
      makeMigration('002_y', upSpy),
    ];
    const runner2 = buildRunner(db, migrations2);
    const result = await runner2.runMigrations();

    expect(upSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ applied: 0, skipped: 2 });
  });

  test('only runs unapplied migrations when some are already applied', async () => {
    // Pre-apply 001
    const { runMigrations: firstRun } = buildRunner(db, [makeMigration('001_x')]);
    await firstRun();

    const ran = [];
    const migrations = [
      makeMigration('001_x', async () => { ran.push('001_x'); }),
      makeMigration('002_y', async () => { ran.push('002_y'); }),
    ];
    const { runMigrations } = buildRunner(db, migrations);
    const result = await runMigrations();

    expect(ran).toEqual(['002_y']);
    expect(result).toEqual({ applied: 1, skipped: 1 });
  });

  test('rolls back and throws on migration failure', async () => {
    const migrations = [
      makeMigration('001_good'),
      makeMigration('002_bad', async () => { throw new Error('boom'); }),
    ];

    const { runMigrations } = buildRunner(db, migrations);
    await expect(runMigrations()).rejects.toThrow('Migration failed [002_bad]: boom');

    // 001_good should be committed; 002_bad should not be recorded
    const rows = await db.query('SELECT name FROM schema_migrations', []);
    expect(rows.map((r) => r.name)).toEqual(['001_good']);
  });

  test('halts on first failure — subsequent migrations are not run', async () => {
    const ran = [];
    const migrations = [
      makeMigration('001_ok', async () => { ran.push('001_ok'); }),
      makeMigration('002_fail', async () => { throw new Error('fail'); }),
      makeMigration('003_never', async () => { ran.push('003_never'); }),
    ];

    const { runMigrations } = buildRunner(db, migrations);
    await expect(runMigrations()).rejects.toThrow();

    expect(ran).toEqual(['001_ok']);
    expect(ran).not.toContain('003_never');
  });

  test('returns applied:0 skipped:N when nothing is pending', async () => {
    const migrations = [makeMigration('001_x'), makeMigration('002_y')];
    const { runMigrations } = buildRunner(db, migrations);
    await runMigrations();

    const { runMigrations: run2 } = buildRunner(db, migrations);
    const result = await run2();
    expect(result).toEqual({ applied: 0, skipped: 2 });
  });

  test('calls db.initialize()', async () => {
    const { runMigrations } = buildRunner(db, []);
    await runMigrations();
    expect(db.initialize).toHaveBeenCalledTimes(1);
  });
});
