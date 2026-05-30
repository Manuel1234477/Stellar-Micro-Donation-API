'use strict';

/**
 * Tests for BOLA fix on GET /stream/schedules (#754)
 * Users must only see their own schedules; admins can see all with ?all=true.
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-bola-754-key';
process.env.NODE_ENV = 'test';

const request = require('supertest');
const express = require('express');
const Database = require('../../src/utils/database');
const streamRouter = require('../../src/routes/stream');
const requireApiKey = require('../../src/middleware/apiKey');
const { attachUserRole } = require('../../src/middleware/rbac');
const { issueAccessToken } = require('../../src/services/JwtService');

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

const DONOR_A = 'GBOLA754DONORA000000000000000000000000000000000000000000001';
const DONOR_B = 'GBOLA754DONORB000000000000000000000000000000000000000000002';
const RECIPIENT = 'GBOLA754RECIPIENT0000000000000000000000000000000000000000003';

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
let scheduleA; // owned by DONOR_A
let scheduleB; // owned by DONOR_B

beforeAll(async () => {
  await Database.initialize();
  app = createTestApp();
  scheduleA = await createSchedule(DONOR_A, RECIPIENT);
  scheduleB = await createSchedule(DONOR_B, RECIPIENT);
});

afterAll(async () => {
  await Database.close();
});

describe('GET /stream/schedules — BOLA fix (#754)', () => {
  test('user with JWT sees only their own schedules', async () => {
    const token = issueAccessToken({ sub: DONOR_A, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain(scheduleA);
    expect(ids).not.toContain(scheduleB);
  });

  test('user cannot see another user\'s schedules', async () => {
    const token = issueAccessToken({ sub: DONOR_B, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain(scheduleB);
    expect(ids).not.toContain(scheduleA);
  });

  test('admin without ?all=true sees only their own schedules', async () => {
    const token = issueAccessToken({ sub: DONOR_A, role: 'admin' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain(scheduleA);
    expect(ids).not.toContain(scheduleB);
  });

  test('admin with ?all=true sees all schedules', async () => {
    const token = issueAccessToken({ sub: DONOR_A, role: 'admin' });
    const res = await request(app)
      .get('/stream/schedules?all=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain(scheduleA);
    expect(ids).toContain(scheduleB);
  });

  test('non-admin cannot use ?all=true to see all schedules', async () => {
    const token = issueAccessToken({ sub: DONOR_A, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules?all=true')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // ?all=true is ignored for non-admins; only own schedules returned
    const ids = res.body.data.map(s => s.id);
    expect(ids).toContain(scheduleA);
    expect(ids).not.toContain(scheduleB);
  });
});
