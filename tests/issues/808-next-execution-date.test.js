/**
 * Tests for issue #808: nextExecutionDate should be included in GET /stream/schedules responses
 */

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-808-key';
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

const DONOR = 'G808DONOR0000000000000000000000000000000000000000000000000001';
const RECIPIENT = 'G808RECIPIENT000000000000000000000000000000000000000000000002';

async function ensureUser(publicKey) {
  let user = await Database.get('SELECT id FROM users WHERE publicKey = ?', [publicKey]);
  if (!user) {
    const r = await Database.run('INSERT INTO users (publicKey) VALUES (?)', [publicKey]);
    user = { id: r.id };
  }
  return user;
}

let app;
let scheduleId;

beforeAll(async () => {
  await Database.initialize();
  app = createTestApp();

  const donor = await ensureUser(DONOR);
  const recipient = await ensureUser(RECIPIENT);

  const nextDate = new Date(Date.now() + 86400000).toISOString();
  const result = await Database.run(
    `INSERT INTO recurring_donations (donorId, recipientId, amount, frequency, nextExecutionDate, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [donor.id, recipient.id, 10.5, 'weekly', nextDate, 'active']
  );
  scheduleId = result.id;
});

afterAll(async () => {
  await Database.close();
});

describe('Issue #808: nextExecutionDate in GET /stream/schedules responses', () => {
  test('GET /stream/schedules includes nextExecutionDate for each schedule', async () => {
    const token = issueAccessToken({ sub: DONOR, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const schedule = res.body.data[0];
    expect(schedule.id).toBe(scheduleId);
    expect(schedule.nextExecutionDate).toBeDefined();
    expect(typeof schedule.nextExecutionDate).toBe('string');
    expect(new Date(schedule.nextExecutionDate)).toBeInstanceOf(Date);
  });

  test('GET /stream/schedules/:id includes nextExecutionDate', async () => {
    const token = issueAccessToken({ sub: DONOR, role: 'user' });
    const res = await request(app)
      .get(`/stream/schedules/${scheduleId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const schedule = res.body.data;
    expect(schedule.id).toBe(scheduleId);
    expect(schedule.nextExecutionDate).toBeDefined();
    expect(typeof schedule.nextExecutionDate).toBe('string');
    expect(new Date(schedule.nextExecutionDate)).toBeInstanceOf(Date);
  });

  test('nextExecutionDate is a valid ISO 8601 date string', async () => {
    const token = issueAccessToken({ sub: DONOR, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    const schedule = res.body.data[0];
    const nextDate = new Date(schedule.nextExecutionDate);

    expect(nextDate.getTime()).toBeGreaterThan(Date.now());
    expect(schedule.nextExecutionDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('nextExecutionDate is included alongside other schedule fields', async () => {
    const token = issueAccessToken({ sub: DONOR, role: 'user' });
    const res = await request(app)
      .get('/stream/schedules')
      .set('Authorization', `Bearer ${token}`);

    const schedule = res.body.data[0];

    // Verify all expected fields are present
    expect(schedule).toHaveProperty('id');
    expect(schedule).toHaveProperty('amount');
    expect(schedule).toHaveProperty('frequency');
    expect(schedule).toHaveProperty('status');
    expect(schedule).toHaveProperty('executionCount');
    expect(schedule).toHaveProperty('nextExecutionDate');
    expect(schedule).toHaveProperty('donorPublicKey');
    expect(schedule).toHaveProperty('recipientPublicKey');
  });
});
