/**
 * Tests: Configurable Data Retention Policies
 *
 * Covers RetentionService anonymization/deletion logic, env-var configuration,
 * and the admin HTTP endpoints.
 * No live Stellar network required.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-retention';

const { RetentionService, anonymize, cutoffDate } = require('../../src/services/RetentionService');
const Database = require('../../src/utils/database');

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

async function seedTransaction(memo, timestamp) {
  await Database.run(
    `INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp) VALUES (1, 2, 1.0, ?, ?)`,
    [memo, timestamp]
  );
}

async function seedUser(publicKey, createdAt) {
  // Use INSERT OR IGNORE to avoid UNIQUE conflicts
  await Database.run(
    `INSERT OR IGNORE INTO users (publicKey, createdAt) VALUES (?, ?)`,
    [publicKey, createdAt]
  );
}

async function seedAuditLog(timestamp) {
  try {
    await Database.run(
      `INSERT INTO audit_logs (timestamp, category, action, severity, result, integrityHash)
       VALUES (?, 'TEST', 'TEST_ACTION', 'LOW', 'SUCCESS', 'hash123')`,
      [timestamp]
    );
  } catch (_) {
    // audit_logs may not exist in test DB — skip silently
  }
}

async function ensureTestUsers() {
  // Ensure users 1 and 2 exist for FK constraints
  await Database.run(`INSERT OR IGNORE INTO users (id, publicKey) VALUES (1, 'GTEST1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')`);
  await Database.run(`INSERT OR IGNORE INTO users (id, publicKey) VALUES (2, 'GTEST2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')`);
}

async function clearTestData() {
  await Database.run(`DELETE FROM transactions WHERE memo LIKE 'retention-test%' OR memo LIKE 'anon:%'`);
  await Database.run(`DELETE FROM users WHERE publicKey LIKE 'GRETENTION%' OR publicKey LIKE 'anon:%'`);
  try { await Database.run(`DELETE FROM audit_logs WHERE category = 'TEST'`); } catch (_) {}
}

// ─── Unit tests: pure helpers ────────────────────────────────────────────────

describe('anonymize()', () => {
  test('returns anon: prefixed sha256 hex', () => {
    const result = anonymize('GABC123');
    expect(result).toMatch(/^anon:[0-9a-f]{64}$/);
  });

  test('is deterministic', () => {
    expect(anonymize('same')).toBe(anonymize('same'));
  });

  test('different inputs produce different hashes', () => {
    expect(anonymize('a')).not.toBe(anonymize('b'));
  });

  test('returns original value for falsy input', () => {
    expect(anonymize(null)).toBeNull();
    expect(anonymize('')).toBe('');
  });
});

describe('cutoffDate()', () => {
  test('returns ISO string in the past', () => {
    const result = cutoffDate(30);
    expect(new Date(result).getTime()).toBeLessThan(Date.now());
  });

  test('30-day cutoff is approximately 30 days ago', () => {
    const result = cutoffDate(30);
    const diff = Date.now() - new Date(result).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(diff - thirtyDaysMs)).toBeLessThan(5000);
  });
});

// ─── RetentionService unit tests ─────────────────────────────────────────────

describe('RetentionService – runTransactionRetention', () => {
  let svc;

  beforeAll(async () => {
    await Database.initialize();
    await ensureTestUsers();
  });

  beforeEach(async () => {
    await clearTestData();
    svc = new RetentionService();
  });

  afterEach(async () => {
    await clearTestData();
  });

  test('anonymizes memo of old transactions', async () => {
    await seedTransaction('retention-test-old', daysAgo(400));
    const count = await svc.runTransactionRetention(365);
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await Database.get(`SELECT memo FROM transactions WHERE memo LIKE 'anon:%' LIMIT 1`);
    expect(row).toBeDefined();
    expect(row.memo).toMatch(/^anon:/);
  });

  test('does not anonymize recent transactions', async () => {
    await seedTransaction('retention-test-recent', daysAgo(10));
    const count = await svc.runTransactionRetention(365);
    expect(count).toBe(0);
  });

  test('does not re-anonymize already anonymized memos', async () => {
    await seedTransaction('retention-test-old2', daysAgo(400));
    await svc.runTransactionRetention(365);
    const count2 = await svc.runTransactionRetention(365);
    expect(count2).toBe(0);
  });

  test('uses RETENTION_TRANSACTIONS_DAYS env var', async () => {
    process.env.RETENTION_TRANSACTIONS_DAYS = '5';
    await seedTransaction('retention-test-env', daysAgo(10));
    const count = await svc.runTransactionRetention();
    expect(count).toBeGreaterThanOrEqual(1);
    delete process.env.RETENTION_TRANSACTIONS_DAYS;
  });

  test('returns 0 when no expired transactions', async () => {
    const count = await svc.runTransactionRetention(365);
    expect(count).toBe(0);
  });
});

describe('RetentionService – runUserDataRetention', () => {
  let svc;

  beforeAll(async () => {
    await Database.initialize();
  });

  beforeEach(async () => {
    await clearTestData();
    svc = new RetentionService();
  });

  afterEach(async () => {
    await clearTestData();
  });

  test('anonymizes publicKey of old users', async () => {
    const pub = 'GRETENTION' + 'A'.repeat(46);
    await seedUser(pub, daysAgo(800));
    const count = await svc.runUserDataRetention(730);
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await Database.get(`SELECT publicKey FROM users WHERE publicKey LIKE 'anon:%' LIMIT 1`);
    expect(row).toBeDefined();
  });

  test('does not anonymize recent users', async () => {
    const pub = 'GRETENTION' + 'B'.repeat(46);
    await seedUser(pub, daysAgo(10));
    const count = await svc.runUserDataRetention(730);
    expect(count).toBe(0);
  });

  test('does not re-anonymize already anonymized users', async () => {
    const pub = 'GRETENTION' + 'C'.repeat(46);
    await seedUser(pub, daysAgo(800));
    await svc.runUserDataRetention(730);
    const count2 = await svc.runUserDataRetention(730);
    expect(count2).toBe(0);
  });

  test('uses RETENTION_USER_DATA_DAYS env var', async () => {
    process.env.RETENTION_USER_DATA_DAYS = '5';
    const pub = 'GRETENTION' + 'D'.repeat(46);
    await seedUser(pub, daysAgo(10));
    const count = await svc.runUserDataRetention();
    expect(count).toBeGreaterThanOrEqual(1);
    delete process.env.RETENTION_USER_DATA_DAYS;
  });
});

describe('RetentionService – runAuditLogRetention', () => {
  let svc;

  beforeAll(async () => { await Database.initialize(); });
  beforeEach(async () => { svc = new RetentionService(); });

  test('returns a number (0 or more)', async () => {
    const count = await svc.runAuditLogRetention(90);
    expect(typeof count).toBe('number');
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('uses RETENTION_AUDIT_LOGS_DAYS env var', async () => {
    process.env.RETENTION_AUDIT_LOGS_DAYS = '30';
    const count = await svc.runAuditLogRetention();
    expect(typeof count).toBe('number');
    delete process.env.RETENTION_AUDIT_LOGS_DAYS;
  });
});

describe('RetentionService – runAll', () => {
  let svc;

  beforeAll(async () => { await Database.initialize(); });
  beforeEach(() => { svc = new RetentionService(); });

  test('returns object with transactions, auditLogs, userData counts', async () => {
    const result = await svc.runAll();
    expect(typeof result.transactions).toBe('number');
    expect(typeof result.auditLogs).toBe('number');
    expect(typeof result.userData).toBe('number');
  });
});

describe('RetentionService – getStatus', () => {
  let svc;

  beforeAll(async () => { await Database.initialize(); });
  beforeEach(() => { svc = new RetentionService(); });

  test('returns config with all three retention periods', async () => {
    const status = await svc.getStatus();
    expect(status.config.transactionRetentionDays).toBeGreaterThan(0);
    expect(status.config.auditLogRetentionDays).toBeGreaterThan(0);
    expect(status.config.userDataRetentionDays).toBeGreaterThan(0);
  });

  test('returns stats with transactions, auditLogs, users', async () => {
    const status = await svc.getStatus();
    expect(status.stats.transactions).toBeDefined();
    expect(status.stats.auditLogs).toBeDefined();
    expect(status.stats.users).toBeDefined();
  });

  test('reflects env var overrides', async () => {
    process.env.RETENTION_TRANSACTIONS_DAYS = '42';
    const status = await svc.getStatus();
    expect(status.config.transactionRetentionDays).toBe(42);
    delete process.env.RETENTION_TRANSACTIONS_DAYS;
  });
});

// ─── HTTP endpoint tests ─────────────────────────────────────────────────────

const request = require('supertest');
const express = require('express');
const retentionRouter = require('../../src/routes/admin/retention');
const { attachUserRole } = require('../../src/middleware/rbac');

function createAdminApp() {
  const app = express();
  app.use(express.json());
  // Simulate admin role
  app.use((req, res, next) => { req.apiKey = { role: 'admin' }; next(); });
  app.use(attachUserRole());
  app.use('/admin/retention', retentionRouter);
  app.use((err, req, res, next) => {
    void next;
    res.status(err.statusCode || 500).json({ success: false, error: { message: err.message } });
  });
  return app;
}

describe('GET /admin/retention/status', () => {
  let app;
  beforeAll(async () => {
    await Database.initialize();
    app = createAdminApp();
  });

  test('200 – returns config and stats', async () => {
    const res = await request(app)
      .get('/admin/retention/status')
      .set('x-api-key', 'test-key-retention');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.config).toBeDefined();
    expect(res.body.data.stats).toBeDefined();
  });

  test('config includes all three retention periods', async () => {
    const res = await request(app)
      .get('/admin/retention/status')
      .set('x-api-key', 'test-key-retention');

    const { config } = res.body.data;
    expect(config.transactionRetentionDays).toBeGreaterThan(0);
    expect(config.auditLogRetentionDays).toBeGreaterThan(0);
    expect(config.userDataRetentionDays).toBeGreaterThan(0);
  });

  test('stats includes transactions, auditLogs, users', async () => {
    const res = await request(app)
      .get('/admin/retention/status')
      .set('x-api-key', 'test-key-retention');

    const { stats } = res.body.data;
    expect(stats.transactions).toBeDefined();
    expect(stats.auditLogs).toBeDefined();
    expect(stats.users).toBeDefined();
  });
});

describe('POST /admin/retention/run', () => {
  let app;
  beforeAll(async () => {
    await Database.initialize();
    app = createAdminApp();
  });

  test('200 – runs retention and returns counts', async () => {
    const res = await request(app)
      .post('/admin/retention/run')
      .set('x-api-key', 'test-key-retention');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.transactions).toBe('number');
    expect(typeof res.body.data.auditLogs).toBe('number');
    expect(typeof res.body.data.userData).toBe('number');
  });
});
