'use strict';

const sqlite3 = require('sqlite3').verbose();
const migration = require('../../scripts/legacy/migrations/001_add_idempotency_constraint');

function createDb() {
  const sqlite = new sqlite3.Database(':memory:');

  const run = (sql, params = []) =>
    new Promise((resolve, reject) =>
      sqlite.run(sql, params, function (err) {
        if (err) return reject(err);
        resolve({ lastID: this.lastID, changes: this.changes });
      })
    );

  const all = (sql, params = []) =>
    new Promise((resolve, reject) =>
      sqlite.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
    );

  return { run, all, _sqlite: sqlite };
}

async function createLegacyTransactionsSchema(db) {
  await db.run(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER NOT NULL,
      receiverId INTEGER NOT NULL,
      amount REAL NOT NULL,
      memo TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      tags TEXT,
      deleted_at DATETIME DEFAULT NULL,
      stellar_tx_id TEXT UNIQUE,
      is_orphan INTEGER NOT NULL DEFAULT 0,
      campaign_id INTEGER,
      validAfter INTEGER DEFAULT 0,
      validBefore INTEGER DEFAULT 0,
      tenant_id TEXT NOT NULL DEFAULT 'default'
    )
  `);

  await db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    )
  `);

  await db.run(`
    INSERT INTO users (id, name) VALUES (1, 'alice')
  `);
  await db.run(`
    INSERT INTO users (id, name) VALUES (2, 'bob')
  `);

  await db.run(`
    INSERT INTO transactions (
      id, senderId, receiverId, amount, memo, timestamp, notes, tags,
      deleted_at, stellar_tx_id, is_orphan, campaign_id, validAfter,
      validBefore, tenant_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    1, 1, 2, 100.5, 'hello', '2024-01-01T00:00:00Z', 'note', 'tag',
    '2024-01-02T00:00:00Z', 'tx-1', 0, 7, 10, 20, 'tenant-a'
  ]);
}

describe('idempotency migration transaction safety', () => {
  let db;

  beforeEach(async () => {
    db = createDb();
    await createLegacyTransactionsSchema(db);
  });

  afterEach((done) => {
    db._sqlite.close(done);
  });

  test('rolls back cleanly when a later statement fails', async () => {
    const originalRun = db.run.bind(db);
    let callCount = 0;

    db.run = (sql, params = [], callback) => {
      callCount += 1;
      if (callCount === 5) {
        return originalRun('SELECT 1 FROM does_not_exist', [], callback);
      }
      return originalRun(sql, params, callback);
    };

    await expect(migration.runMigration()).rejects.toThrow();

    const tables = await db.all(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('transactions', 'transactions_new')",
      []
    );
    const tableNames = tables.map((row) => row.name).sort();
    expect(tableNames).toEqual(['transactions']);

    const rowCount = await db.all('SELECT COUNT(*) AS count FROM transactions', []);
    expect(rowCount[0].count).toBe(1);
  });
});
