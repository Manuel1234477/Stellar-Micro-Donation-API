/**
 * Tests: API Key Expiration Notifications (#622)
 *
 * Covers:
 *  - Configurable lead times via API_KEY_EXPIRY_WARN_DAYS
 *  - Webhook delivery with event type api_key.expiring
 *  - Email delivery
 *  - Deduplication (no duplicate alerts for same key + threshold)
 *  - GET /api-keys/:id/expiration-notices
 *  - Notification tracking in DB
 */

'use strict';

process.env.API_KEYS = 'admin-test-key';

const db = require('../src/utils/database');
const {
  initializeApiKeysTable,
  getKeysExpiringWithin,
  markExpiryNotificationSent,
  getExpirationNotices,
} = require('../src/models/apiKeys');
const {
  ApiKeyExpirationNotifier,
  EXPIRY_THRESHOLDS_DAYS,
  HEADER_WINDOW_DAYS,
} = require('../src/services/ApiKeyExpirationNotifier');

const DAY_MS = 24 * 60 * 60 * 1000;

async function insertKey(expiresAt, extra = {}) {
  const crypto = require('crypto');
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  const result = await db.run(
    `INSERT INTO api_keys
       (key_hash, key_prefix, name, role, status, created_by, metadata, expires_at,
        created_at, grace_period_days, signing_required, key_secret, allowed_ips,
        notification_email, last_expiry_notification_sent_at)
     VALUES (?, ?, ?, 'user', 'active', 'test-622', ?, ?, ?, 30, 0, ?, NULL, ?, ?)`,
    [
      keyHash, keyPrefix,
      extra.name || ('key-' + keyPrefix),
      JSON.stringify(extra.metadata || {}),
      expiresAt,
      Date.now(),
      crypto.randomBytes(16).toString('hex'),
      extra.notificationEmail || null,
      extra.lastSent !== undefined ? extra.lastSent : null,
    ]
  );
  return { id: result.id, keyPrefix };
}

beforeAll(() => initializeApiKeysTable());
afterEach(() => db.run("DELETE FROM api_keys WHERE created_by = 'test-622'"));

// ─── Configurable lead times ──────────────────────────────────────────────────

describe('EXPIRY_THRESHOLDS_DAYS', () => {
  it('includes 1 and 7 by default', () => {
    expect(EXPIRY_THRESHOLDS_DAYS).toContain(1);
    expect(EXPIRY_THRESHOLDS_DAYS).toContain(7);
  });

  it('HEADER_WINDOW_DAYS is 30', () => {
    expect(HEADER_WINDOW_DAYS).toBe(30);
  });
});

// ─── getKeysExpiringWithin ────────────────────────────────────────────────────

describe('getKeysExpiringWithin()', () => {
  it('returns keys expiring within the window', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(true);
  });

  it('excludes keys beyond the window', async () => {
    const { id } = await insertKey(Date.now() + 8 * DAY_MS);
    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('excludes already-expired keys', async () => {
    const { id } = await insertKey(Date.now() - DAY_MS);
    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('excludes keys already notified at this threshold (deduplication)', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS, { lastSent: 7 });
    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('includes key notified at wider threshold but not this one', async () => {
    const { id } = await insertKey(Date.now() + 20 * 60 * 60 * 1000, { lastSent: 7 });
    const keys = await getKeysExpiringWithin(1);
    expect(keys.some(k => k.id === id)).toBe(true);
  });
});

// ─── markExpiryNotificationSent ──────────────────────────────────────────────

describe('markExpiryNotificationSent()', () => {
  it('sets last_expiry_notification_sent_at', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    await markExpiryNotificationSent(id, 7);
    const row = await db.get('SELECT last_expiry_notification_sent_at FROM api_keys WHERE id = ?', [id]);
    expect(row.last_expiry_notification_sent_at).toBe(7);
  });

  it('records notice in api_key_expiration_notices table', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    await markExpiryNotificationSent(id, 7);
    const notices = await getExpirationNotices(id);
    expect(notices.length).toBeGreaterThanOrEqual(1);
    expect(notices[0].thresholdDays).toBe(7);
    expect(notices[0].sentAt).toBeGreaterThan(0);
  });
});

// ─── getExpirationNotices ─────────────────────────────────────────────────────

describe('getExpirationNotices()', () => {
  it('returns empty array for key with no notices', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    const notices = await getExpirationNotices(id);
    expect(notices).toEqual([]);
  });

  it('returns all notices for a key in descending order', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    await markExpiryNotificationSent(id, 7);
    await markExpiryNotificationSent(id, 1);
    const notices = await getExpirationNotices(id);
    expect(notices.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(notices[0].sentAt).toBeGreaterThanOrEqual(notices[1].sentAt);
  });
});

// ─── ApiKeyExpirationNotifier.run() ──────────────────────────────────────────

