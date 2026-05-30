'use strict';
/**
 * Tests for #778: DELETE /stream/schedules/:id — deferred cancellation during in-progress execution
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-778-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
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

const DONOR = 'GCANCEL778DONOR0000000000000000000000000000000000000000001';
const RECIPIENT = 'GCANCEL778RECIP0000000000000000000000000000000000000000002';

async function ensureUser(publicKey) {
  let user = await Database.get('SELECT id FROM users WHERE publicKey = ?', [publicKey]);
  if (!user) {
    const r = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
    user = { id: r.id };
  }
  return user;
}

async function createSchedule(donorPublicKey, recipientPublicKey) {
  const donor = await ensureUser(donorPublicKey);
  const recipient = await ensureUser(recipientPublicKey);
  const nextDate = new Date(Date.now() + 86400000).toISOString();
  const result = await Database.run(
    `INSERT INTO recurring_donations (donorId, recipientId, amount, frequency, nextExecutionDate, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [donor.id, recipient.id, 5, 'weekly', nextDate, 'active']
  );
  return result.id;
}

let app;

beforeAll(async () => {
  await Database.initialize();
  app = createApp();
});

afterAll(async () => {
  await Database.close();
});

describe('#778 — DELETE /stream/schedules/:id deferred cancellation', () => {
  test('immediate cancellation when schedule is not in-progress', async () => {
    const scheduleId = await createSchedule(DONOR, RECIPIENT);
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    const res = await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cancellationStatus).toBe('immediate');

    const row = await Database.get('SELECT status FROM recurring_donations WHERE id = ?', [scheduleId]);
    expect(row.status).toBe('cancelled');
  });

  test('deferred cancellation when schedule is currently executing', async () => {
    const scheduleId = await createSchedule(DONOR, RECIPIENT);
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    // Simulate in-progress execution by adding to the scheduler's executingSchedules set
    const scheduler = require('../../src/services/RecurringDonationScheduler');
    scheduler.executingSchedules.add(scheduleId);

    try {
      const res = await request(app)
        .delete(`/stream/schedules/${scheduleId}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.cancellationStatus).toBe('deferred');

      const row = await Database.get('SELECT status FROM recurring_donations WHERE id = ?', [scheduleId]);
      expect(row.status).toBe('pending_cancellation');
    } finally {
      scheduler.executingSchedules.delete(scheduleId);
    }
  });

  test('response indicates whether cancellation was immediate or deferred', async () => {
    const scheduleId = await createSchedule(DONOR, RECIPIENT);
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    const res = await request(app)
      .delete(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.body).toHaveProperty('cancellationStatus');
    expect(['immediate', 'deferred']).toContain(res.body.cancellationStatus);
  });

  test('returns 404 for non-existent schedule', async () => {
    const token = issueAccessToken({ sub: DONOR, role: 'user' });

    const res = await request(app)
      .delete('/stream/schedules/999999')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
