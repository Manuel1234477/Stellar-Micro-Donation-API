'use strict';

/**
 * Tests: Webhook Retry Queue with Exponential Backoff
 * Covers: scheduleRetry, processRetryQueue, dead-letter promotion, replay,
 *         backoff timing, admin endpoints, admin-only enforcement.
 */

jest.mock('uuid', () => ({ v4: () => 'mock-uuid-' + Math.random().toString(36).slice(2) }), { virtual: true });
jest.mock('@opentelemetry/api', () => ({}), { virtual: true });
jest.mock('nodemailer', () => ({}), { virtual: true });

jest.mock('../src/middleware/apiKey', () => (req, _res, next) => next());
jest.mock('../src/middleware/rbac', () => ({
  requireAdmin: () => (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Admin required' } });
    }
    next();
  },
}));

const express = require('express');
const request = require('supertest');
const Database = require('../src/utils/database');
const { WebhookService } = require('../src/services/WebhookService');
const adminWebhooksRouter = require('../src/routes/admin/webhooks');

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildApp({ role = 'admin' } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'test-user', role }; next(); });
  app.use('/admin/webhooks', adminWebhooksRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'ERROR', message: err.message } });
  });
  return app;
}

async function ensureTables() {
  await Database.run(`CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL, events TEXT NOT NULL,
    secret TEXT, api_key_id INTEGER, is_active INTEGER NOT NULL DEFAULT 1,
    consecutive_failures INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS webhook_retries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, webhook_id INTEGER NOT NULL,
    event TEXT NOT NULL, payload TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
    next_retry_at DATETIME NOT NULL, last_error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await Database.run(`CREATE TABLE IF NOT EXISTS webhook_dead_letters (
    id INTEGER PRIMARY KEY AUTOINCREMENT, webhook_id INTEGER NOT NULL,
    event TEXT NOT NULL, payload TEXT NOT NULL, attempts INTEGER NOT NULL,
    last_error TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function cleanTables() {
  await Database.run(`DELETE FROM webhook_dead_letters`);
  await Database.run(`DELETE FROM webhook_retries`);
  await Database.run(`DELETE FROM webhooks`);
}

// ── scheduleRetry ─────────────────────────────────────────────────────────────

describe('WebhookService.scheduleRetry', () => {
  beforeAll(async () => { await Database.initialize(); await ensureTables(); });
  beforeEach(cleanTables);

  it('inserts a retry row with correct attempt and next_retry_at', async () => {
    const before = Date.now();
    await WebhookService.scheduleRetry({ webhookId: 1, event: 'tx.confirmed', payload: { id: 'x' }, attempt: 0 });
    const rows = await Database.all(`SELECT * FROM webhook_retries`);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempt).toBe(0);
    expect(rows[0].webhook_id).toBe(1);
    expect(rows[0].event).toBe('tx.confirmed');
    const nextRetry = new Date(rows[0].next_retry_at).getTime();
    // delay = 30000 * 2^0 = 30000 ms
    expect(nextRetry).toBeGreaterThanOrEqual(before + 29_000);
  });

  it('applies exponential backoff: delay doubles each attempt', async () => {
    const t0 = Date.now();
    await WebhookService.scheduleRetry({ webhookId: 1, event: 'e', payload: {}, attempt: 0 });
    await WebhookService.scheduleRetry({ webhookId: 1, event: 'e', payload: {}, attempt: 1 });
    await WebhookService.scheduleRetry({ webhookId: 1, event: 'e', payload: {}, attempt: 2 });

    const rows = await Database.all(`SELECT * FROM webhook_retries ORDER BY attempt ASC`);
    const delays = rows.map(r => new Date(r.next_retry_at).getTime() - t0);

    // delay[1] should be roughly 2x delay[0]
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it('promotes to dead-letter when attempt >= RETRY_MAX_ATTEMPTS (6)', async () => {
    await WebhookService.scheduleRetry({
      webhookId: 1, event: 'tx.failed', payload: { id: 'y' },
      attempt: 6, lastError: 'connection refused',
    });

    const retries = await Database.all(`SELECT * FROM webhook_retries`);
    const dead = await Database.all(`SELECT * FROM webhook_dead_letters`);

    expect(retries).toHaveLength(0);
    expect(dead).toHaveLength(1);
    expect(dead[0].attempts).toBe(6);
    expect(dead[0].last_error).toBe('connection refused');
    expect(dead[0].event).toBe('tx.failed');
  });

  it('stores payload as JSON string', async () => {
    const payload = { donationId: 'don-123', amount: 50 };
    await WebhookService.scheduleRetry({ webhookId: 2, event: 'e', payload, attempt: 0 });
    const row = await Database.get(`SELECT payload FROM webhook_retries`);
    expect(JSON.parse(row.payload)).toEqual(payload);
  });
});

// ── processRetryQueue ─────────────────────────────────────────────────────────

describe('WebhookService.processRetryQueue', () => {
  beforeAll(async () => { await Database.initialize(); await ensureTables(); });
  beforeEach(cleanTables);

  it('returns zero counts when queue is empty', async () => {
    const result = await WebhookService.processRetryQueue();
    expect(result).toEqual({ processed: 0, succeeded: 0, failed: 0 });
  });

  it('skips entries not yet due', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at) VALUES (1, 'e', '{}', 0, ?)`,
      [future]
    );
    const result = await WebhookService.processRetryQueue();
    expect(result.processed).toBe(0);
  });

  it('processes due entries and succeeds when delivery works', async () => {
    // Insert a webhook
    const wh = await Database.run(`INSERT INTO webhooks (url, events) VALUES ('http://test.local/hook', '["*"]')`);
    const past = new Date(Date.now() - 1000).toISOString();
    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at) VALUES (?, 'tx.confirmed', '{"id":"1"}', 0, ?)`,
      [wh.id, past]
    );

    // Mock _deliverWithRetry to succeed
    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockResolvedValue(undefined);
    const result = await WebhookService.processRetryQueue();
    spy.mockRestore();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    // Entry removed from queue
    const remaining = await Database.all(`SELECT * FROM webhook_retries`);
    expect(remaining).toHaveLength(0);
  });

  it('re-schedules with incremented attempt on delivery failure', async () => {
    const wh = await Database.run(`INSERT INTO webhooks (url, events) VALUES ('http://test.local/hook', '["*"]')`);
    const past = new Date(Date.now() - 1000).toISOString();
    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at) VALUES (?, 'tx.failed', '{}', 1, ?)`,
      [wh.id, past]
    );

    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockRejectedValue(new Error('timeout'));
    const result = await WebhookService.processRetryQueue();
    spy.mockRestore();

    expect(result.failed).toBe(1);
    // Re-scheduled with attempt = 2
    const retries = await Database.all(`SELECT * FROM webhook_retries`);
    expect(retries).toHaveLength(1);
    expect(retries[0].attempt).toBe(2);
  });

  it('promotes to dead-letter after max attempts exhausted via processRetryQueue', async () => {
    const wh = await Database.run(`INSERT INTO webhooks (url, events) VALUES ('http://test.local/hook', '["*"]')`);
    const past = new Date(Date.now() - 1000).toISOString();
    // attempt = 5 (one more failure → attempt 6 → dead-letter)
    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at) VALUES (?, 'tx.failed', '{}', 5, ?)`,
      [wh.id, past]
    );

    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockRejectedValue(new Error('refused'));
    await WebhookService.processRetryQueue();
    spy.mockRestore();

    const retries = await Database.all(`SELECT * FROM webhook_retries`);
    const dead = await Database.all(`SELECT * FROM webhook_dead_letters`);
    expect(retries).toHaveLength(0);
    expect(dead).toHaveLength(1);
    expect(dead[0].attempts).toBe(6);
  });

  it('skips inactive webhooks', async () => {
    const wh = await Database.run(`INSERT INTO webhooks (url, events, is_active) VALUES ('http://test.local/hook', '["*"]', 0)`);
    const past = new Date(Date.now() - 1000).toISOString();
    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at) VALUES (?, 'e', '{}', 0, ?)`,
      [wh.id, past]
    );

    const spy = jest.spyOn(WebhookService, '_deliverWithRetry');
    const result = await WebhookService.processRetryQueue();
    spy.mockRestore();

    expect(spy).not.toHaveBeenCalled();
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
  });
});

// ── listDeadLetters / replayDeadLetter ────────────────────────────────────────

describe('WebhookService dead-letter management', () => {
  beforeAll(async () => { await Database.initialize(); await ensureTables(); });
  beforeEach(cleanTables);

  it('listDeadLetters returns empty array when none exist', async () => {
    expect(await WebhookService.listDeadLetters()).toEqual([]);
  });

  it('listDeadLetters returns entries with parsed payload', async () => {
    await Database.run(
      `INSERT INTO webhook_dead_letters (webhook_id, event, payload, attempts, last_error) VALUES (1, 'tx.failed', '{"id":"x"}', 6, 'timeout')`
    );
    const entries = await WebhookService.listDeadLetters();
    expect(entries).toHaveLength(1);
    expect(entries[0].payload).toEqual({ id: 'x' });
    expect(entries[0].attempts).toBe(6);
    expect(entries[0].lastError).toBe('timeout');
  });

  it('replayDeadLetter re-schedules as attempt 0 and removes dead-letter entry', async () => {
    const result = await Database.run(
      `INSERT INTO webhook_dead_letters (webhook_id, event, payload, attempts) VALUES (1, 'tx.failed', '{"id":"y"}', 6)`
    );
    await WebhookService.replayDeadLetter(result.id);

    const dead = await Database.all(`SELECT * FROM webhook_dead_letters`);
    const retries = await Database.all(`SELECT * FROM webhook_retries`);
    expect(dead).toHaveLength(0);
    expect(retries).toHaveLength(1);
    expect(retries[0].attempt).toBe(0);
    expect(retries[0].event).toBe('tx.failed');
  });

  it('replayDeadLetter throws 404 for unknown id', async () => {
    await expect(WebhookService.replayDeadLetter(9999)).rejects.toMatchObject({ status: 404 });
  });
});

// ── GET /admin/webhooks/dead-letter ───────────────────────────────────────────

describe('GET /admin/webhooks/dead-letter', () => {
  let app;
  beforeAll(async () => { await Database.initialize(); await ensureTables(); app = buildApp(); });
  beforeEach(cleanTables);

  it('returns empty list when no dead-letter entries', async () => {
    const res = await request(app).get('/admin/webhooks/dead-letter');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns dead-letter entries', async () => {
    await Database.run(
      `INSERT INTO webhook_dead_letters (webhook_id, event, payload, attempts) VALUES (1, 'tx.failed', '{}', 6)`
    );
    const res = await request(app).get('/admin/webhooks/dead-letter');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.data[0].event).toBe('tx.failed');
  });

  it('rejects non-admin with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).get('/admin/webhooks/dead-letter');
    expect(res.status).toBe(403);
  });
});

// ── POST /admin/webhooks/dead-letter/:id/replay ───────────────────────────────

describe('POST /admin/webhooks/dead-letter/:id/replay', () => {
  let app;
  beforeAll(async () => { await Database.initialize(); await ensureTables(); app = buildApp(); });
  beforeEach(cleanTables);

  it('replays a dead-letter entry', async () => {
    const result = await Database.run(
      `INSERT INTO webhook_dead_letters (webhook_id, event, payload, attempts) VALUES (1, 'tx.failed', '{"id":"z"}', 6)`
    );
    const res = await request(app).post(`/admin/webhooks/dead-letter/${result.id}/replay`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.replayed).toBe(true);

    const dead = await Database.all(`SELECT * FROM webhook_dead_letters`);
    expect(dead).toHaveLength(0);
  });

  it('returns 404 for unknown dead-letter id', async () => {
    const res = await request(app).post('/admin/webhooks/dead-letter/9999/replay');
    expect(res.status).toBe(404);
  });

  it('rejects non-admin with 403', async () => {
    const userApp = buildApp({ role: 'user' });
    const res = await request(userApp).post('/admin/webhooks/dead-letter/1/replay');
    expect(res.status).toBe(403);
  });
});
