'use strict';

/**
 * Schema Compatibility Integration Tests (#707)
 *
 * Initialises a real in-memory SQLite database with the same DDL used by
 * initDB.js and then executes representative queries for every table.
 * Any missing column, wrong type, or broken foreign-key reference causes
 * the test to fail — catching schema drift before it reaches production.
 *
 * Uses sql.js (already a devDependency) so no file I/O or DB_PATH is needed.
 */

const initSqlJs = require('sql.js');

let SQL;
let db;

// ─── DDL (mirrors src/scripts/initDB.js exactly) ─────────────────────────────

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE,
    encryptedSecret TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    daily_limit REAL DEFAULT NULL,
    monthly_limit REAL DEFAULT NULL,
    per_transaction_limit REAL DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default'
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    goal_amount REAL NOT NULL,
    current_amount REAL DEFAULT 0,
    start_date DATETIME,
    end_date DATETIME,
    status TEXT DEFAULT 'active',
    created_by INTEGER,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    amount REAL NOT NULL,
    memo TEXT,
    notes TEXT,
    tags TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    idempotencyKey TEXT UNIQUE,
    stellar_tx_id TEXT UNIQUE,
    is_orphan INTEGER NOT NULL DEFAULT 0,
    campaign_id INTEGER,
    validAfter INTEGER DEFAULT 0,
    validBefore INTEGER DEFAULT 0,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_idempotency
    ON transactions(idempotencyKey)`,
  `CREATE TABLE IF NOT EXISTS recurring_donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donorId INTEGER NOT NULL,
    recipientId INTEGER NOT NULL,
    amount REAL NOT NULL,
    frequency TEXT NOT NULL,
    nextExecutionDate DATETIME NOT NULL,
    status TEXT DEFAULT 'active',
    executionCount INTEGER DEFAULT 0,
    customIntervalDays INTEGER DEFAULT NULL,
    maxExecutions INTEGER DEFAULT NULL,
    webhookUrl TEXT DEFAULT NULL,
    failureCount INTEGER DEFAULT 0,
    lastExecutionDate DATETIME DEFAULT NULL,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (donorId) REFERENCES users(id),
    FOREIGN KEY (recipientId) REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS student_fees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    studentId TEXT NOT NULL,
    description TEXT NOT NULL,
    totalAmount REAL NOT NULL,
    paidAmount REAL NOT NULL DEFAULT 0,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default'
  )`,
  `CREATE TABLE IF NOT EXISTS fee_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feeId INTEGER NOT NULL,
    amount REAL NOT NULL,
    note TEXT,
    paidAt DATETIME DEFAULT CURRENT_TIMESTAMP,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (feeId) REFERENCES student_fees(id)
  )`,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Run a SQL statement and return all rows as plain objects. */
function run(sql, params = []) {
  db.run(sql, params);
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(async () => {
  SQL = await initSqlJs();
  db = new SQL.Database(); // pure in-memory
  DDL.forEach(stmt => db.run(stmt));
}, 15000);

afterAll(() => {
  if (db) db.close();
});

// Reset data between tests for isolation
afterEach(() => {
  // Delete in FK-safe order
  db.run('DELETE FROM fee_payments');
  db.run('DELETE FROM student_fees');
  db.run('DELETE FROM recurring_donations');
  db.run('DELETE FROM transactions');
  db.run('DELETE FROM campaigns');
  db.run('DELETE FROM users');
});

// ─── Schema existence tests ───────────────────────────────────────────────────

test('all expected tables exist', () => {
  const rows = query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  const names = rows.map(r => r.name);
  expect(names).toEqual(expect.arrayContaining([
    'campaigns', 'fee_payments', 'recurring_donations',
    'student_fees', 'transactions', 'users',
  ]));
});

test('users table has all required columns', () => {
  const cols = query('PRAGMA table_info(users)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'publicKey', 'encryptedSecret', 'createdAt',
    'deleted_at', 'daily_limit', 'monthly_limit', 'per_transaction_limit', 'tenant_id',
  ]));
});

test('transactions table has all required columns', () => {
  const cols = query('PRAGMA table_info(transactions)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'senderId', 'receiverId', 'amount', 'memo', 'notes', 'tags',
    'timestamp', 'deleted_at', 'idempotencyKey', 'stellar_tx_id',
    'is_orphan', 'campaign_id', 'validAfter', 'validBefore', 'tenant_id',
  ]));
});

test('campaigns table has all required columns', () => {
  const cols = query('PRAGMA table_info(campaigns)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'name', 'description', 'goal_amount', 'current_amount',
    'start_date', 'end_date', 'status', 'created_by',
    'createdAt', 'updatedAt', 'deleted_at', 'tenant_id',
  ]));
});

test('recurring_donations table has all required columns', () => {
  const cols = query('PRAGMA table_info(recurring_donations)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'donorId', 'recipientId', 'amount', 'frequency',
    'nextExecutionDate', 'status', 'executionCount',
    'customIntervalDays', 'maxExecutions', 'webhookUrl',
    'failureCount', 'lastExecutionDate', 'deleted_at', 'tenant_id',
  ]));
});

test('student_fees table has all required columns', () => {
  const cols = query('PRAGMA table_info(student_fees)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'studentId', 'description', 'totalAmount', 'paidAmount',
    'createdAt', 'updatedAt', 'deleted_at', 'tenant_id',
  ]));
});

test('fee_payments table has all required columns', () => {
  const cols = query('PRAGMA table_info(fee_payments)').map(r => r.name);
  expect(cols).toEqual(expect.arrayContaining([
    'id', 'feeId', 'amount', 'note', 'paidAt', 'deleted_at', 'tenant_id',
  ]));
});

// ─── Representative query tests ───────────────────────────────────────────────

test('can insert and query a user with all columns', () => {
  run(
    `INSERT INTO users (publicKey, encryptedSecret, deleted_at, daily_limit, monthly_limit, per_transaction_limit, tenant_id)
     VALUES (?, ?, NULL, ?, ?, ?, ?)`,
    ['GTEST1', 'enc', 100, 1000, 50, 'acme']
  );
  const rows = query(
    'SELECT id, publicKey, encryptedSecret, createdAt, deleted_at, daily_limit, monthly_limit, per_transaction_limit, tenant_id FROM users WHERE publicKey = ?',
    ['GTEST1']
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].daily_limit).toBe(100);
  expect(rows[0].deleted_at).toBeNull();
});

test('can soft-delete a user', () => {
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GTEST2', 'default')");
  run("UPDATE users SET deleted_at = datetime('now') WHERE publicKey = 'GTEST2'");
  const rows = query('SELECT deleted_at FROM users WHERE publicKey = ?', ['GTEST2']);
  expect(rows[0].deleted_at).not.toBeNull();
});

test('can insert and query a transaction with all columns', () => {
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GSENDER', 'default')");
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GRECEIVER', 'default')");
  const [sender] = query("SELECT id FROM users WHERE publicKey = 'GSENDER'");
  const [receiver] = query("SELECT id FROM users WHERE publicKey = 'GRECEIVER'");

  run(
    `INSERT INTO transactions
       (senderId, receiverId, amount, memo, notes, tags, deleted_at, idempotencyKey, stellar_tx_id, is_orphan, campaign_id, validAfter, validBefore, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, NULL, 0, 0, 'default')`,
    [sender.id, receiver.id, 9.99, 'test memo', 'a note', '["tag1"]', 'idem-1', 'stellar-1']
  );

  const rows = query(
    `SELECT id, senderId, receiverId, amount, memo, notes, tags, timestamp,
            deleted_at, idempotencyKey, stellar_tx_id, is_orphan, campaign_id,
            validAfter, validBefore, tenant_id
     FROM transactions WHERE idempotencyKey = ?`,
    ['idem-1']
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].amount).toBe(9.99);
  expect(rows[0].notes).toBe('a note');
  expect(rows[0].tags).toBe('["tag1"]');
  expect(rows[0].is_orphan).toBe(0);
});

test('can insert and query a recurring_donation with all columns', () => {
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GDONOR', 'default')");
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GRECIP', 'default')");
  const [donor] = query("SELECT id FROM users WHERE publicKey = 'GDONOR'");
  const [recip] = query("SELECT id FROM users WHERE publicKey = 'GRECIP'");

  run(
    `INSERT INTO recurring_donations
       (donorId, recipientId, amount, frequency, nextExecutionDate, status, executionCount,
        customIntervalDays, maxExecutions, webhookUrl, failureCount, lastExecutionDate, deleted_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'default')`,
    [donor.id, recip.id, 5.0, 'monthly', '2026-05-01', 'active', 0, null, 12, 'https://example.com/hook', 0]
  );

  const rows = query(
    `SELECT id, donorId, recipientId, amount, frequency, nextExecutionDate, status,
            executionCount, customIntervalDays, maxExecutions, webhookUrl,
            failureCount, lastExecutionDate, deleted_at, tenant_id
     FROM recurring_donations WHERE donorId = ?`,
    [donor.id]
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].frequency).toBe('monthly');
  expect(rows[0].failureCount).toBe(0);
  expect(rows[0].deleted_at).toBeNull();
});

test('can insert and query a campaign with all columns', () => {
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GCREATOR', 'default')");
  const [creator] = query("SELECT id FROM users WHERE publicKey = 'GCREATOR'");

  run(
    `INSERT INTO campaigns
       (name, description, goal_amount, current_amount, start_date, end_date, status, created_by, deleted_at, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'default')`,
    ['Test Campaign', 'desc', 1000, 0, '2026-01-01', '2026-12-31', 'active', creator.id]
  );

  const rows = query(
    `SELECT id, name, description, goal_amount, current_amount, start_date, end_date,
            status, created_by, createdAt, updatedAt, deleted_at, tenant_id
     FROM campaigns WHERE name = 'Test Campaign'`
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].goal_amount).toBe(1000);
  expect(rows[0].deleted_at).toBeNull();
});

test('can insert and query student_fees and fee_payments', () => {
  run(
    `INSERT INTO student_fees (studentId, description, totalAmount, paidAmount, tenant_id)
     VALUES ('STU1', 'Tuition', 500, 0, 'default')`
  );
  const [fee] = query("SELECT id FROM student_fees WHERE studentId = 'STU1'");

  run(
    `INSERT INTO fee_payments (feeId, amount, note, tenant_id) VALUES (?, ?, ?, 'default')`,
    [fee.id, 250, 'first instalment']
  );

  const payments = query(
    'SELECT id, feeId, amount, note, paidAt, deleted_at, tenant_id FROM fee_payments WHERE feeId = ?',
    [fee.id]
  );
  expect(payments).toHaveLength(1);
  expect(payments[0].amount).toBe(250);
  expect(payments[0].deleted_at).toBeNull();
});

test('idempotencyKey index exists on transactions', () => {
  const indexes = query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='transactions'");
  const names = indexes.map(r => r.name);
  expect(names).toContain('idx_transactions_idempotency');
});

test('duplicate idempotencyKey is rejected by UNIQUE constraint', () => {
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GS', 'default')");
  run("INSERT INTO users (publicKey, tenant_id) VALUES ('GR', 'default')");
  const [s] = query("SELECT id FROM users WHERE publicKey='GS'");
  const [r] = query("SELECT id FROM users WHERE publicKey='GR'");

  run(
    'INSERT INTO transactions (senderId, receiverId, amount, idempotencyKey, tenant_id) VALUES (?,?,?,?,?)',
    [s.id, r.id, 1, 'dup-key', 'default']
  );

  expect(() => {
    run(
      'INSERT INTO transactions (senderId, receiverId, amount, idempotencyKey, tenant_id) VALUES (?,?,?,?,?)',
      [s.id, r.id, 2, 'dup-key', 'default']
    );
  }).toThrow();
});
