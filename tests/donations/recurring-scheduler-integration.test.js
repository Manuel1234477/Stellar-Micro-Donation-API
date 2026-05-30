/**
 * Integration Test: RecurringDonationScheduler — Issue #709
 *
 * Runs the scheduler against a real in-process SQLite database (no mocks for DB).
 * Verifies end-to-end: schedule inserted → processSchedules() → DB state updated.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// ── Silence logs ──────────────────────────────────────────────────────────
jest.mock('../../src/utils/log', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../src/utils/correlation', () => ({
  withBackgroundContext: (_t, fn) => fn(),
  withAsyncContext: (_t, fn) => fn(),
  getCorrelationSummary: () => ({ correlationId: 'c', traceId: 't' }),
}));

jest.mock('../../src/utils/tracing', () => ({
  withSpanInContext: (_n, _c, _a, fn) => fn(),
  extractTraceContext: () => ({}),
  injectTraceHeaders: h => h,
  getCurrentTraceparent: () => null,
}));

jest.mock('../../src/services/WebhookService', () => ({
  sendFailureNotification: jest.fn().mockResolvedValue({ delivered: true }),
}));

jest.mock('../../src/services/ApiKeyExpirationNotifier', () => ({
  run: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/models/apiKeys', () => ({
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../src/services/RetentionService', () => ({
  runAll: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/BackupService', () =>
  jest.fn().mockImplementation(() => ({
    backup: jest.fn().mockResolvedValue({ backupId: 'bk-1' }),
  }))
);

jest.mock('../../src/graphql/pubsub', () => ({
  publish: jest.fn(),
  TOPICS: { RECURRING_DONATION_EXECUTED: 'RECURRING_DONATION_EXECUTED' },
}));

// ── SQLite helpers ────────────────────────────────────────────────────────

function openDb(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, err => err ? reject(err) : resolve(db));
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close(err => err ? reject(err) : resolve());
  });
}

// ── Schema setup ──────────────────────────────────────────────────────────

async function setupSchema(db) {
  await run(db, `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publicKey TEXT NOT NULL UNIQUE,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    senderId INTEGER NOT NULL,
    receiverId INTEGER NOT NULL,
    amount REAL NOT NULL,
    memo TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS recurring_donations (
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
    lastFailureReason TEXT DEFAULT NULL,
    lastExecutionDate DATETIME DEFAULT NULL
  )`);

  await run(db, `CREATE TABLE IF NOT EXISTS idempotency_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE
  )`);
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe('RecurringDonationScheduler — integration (real SQLite)', () => {
  let db;
  let dbPath;
  let scheduler;
  let donorId;
  let recipientId;

  beforeAll(async () => {
    // Create a temp DB file for this test run
    dbPath = path.join(os.tmpdir(), `scheduler-test-${Date.now()}.db`);
    process.env.DB_PATH = dbPath;

    db = await openDb(dbPath);
    await setupSchema(db);

    // Insert donor and recipient users
    const d = await run(db, `INSERT INTO users (publicKey) VALUES (?)`, ['GDONOR_INTEG']);
    donorId = d.lastID;
    const r = await run(db, `INSERT INTO users (publicKey) VALUES (?)`, ['GRECIPIENT_INTEG']);
    recipientId = r.lastID;
  });

  afterAll(async () => {
    await closeDb(db);
    try { fs.unlinkSync(dbPath); } catch (_) {}
    delete process.env.DB_PATH;
  });

  beforeEach(async () => {
    // Clean schedules and transactions between tests
    await run(db, `DELETE FROM recurring_donations`);
    await run(db, `DELETE FROM transactions`);
    jest.clearAllMocks();

    // Re-require Database after env var is set so it picks up the temp path
    jest.resetModules();

    // Re-apply mocks that get cleared by resetModules
    jest.mock('../../src/utils/log', () => ({
      info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(),
    }));
    jest.mock('../../src/utils/correlation', () => ({
      withBackgroundContext: (_t, fn) => fn(),
      withAsyncContext: (_t, fn) => fn(),
      getCorrelationSummary: () => ({ correlationId: 'c', traceId: 't' }),
    }));
    jest.mock('../../src/utils/tracing', () => ({
      withSpanInContext: (_n, _c, _a, fn) => fn(),
      extractTraceContext: () => ({}),
      injectTraceHeaders: h => h,
      getCurrentTraceparent: () => null,
    }));
    jest.mock('../../src/services/WebhookService', () => ({
      sendFailureNotification: jest.fn().mockResolvedValue({ delivered: true }),
    }));
    jest.mock('../../src/services/ApiKeyExpirationNotifier', () => ({
      run: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../../src/models/apiKeys', () => ({
      revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
    }));
    jest.mock('../../src/services/RetentionService', () => ({
      runAll: jest.fn().mockResolvedValue({}),
    }));
    jest.mock('../../src/services/BackupService', () =>
      jest.fn().mockImplementation(() => ({
        backup: jest.fn().mockResolvedValue({ backupId: 'bk-1' }),
      }))
    );
    jest.mock('../../src/graphql/pubsub', () => ({
      publish: jest.fn(),
      TOPICS: { RECURRING_DONATION_EXECUTED: 'RECURRING_DONATION_EXECUTED' },
    }));

    const RecurringDonationSchedulerModule = require('../../src/services/RecurringDonationScheduler');
    const RecurringDonationScheduler = RecurringDonationSchedulerModule.Class || RecurringDonationSchedulerModule;

    scheduler = new RecurringDonationScheduler({
      sendPayment: jest.fn().mockResolvedValue({ hash: 'integ-tx-hash' }),
    });
    scheduler.isRunning = true;
  });

  afterEach(() => {
    if (scheduler && scheduler.isRunning) scheduler.stop();
  });

  // ── Test 1: due schedule is executed ─────────────────────────────────────

  it('executes a due active schedule and updates executionCount + nextExecutionDate', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString(); // 1 min ago
    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '2.50', 'daily', pastDate, 'active']
    );

    await scheduler.processSchedules();

    const updated = await get(db, `SELECT * FROM recurring_donations WHERE id = ?`, [scheduleId]);
    expect(updated.executionCount).toBe(1);
    expect(updated.failureCount).toBe(0);
    expect(new Date(updated.nextExecutionDate) > new Date(pastDate)).toBe(true);
  });

  // ── Test 2: future schedule is NOT executed ───────────────────────────────

  it('does not execute a schedule whose nextExecutionDate is in the future', async () => {
    const futureDate = new Date(Date.now() + 60_000).toISOString(); // 1 min from now
    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', 'daily', futureDate, 'active']
    );

    await scheduler.processSchedules();

    const unchanged = await get(db, `SELECT * FROM recurring_donations WHERE id = ?`, [scheduleId]);
    expect(unchanged.executionCount).toBe(0);
  });

  // ── Test 3: non-active schedule is NOT executed ───────────────────────────

  it('does not execute a paused schedule', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', 'daily', pastDate, 'paused']
    );

    await scheduler.processSchedules();

    const unchanged = await get(db, `SELECT * FROM recurring_donations WHERE id = ?`, [scheduleId]);
    expect(unchanged.executionCount).toBe(0);
  });

  // ── Test 4: failureCount incremented on Stellar failure ───────────────────

  it('increments failureCount when Stellar payment fails on all retries', async () => {
    scheduler.stellarService.sendPayment = jest.fn().mockRejectedValue(new Error('Stellar down'));
    scheduler.sleep = jest.fn().mockResolvedValue(); // skip backoff delays

    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status, failureCount)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', 'daily', pastDate, 'active', 0]
    );

    await scheduler.processSchedules();

    const updated = await get(db, `SELECT * FROM recurring_donations WHERE id = ?`, [scheduleId]);
    expect(updated.failureCount).toBe(1);
    expect(updated.lastFailureReason).toBe('Stellar down');
  });

  // ── Test 5: maxExecutions cap — schedule completed ────────────────────────

  it('marks schedule as completed when maxExecutions is reached', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status, executionCount, maxExecutions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', 'daily', pastDate, 'active', 4, 5]
    );

    await scheduler.processSchedules();

    const updated = await get(db, `SELECT * FROM recurring_donations WHERE id = ?`, [scheduleId]);
    expect(updated.executionCount).toBe(5);
    expect(updated.status).toBe('completed');
  });

  // ── Test 6: idempotency — duplicate execution prevented ───────────────────

  it('does not send a second Stellar payment when idempotency key already exists', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    const executionDate = pastDate.split('T')[0];
    const idempotencyKey = `recurring-1-${executionDate}`;

    const { lastID: scheduleId } = await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', 'daily', pastDate, 'active']
    );

    // Pre-insert the idempotency record
    await run(db,
      `INSERT INTO transactions (senderId, receiverId, amount, memo) VALUES (?, ?, ?, ?)`,
      [donorId, recipientId, '1.00', `recurring-${scheduleId}-${executionDate}`]
    );

    await scheduler.processSchedules();

    // sendPayment should NOT have been called
    expect(scheduler.stellarService.sendPayment).not.toHaveBeenCalled();
  });

  // ── Test 7: transaction record inserted on success ────────────────────────

  it('inserts a transaction record after successful payment', async () => {
    const pastDate = new Date(Date.now() - 60_000).toISOString();
    await run(db,
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donorId, recipientId, '3.00', 'weekly', pastDate, 'active']
    );

    await scheduler.processSchedules();

    const txns = await all(db, `SELECT * FROM transactions WHERE senderId = ?`, [donorId]);
    expect(txns.length).toBe(1);
    expect(txns[0].amount).toBe(3.0);
  });
});