describe('ApiKeyExpirationNotifier.run()', () => {
  let notifier;
  beforeEach(() => { notifier = new ApiKeyExpirationNotifier(); });

  it('returns { notified: 0, errors: 0 } when no keys expiring', async () => {
    const result = await notifier.run();
    expect(result.notified).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('notifies key expiring in 7 days via webhook', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
    });
    const spy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true, statusCode: 200 });

    const result = await notifier.run();

    expect(spy).toHaveBeenCalledWith('http://localhost:9999/hook', expect.objectContaining({ id }), 7);
    expect(result.notified).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it('notifies key expiring in 1 day via webhook', async () => {
    const { id } = await insertKey(Date.now() + 20 * 60 * 60 * 1000, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
      lastSent: 7,
    });
    const spy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true, statusCode: 200 });

    await notifier.run();

    expect(spy).toHaveBeenCalledWith('http://localhost:9999/hook', expect.objectContaining({ id }), 1);
    spy.mockRestore();
  });

  it('notifies key expiring in 1 day via email', async () => {
    const { id } = await insertKey(Date.now() + 20 * 60 * 60 * 1000, {
      notificationEmail: 'dev@example.com',
      lastSent: 7,
    });
    const spy = jest.spyOn(notifier, '_sendEmail').mockResolvedValue();

    await notifier.run();

    expect(spy).toHaveBeenCalledWith('dev@example.com', expect.objectContaining({ id }), 1);
    spy.mockRestore();
  });

  it('marks notification sent after dispatch', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
    });
    jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

    await notifier.run();

    const row = await db.get('SELECT last_expiry_notification_sent_at FROM api_keys WHERE id = ?', [id]);
    expect(row.last_expiry_notification_sent_at).toBe(7);
    notifier._sendWebhook.mockRestore();
  });

  it('does not re-notify same key+threshold (deduplication)', async () => {
    await insertKey(Date.now() + 6 * DAY_MS, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
      lastSent: 7,
    });
    const spy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

    await notifier.run();

    const calls = spy.mock.calls.filter(([, , t]) => t === 7);
    expect(calls.length).toBe(0);
    spy.mockRestore();
  });

  it('counts errors when webhook throws', async () => {
    await insertKey(Date.now() + 6 * DAY_MS, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
    });
    jest.spyOn(notifier, '_sendWebhook').mockRejectedValue(new Error('network error'));

    const result = await notifier.run();
    expect(result.errors).toBeGreaterThanOrEqual(1);
    notifier._sendWebhook.mockRestore();
  });

  it('notifies recently expired keys with threshold 0', async () => {
    const { id } = await insertKey(Date.now() - 30 * 60 * 1000, {
      metadata: { webhookUrl: 'http://localhost:9999/hook' },
    });
    const spy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

    const result = await notifier.run();

    expect(spy).toHaveBeenCalledWith('http://localhost:9999/hook', expect.objectContaining({ id }), 0);
    expect(result.notified).toBeGreaterThanOrEqual(1);
    spy.mockRestore();
  });

  it('skips keys with no notification channels', async () => {
    await insertKey(Date.now() + 6 * DAY_MS);
    const wSpy = jest.spyOn(notifier, '_sendWebhook');
    const eSpy = jest.spyOn(notifier, '_sendEmail');

    const result = await notifier.run();

    expect(wSpy).not.toHaveBeenCalled();
    expect(eSpy).not.toHaveBeenCalled();
    // Still counts as notified (no channels = no-op, but not an error)
    expect(result.errors).toBe(0);
    wSpy.mockRestore();
    eSpy.mockRestore();
  });
});

// ─── _sendWebhook ─────────────────────────────────────────────────────────────

describe('ApiKeyExpirationNotifier._sendWebhook()', () => {
  let notifier;
  beforeEach(() => { notifier = new ApiKeyExpirationNotifier(); });

  it('returns { delivered: false } for invalid URL', async () => {
    const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + DAY_MS };
    const result = await notifier._sendWebhook('not-a-url', key, 7);
    expect(result.delivered).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });

  it('uses event type api_key.expiring for non-zero threshold', async () => {
    const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + 6 * DAY_MS };
    const http = require('http');
    let capturedBody = '';
    const mockReq = { on: jest.fn().mockReturnThis(), write: jest.fn(b => { capturedBody = b; }), end: jest.fn() };
    jest.spyOn(http, 'request').mockImplementation((_, cb) => {
      cb({ statusCode: 200, resume: jest.fn() });
      return mockReq;
    });

    await notifier._sendWebhook('http://example.com/hook', key, 7);
    expect(JSON.parse(capturedBody).event).toBe('api_key.expiring');
    http.request.mockRestore();
  });

  it('uses event type api_key.expired for threshold 0', async () => {
    const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() - 1000 };
    const http = require('http');
    let capturedBody = '';
    const mockReq = { on: jest.fn().mockReturnThis(), write: jest.fn(b => { capturedBody = b; }), end: jest.fn() };
    jest.spyOn(http, 'request').mockImplementation((_, cb) => {
      cb({ statusCode: 200, resume: jest.fn() });
      return mockReq;
    });

    await notifier._sendWebhook('http://example.com/hook', key, 0);
    expect(JSON.parse(capturedBody).event).toBe('api_key.expired');
    http.request.mockRestore();
  });

  it('includes keyId and expiresAt in webhook payload', async () => {
    const expiresAt = Date.now() + 6 * DAY_MS;
    const key = { id: 42, keyPrefix: 'abc', name: 'test', expiresAt };
    const http = require('http');
    let capturedBody = '';
    const mockReq = { on: jest.fn().mockReturnThis(), write: jest.fn(b => { capturedBody = b; }), end: jest.fn() };
    jest.spyOn(http, 'request').mockImplementation((_, cb) => {
      cb({ statusCode: 200, resume: jest.fn() });
      return mockReq;
    });

    await notifier._sendWebhook('http://example.com/hook', key, 7);
    const payload = JSON.parse(capturedBody);
    expect(payload.keyId).toBe(42);
    expect(payload.expiresAt).toBeDefined();
    expect(payload.daysUntilExpiry).toBe(7);
    http.request.mockRestore();
  });
});

