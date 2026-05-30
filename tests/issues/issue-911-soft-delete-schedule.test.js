'use strict';
/**
 * Tests for #911 — DELETE /stream/schedules/:id soft-delete (no hard-delete)
 *
 * Verifies:
 *  - DELETE sets status='cancelled' and cancelledAt (no row deletion)
 *  - Cancelled schedule is excluded from GET /stream/schedules default list
 *  - GET /stream/schedules?status=cancelled returns cancelled schedules
 *  - GET /stream/schedules/:id/history still works for cancelled schedules
 *  - Audit log entry is created with action='SCHEDULE_CANCELLED'
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-911-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const AuditLogService = require('../../src/services/AuditLogService');
const streamRouter = require('../../src/routes/stream');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');
const { issueAccessToken } = require('../../src/services/JwtService');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(requireApiKey);
  app.use(attachUserRole());
  app.use('/stream', streamRouter);
  app.use((err, req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: err.message });
  });
  return app;
}

const DONOR = 'G911SOFTDEL_DONOR000000000000000000000000000000000000001';
const RECIPIENT = 'G911SOFTDEL_RECIP000000000000000000000000000000000000002';

async function ensureUser(publicKey) {
  let user = await Database.get('SELECT id FROM users WHERE publicKey = ?', [publicKey]);
  if (!user) {
    const r = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
    user = { id: r.id };
  }
  return user;
}

async function createSchedule() {
  const donor = await ensureUser(DONOR);
  const recipient = await ensureUser(RECIPIENT);
  const nextDate = new Date(Date.now() + 86400000).toISOString();
  const result = await Database.run(
    `INSERT INTO recurring_donations (donorId, recipientId, amount, frequency, nextExecutionDate, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [donor.id, recipient.id, 5, 'weekly', nextDate]
  );
  return result.id;
}

let app;

beforeAll(async () => {
  await Database.initialize();

  // Ensure cancelledAt column exists (migration may not have run in test DB)
  const cols = await Database.all('PRAGMA table_info(recurring_donations)');
  const colNames = cols.map(c => c.name);
  if (!colNames.includes('cancelledAt')) {
    await Database.run('ALTER TABLE recurring_donations ADD COLUMN cancelledAt DATETIME DEFAULT NULL');
  }

  // Ensure recurring_donation_executions table exists for the history endpoint
  await Database.run(`
    CREATE TABLE IF NOT EXISTS recurring_donation_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scheduleId INTEGER NOT NULL,
      executedAt TEXT NOT NULL,
      status TEXT NOT NULL,
      transactionHash TEXT,
      errorMessage TEXT
    )
  `);

  app = createApp();
});

afterAll(async () => {
  await Database.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('#911 — DELETE /stream/schedules/:id soft-delete', () => {
  test('cancelling a schedule sets status=cancelled and cancelledAt — row is not deleted', async () => {
    const scheduleId = await createSchedule();
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    const res = await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cancellationStatus).toBe('immediate');

    // Row must still exist in DB
    const row = await Database.get(
      'SELECT status, cancelledAt FROM recurring_donations WHERE id = ?',
      [scheduleId]
    );
    expect(row).toBeDefined();
    expect(row.status).toBe('cancelled');
    expect(row.cancelledAt).toBeTruthy();
  });

  test('cancelled schedule does NOT appear in the default GET /stream/schedules list', async () => {
    const scheduleId = await createSchedule();
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    // Cancel it
    await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    // List without status filter — should exclude cancelled
    const listRes = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const ids = (listRes.body.data || []).map(s => s.id);
    expect(ids).not.toContain(scheduleId);
  });

  test('GET /stream/schedules?status=cancelled returns cancelled schedule', async () => {
    const scheduleId = await createSchedule();
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    // Cancel it
    await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    // List with explicit cancelled filter
    const listRes = await request(app)
      .get('/stream/schedules?status=cancelled')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    const ids = (listRes.body.data || []).map(s => s.id);
    expect(ids).toContain(scheduleId);
  });

  test('GET /stream/schedules/:id/history works for a cancelled schedule', async () => {
    const scheduleId = await createSchedule();
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    // Cancel it
    await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    // History should still be accessible
    const histRes = await request(app)
      .get(`/stream/schedules/${scheduleId}/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(histRes.status).toBe(200);
    expect(histRes.body.success).toBe(true);
    expect(Array.isArray(histRes.body.data)).toBe(true);
  });

  test('AuditLogService.log is called with SCHEDULE_CANCELLED action on cancellation', async () => {
    const scheduleId = await createSchedule();
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    // Spy on AuditLogService.log to verify it is invoked with the correct action
    const logSpy = jest.spyOn(AuditLogService, 'log').mockResolvedValue({ success: true });

    await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    // Give the async fire-and-forget call a tick to execute
    await new Promise(r => setImmediate(r));

    expect(logSpy).toHaveBeenCalled();
    // Find the specific SCHEDULE_CANCELLED call (RBAC may also log PERMISSION_GRANTED)
    const cancelCall = logSpy.mock.calls.find(([args]) => args.action === 'SCHEDULE_CANCELLED');
    expect(cancelCall).toBeDefined();
    const callArgs = cancelCall[0];
    expect(callArgs.action).toBe('SCHEDULE_CANCELLED');
    expect(callArgs.details.scheduleId).toBe(String(scheduleId));

    logSpy.mockRestore();
  });
});
