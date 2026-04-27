'use strict';

/**
 * Tests for recurring donation pause/resume functionality (#608)
 * Covers: pause, resume, scheduler skip, and status filtering
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-pause-resume-key';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const streamRouter = require('../../src/routes/stream');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');

function createTestApp() {
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

let app;

// Helper: create a schedule directly in DB
async function createSchedule(status = 'active') {
  let donor = await Database.get("SELECT id FROM users WHERE publicKey = 'GPAUSE_DONOR_KEY_TEST_001'");
  if (!donor) {
    const r = await Database.run("INSERT INTO users (publicKey) VALUES ('GPAUSE_DONOR_KEY_TEST_001')");
    donor = { id: r.id };
  }
  let recipient = await Database.get("SELECT id FROM users WHERE publicKey = 'GPAUSE_RECIP_KEY_TEST_001'");
  if (!recipient) {
    const r = await Database.run("INSERT INTO users (publicKey) VALUES ('GPAUSE_RECIP_KEY_TEST_001')");
    recipient = { id: r.id };
  }

  const nextDate = new Date(Date.now() + 86400000).toISOString();
  const result = await Database.run(
    `INSERT INTO recurring_donations (donorId, recipientId, amount, frequency, nextExecutionDate, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [donor.id, recipient.id, 10, 'weekly', nextDate, status]
  );
  return result.id;
}

beforeAll(async () => {
  await Database.initialize();
  app = createTestApp();
});

afterAll(async () => {
  await Database.close();
});

const API_KEY = 'test-pause-resume-key';

describe('POST /stream/schedules/:id/pause', () => {
  test('pauses an active schedule', async () => {
    const id = await createSchedule('active');
    const res = await request(app)
      .post(`/stream/schedules/${id}/pause`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('paused');
    expect(res.body.data.pausedAt).toBeDefined();

    const row = await Database.get('SELECT status, pausedAt FROM recurring_donations WHERE id = ?', [id]);
    expect(row.status).toBe('paused');
    expect(row.pausedAt).toBeTruthy();
  });

  test('returns 409 when schedule is already paused', async () => {
    const id = await createSchedule('paused');
    const res = await request(app)
      .post(`/stream/schedules/${id}/pause`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/already paused/i);
  });

  test('returns 400 when schedule is cancelled', async () => {
    const id = await createSchedule('cancelled');
    const res = await request(app)
      .post(`/stream/schedules/${id}/pause`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 404 for non-existent schedule', async () => {
    const res = await request(app)
      .post('/stream/schedules/999999/pause')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(404);
  });
});

describe('POST /stream/schedules/:id/resume', () => {
  test('resumes a paused schedule', async () => {
    const id = await createSchedule('paused');
    const res = await request(app)
      .post(`/stream/schedules/${id}/resume`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.resumedAt).toBeDefined();
    expect(res.body.data.nextExecutionDate).toBeDefined();

    const row = await Database.get('SELECT status, resumedAt FROM recurring_donations WHERE id = ?', [id]);
    expect(row.status).toBe('active');
    expect(row.resumedAt).toBeTruthy();
  });

  test('returns 400 when schedule is already active', async () => {
    const id = await createSchedule('active');
    const res = await request(app)
      .post(`/stream/schedules/${id}/resume`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('returns 404 for non-existent schedule', async () => {
    const res = await request(app)
      .post('/stream/schedules/999999/resume')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(404);
  });

  test('recalculates nextExecutionDate from now on resume', async () => {
    const id = await createSchedule('paused');
    const before = Date.now();
    const res = await request(app)
      .post(`/stream/schedules/${id}/resume`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    const nextDate = new Date(res.body.data.nextExecutionDate).getTime();
    // Should be at least 6 days in the future (weekly schedule)
    expect(nextDate).toBeGreaterThan(before + 6 * 24 * 60 * 60 * 1000);
  });
});

describe('GET /stream/schedules?status=paused', () => {
  test('returns only paused schedules when status=paused', async () => {
    await createSchedule('active');
    await createSchedule('paused');
    await createSchedule('paused');

    const res = await request(app)
      .get('/stream/schedules?status=paused')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    res.body.data.forEach(s => expect(s.status).toBe('paused'));
  });

  test('returns all schedules when no status filter', async () => {
    const res = await request(app)
      .get('/stream/schedules')
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('schedule detail includes pausedAt and resumedAt fields', async () => {
    const id = await createSchedule('active');
    await request(app).post(`/stream/schedules/${id}/pause`).set('X-API-Key', API_KEY);

    const res = await request(app)
      .get(`/stream/schedules/${id}`)
      .set('X-API-Key', API_KEY);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('pausedAt');
    expect(res.body.data).toHaveProperty('resumedAt');
  });
});

describe('Scheduler skips paused schedules', () => {
  test('paused schedules are not in the active query', async () => {
    const id = await createSchedule('paused');
    await Database.run(
      "UPDATE recurring_donations SET nextExecutionDate = '2020-01-01T00:00:00.000Z' WHERE id = ?",
      [id]
    );

    const { SCHEDULE_STATUS } = require('../../src/constants');
    const dueSchedules = await Database.query(
      `SELECT id FROM recurring_donations WHERE status = ? AND nextExecutionDate <= ?`,
      [SCHEDULE_STATUS.ACTIVE, new Date().toISOString()]
    );

    const ids = dueSchedules.map(s => s.id);
    expect(ids).not.toContain(id);
  });

  test('SCHEDULE_STATUS.PAUSED constant exists', () => {
    const { SCHEDULE_STATUS } = require('../../src/constants');
    expect(SCHEDULE_STATUS.PAUSED).toBe('paused');
  });
});