// ─── _sendEmail ───────────────────────────────────────────────────────────────

describe('ApiKeyExpirationNotifier._sendEmail()', () => {
  let notifier;
  beforeEach(() => { notifier = new ApiKeyExpirationNotifier(); });

  it('does not throw for invalid email', async () => {
    const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + DAY_MS };
    await expect(notifier._sendEmail('not-an-email', key, 7)).resolves.toBeUndefined();
  });

  it('sends email with correct subject for 7-day threshold', async () => {
    const nodemailer = require('nodemailer');
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });

    const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + 6 * DAY_MS };
    await notifier._sendEmail('user@example.com', key, 7);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      subject: expect.stringContaining('7 day'),
    }));
    nodemailer.createTransport.mockRestore();
  });

  it('sends email with correct subject for 1-day threshold', async () => {
    const nodemailer = require('nodemailer');
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });

    const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + 20 * 60 * 60 * 1000 };
    await notifier._sendEmail('user@example.com', key, 1);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('1 day'),
    }));
    nodemailer.createTransport.mockRestore();
  });

  it('sends "expired" subject for threshold 0', async () => {
    const nodemailer = require('nodemailer');
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'id' });
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail });

    const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() - 1000 };
    await notifier._sendEmail('user@example.com', key, 0);

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      subject: expect.stringContaining('expired'),
    }));
    nodemailer.createTransport.mockRestore();
  });

  it('propagates SMTP errors', async () => {
    const nodemailer = require('nodemailer');
    jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: jest.fn().mockRejectedValue(new Error('SMTP refused')),
    });

    const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + DAY_MS };
    await expect(notifier._sendEmail('user@example.com', key, 7)).rejects.toThrow('SMTP refused');
    nodemailer.createTransport.mockRestore();
  });
});

// ─── GET /api-keys/:id/expiration-notices ────────────────────────────────────

describe('GET /api-keys/:id/expiration-notices', () => {
  const express = require('express');
  const request = require('supertest');

  function createApp() {
    const app = express();
    app.use(express.json());
    // Inject admin user for all requests
    app.use((req, _res, next) => {
      req.user = { id: 'admin', role: 'admin' };
      next();
    });
    app.use('/api-keys', require('../src/routes/apiKeys'));
    app.use((err, _req, res, _next) => {
      res.status(err.statusCode || err.status || 500).json({
        success: false,
        error: { code: err.code || 'ERROR', message: err.message },
      });
    });
    return app;
  }

  let app;
  beforeAll(() => { app = createApp(); });
  afterEach(() => db.run("DELETE FROM api_keys WHERE created_by = 'test-622'"));

  it('returns empty notices for a key with none', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    const res = await request(app).get(`/api-keys/${id}/expiration-notices`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.keyId).toBe(id);
    expect(res.body.data.notices).toEqual([]);
  });

  it('returns notices after markExpiryNotificationSent', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    await markExpiryNotificationSent(id, 7);

    const res = await request(app).get(`/api-keys/${id}/expiration-notices`);
    expect(res.status).toBe(200);
    expect(res.body.data.notices.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.notices[0].thresholdDays).toBe(7);
  });

  it('returns multiple notices in descending order', async () => {
    const { id } = await insertKey(Date.now() + 6 * DAY_MS);
    await markExpiryNotificationSent(id, 7);
    await markExpiryNotificationSent(id, 1);

    const res = await request(app).get(`/api-keys/${id}/expiration-notices`);
    expect(res.status).toBe(200);
    const notices = res.body.data.notices;
    expect(notices.length).toBeGreaterThanOrEqual(2);
    expect(notices[0].sentAt).toBeGreaterThanOrEqual(notices[1].sentAt);
  });
});

// ─── RecurringDonationScheduler integration ──────────────────────────────────

describe('RecurringDonationScheduler references ApiKeyExpirationNotifier', () => {
  it('calls ApiKeyExpirationNotifier.run() in scheduler source', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require.resolve('../src/services/RecurringDonationScheduler.js'), 'utf8'
    );
    expect(src).toContain('ApiKeyExpirationNotifier');
    expect(src).toContain('ApiKeyExpirationNotifier.run()');
  });
});
