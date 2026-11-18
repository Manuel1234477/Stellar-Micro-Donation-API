'use strict';

const sqlite3 = require('sqlite3').verbose();
const migration = require('../../src/migrations/031_api_key_rate_limit');

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

async function createApiKeysSchema(db) {
  await db.run(`
    CREATE TABLE api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT,
      metadata TEXT,
      expires_at INTEGER,
      last_used_at INTEGER,
      deprecated_at INTEGER,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      grace_period_days INTEGER NOT NULL DEFAULT 30,
      rotated_to_id INTEGER,
      signing_required INTEGER NOT NULL DEFAULT 0,
      key_secret TEXT,
      allowed_ips TEXT,
      monthly_quota INTEGER,
      quota_used INTEGER NOT NULL DEFAULT 0,
      quota_reset_at INTEGER,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      notification_email TEXT,
      last_expiry_notification_sent_at INTEGER
    )
  `);

  await db.run(`
    CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash)
  `);
  await db.run(`
    CREATE INDEX idx_api_keys_status ON api_keys(status)
  `);

  await db.run(`
    INSERT INTO api_keys (
      id, key_hash, key_prefix, name, role, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [1, 'hash-1', 'h1', 'Primary', 'admin', 'active', 100]);
}

describe('migration 018_api_key_rate_limit', () => {
  let db;

  beforeEach(async () => {
    db = createDb();
    await createApiKeysSchema(db);
  });

  afterEach((done) => {
    db._sqlite.close(done);
  });

  test('down() preserves the primary key, unique constraint, and indexes', async () => {
    await migration.down(db);

    const tableInfo = await db.query('PRAGMA table_info(api_keys)', []);
    const idColumn = tableInfo.find((column) => column.name === 'id');
    expect(idColumn.pk).toBe(1);
    expect(idColumn.notnull).toBe(0);

    const keyHashColumn = tableInfo.find((column) => column.name === 'key_hash');
    expect(keyHashColumn.notnull).toBe(1);

    const indexes = await db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_keys' AND name IN ('idx_api_keys_key_hash', 'idx_api_keys_status')", []);
    const indexNames = indexes.map((row) => row.name);
    expect(indexNames).toEqual(expect.arrayContaining(['idx_api_keys_key_hash', 'idx_api_keys_status']));

    const rowCount = await db.query('SELECT COUNT(*) AS count FROM api_keys', []);
    expect(rowCount[0].count).toBe(1);
  });
});
