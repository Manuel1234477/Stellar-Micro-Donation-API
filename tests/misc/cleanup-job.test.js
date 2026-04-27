'use strict';

/**
 * Cleanup Job Tests (#710)
 *
 * Verifies the soft-delete cleanup logic in src/jobs/cleanupJob.js using a
 * real in-memory SQLite database (sql.js). No mocks for the database layer —
 * actual SQL behaviour is exercised so schema drift is caught immediately.
 *
 * AuditLogService is mocked because it depends on a separate table/service
 * that is out of scope for these unit-level job tests.
 */

const initSqlJs = require('sql.js');

// ─── In-memory DB setup ───────────────────────────────────────────────────────

let SQL;
let sqlDb; // sql.js in-memory database

// Minimal DDL — only the columns cleanupJob.js touches
const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default'
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    goal_amount REAL NOT NULL DEFAULT 0,
    tenant_id TEXT NOT NULL DEFAULT 'default'
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    amount REAL NOT NULL,
    deleted_at DATETIME DEFAULT NULL,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    FOREIGN KEY (senderId) REFERENCES users(id),
    FOREIGN KEY (receiverId) REFERENCES users(id)
  )`,
];

function dbRun(sql, params = []) {
  sqlDb.run(sql, params);
}

function dbQuery(sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ─── Wire cleanupJob to use the in-memory DB ──────────────────────────────────

// We replace Database.run with a thin wrapper over sql.js so cleanupJob.js
// exercises real SQL without touching the file-system database.
const Database = require('../../src/utils/database');
const AuditLogService = require('../../src/services/AuditLogService');

let auditLogSpy;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  // Fresh in-memory DB for every test
  sqlDb = new SQL.Database();
  DDL.forEach(stmt => sqlDb.run(stmt));

  // Redirect Database.run to the in-memory DB
  jest.spyOn(Database, 'run').mockImplementation((sql, params = []) => {
    sqlDb.run(sql, params || []);
    // Return shape cleanupJob expects (changes not used, so {} is fine)
    return Promise.resolve({ changes: 0 });
  });

  // Spy on AuditLogService.log — we just want to know it was called
  auditLogSpy = jest.spyOn(AuditLogService, 'log').mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (sqlDb) { sqlDb.close(); sqlDb = null; }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedUser(publicKey, deletedAt = null) {
  dbRun(
    "INSERT INTO users (publicKey, deleted_at, tenant_id) VALUES (?, ?, 'default')",
    [publicKey, deletedAt]
  );
  return dbQuery('SELECT id FROM users WHERE publicKey = ?', [publicKey])[0].id;
}

function seedTransaction(senderId, receiverId, deletedAt = null) {
  dbRun(
    'INSERT INTO transactions (senderId, receiverId, amount, deleted_at, tenant_id) VALUES (?, ?, 1.0, ?, ?)',
    [senderId, receiverId, deletedAt, 'default']
  );
}

function countUsers() {
  return dbQuery('SELECT COUNT(*) AS n FROM users')[0].n;
}

function countTransactions() {
  return dbQuery('SELECT COUNT(*) AS n FROM transactions')[0].n;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const { runCleanup } = require('../../src/jobs/cleanupJob');

test('deletes transactions with deleted_at older than 30 days', async () => {
  const s = seedUser('GSENDER');
  const r = seedUser('GRECEIVER');
  seedTransaction(s, r, '2020-01-01'); // well past 30 days

  await runCleanup();

  expect(countTransactions()).toBe(0);
});

test('does NOT delete transactions with deleted_at within 30 days', async () => {
  const s = seedUser('GSENDER2');
  const r = seedUser('GRECEIVER2');
  // yesterday — within retention window
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  seedTransaction(s, r, yesterday);

  await runCleanup();

  expect(countTransactions()).toBe(1);
});

test('does NOT delete transactions without deleted_at (active records)', async () => {
  const s = seedUser('GSENDER3');
  const r = seedUser('GRECEIVER3');
  seedTransaction(s, r, null); // no soft-delete

  await runCleanup();

  expect(countTransactions()).toBe(1);
});

test('deletes users with deleted_at older than 30 days', async () => {
  seedUser('GEXPIRED', '2020-01-01');

  await runCleanup();

  expect(countUsers()).toBe(0);
});

test('does NOT delete users with deleted_at within 30 days', async () => {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  seedUser('GRECENT', yesterday);

  await runCleanup();

  expect(countUsers()).toBe(1);
});

test('does NOT delete users without deleted_at (active records)', async () => {
  seedUser('GACTIVE', null);

  await runCleanup();

  expect(countUsers()).toBe(1);
});

test('creates an audit log entry after each cleanup run', async () => {
  await runCleanup();

  expect(auditLogSpy).toHaveBeenCalledTimes(1);
  expect(auditLogSpy).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'SOFT_DELETE_CLEANUP' })
  );
});

test('handles database errors gracefully without throwing', async () => {
  Database.run.mockRejectedValueOnce(new Error('DB_FAIL'));

  await expect(runCleanup()).resolves.not.toThrow();
});
