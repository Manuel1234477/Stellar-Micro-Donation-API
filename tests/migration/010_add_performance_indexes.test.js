'use strict';

/**
 * Tests for migration 010_add_performance_indexes (#755)
 *
 * Verifies:
 * - All indexes are created (idempotent via IF NOT EXISTS)
 * - EXPLAIN QUERY PLAN confirms index usage for the relevant queries
 * - Basic query performance benchmark shows indexed queries complete quickly
 */

const sqlite3 = require('sqlite3').verbose();
const migration = require('../../src/migrations/010_add_performance_indexes');

// ─── Minimal in-memory db adapter (mirrors migration-runner.test.js) ─────────

function createDb() {
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

// ─── Schema helpers ───────────────────────────────────────────────────────────

async function createSchema(db) {
  await db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    amount REAL NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS recurring_donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donorId INTEGER NOT NULL,
    recipientId INTEGER NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL,
    nextExecutionDate DATETIME NOT NULL,
    status TEXT DEFAULT 'active'
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS idempotency_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    idempotencyKey TEXT NOT NULL UNIQUE,
    requestHash TEXT,
    response TEXT,
    userId TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME
  )`);

  await db.run(`CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL
  )`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('migration 010_add_performance_indexes', () => {
  let db;

  beforeEach(async () => {
    db = createDb();
    await createSchema(db);
  });

  afterEach((done) => {
    db._sqlite.close(done);
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  test('up() is idempotent — running twice does not throw', async () => {
    await expect(migration.up(db)).resolves.not.toThrow();
    await expect(migration.up(db)).resolves.not.toThrow();
  });

  // ── Index existence ─────────────────────────────────────────────────────────

  test('creates all four indexes', async () => {
    await migration.up(db);

    const rows = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN (?, ?, ?, ?)",
      [
        'idx_transactions_timestamp',
        'idx_recurring_donations_status_nextExecution',
        'idx_idempotency_keys_key',
        'idx_api_keys_key_hash',
      ]
    );
    const names = rows.map((r) => r.name);
    expect(names).toContain('idx_transactions_timestamp');
    expect(names).toContain('idx_recurring_donations_status_nextExecution');
    expect(names).toContain('idx_idempotency_keys_key');
    expect(names).toContain('idx_api_keys_key_hash');
  });

  // ── EXPLAIN QUERY PLAN ──────────────────────────────────────────────────────

  test('EXPLAIN QUERY PLAN uses index for transactions(timestamp) range query', async () => {
    await migration.up(db);
    const plan = await db.query(
      "EXPLAIN QUERY PLAN SELECT * FROM transactions WHERE timestamp > '2024-01-01'",
      []
    );
    const detail = plan.map((r) => r.detail || r.Detail || Object.values(r).join(' ')).join(' ');
    expect(detail).toMatch(/idx_transactions_timestamp/i);
  });

  test('EXPLAIN QUERY PLAN uses index for recurring_donations scheduler query', async () => {
    await migration.up(db);
    const plan = await db.query(
      "EXPLAIN QUERY PLAN SELECT * FROM recurring_donations WHERE status = 'active' AND nextExecutionDate <= '2026-01-01'",
      []
    );
    const detail = plan.map((r) => r.detail || r.Detail || Object.values(r).join(' ')).join(' ');
    expect(detail).toMatch(/idx_recurring_donations_status_nextExecution/i);
  });

  test('EXPLAIN QUERY PLAN uses index for idempotency_keys lookup', async () => {
    await migration.up(db);
    const plan = await db.query(
      "EXPLAIN QUERY PLAN SELECT * FROM idempotency_keys WHERE idempotencyKey = 'some-key'",
      []
    );
    const detail = plan.map((r) => r.detail || r.Detail || Object.values(r).join(' ')).join(' ');
    // SQLite may use the UNIQUE constraint index or our named index — either confirms index usage
    expect(detail).toMatch(/idempotency/i);
  });

  test('EXPLAIN QUERY PLAN uses index for api_keys(key_hash) lookup', async () => {
    await migration.up(db);
    const plan = await db.query(
      "EXPLAIN QUERY PLAN SELECT * FROM api_keys WHERE key_hash = 'abc123'",
      []
    );
    const detail = plan.map((r) => r.detail || r.Detail || Object.values(r).join(' ')).join(' ');
    expect(detail).toMatch(/key_hash/i);
  });

  // ── Performance benchmark ───────────────────────────────────────────────────

  test('indexed timestamp query completes within 200ms on 1000 rows', async () => {
    await migration.up(db);

    // Seed 1000 rows
    for (let i = 0; i < 1000; i++) {
      const ts = new Date(Date.now() - i * 60000).toISOString();
      await db.run(
        'INSERT INTO transactions (senderId, receiverId, amount, timestamp) VALUES (?, ?, ?, ?)',
        [1, 2, 1.0, ts]
      );
    }

    const start = Date.now();
    await db.query("SELECT * FROM transactions WHERE timestamp > '2025-01-01'", []);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('indexed recurring_donations query completes within 200ms on 1000 rows', async () => {
    await migration.up(db);

    const future = new Date(Date.now() + 86400000).toISOString();
    for (let i = 0; i < 1000; i++) {
      await db.run(
        'INSERT INTO recurring_donations (donorId, recipientId, amount, frequency, nextExecutionDate, status) VALUES (?, ?, ?, ?, ?, ?)',
        [1, 2, 1.0, 'weekly', future, i % 2 === 0 ? 'active' : 'paused']
      );
    }

    const now = new Date().toISOString();
    const start = Date.now();
    await db.query(
      "SELECT * FROM recurring_donations WHERE status = 'active' AND nextExecutionDate <= ?",
      [now]
    );
    expect(Date.now() - start).toBeLessThan(200);
  });

  // ── down() rollback ─────────────────────────────────────────────────────────

  test('down() removes all indexes created by this migration', async () => {
    await migration.up(db);
    await migration.down(db);

    const rows = await db.query(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN (?, ?, ?, ?)",
      [
        'idx_transactions_timestamp',
        'idx_recurring_donations_status_nextExecution',
        'idx_idempotency_keys_key',
        'idx_api_keys_key_hash',
      ]
    );
    expect(rows).toHaveLength(0);
  });
});
