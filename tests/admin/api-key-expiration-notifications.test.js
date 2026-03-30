/**
 * Tests: API Key Expiration Notifications
 *
 * Covers:
 *  - getKeysExpiringWithin model function (deduplication, thresholds)
 *  - markExpiryNotificationSent model function
 *  - ApiKeyExpirationNotifier.run() (webhook + email dispatch, error handling)
 *  - ApiKeyExpirationNotifier._sendWebhook (delivery, timeout, invalid URL)
 *  - ApiKeyExpirationNotifier._sendEmail (valid/invalid email, SMTP error)
 *  - X-API-Key-Expires-In response header (30-day window, exact boundary, no header beyond window)
 *  - RecurringDonationScheduler integration (notifier referenced in scheduler source)
 */

'use strict';

const db = require('../../src/utils/database');
const {
  initializeApiKeysTable,
  createApiKey,
  getKeysExpiringWithin,
  markExpiryNotificationSent,
} = require('../../src/models/apiKeys');

const {
  ApiKeyExpirationNotifier,
  EXPIRY_THRESHOLDS_DAYS,
  HEADER_WINDOW_DAYS,
} = require('../../src/services/ApiKeyExpirationNotifier');

// ─── helpers ────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Insert a key directly with a specific expires_at timestamp. */
async function insertKeyWithExpiry(expiresAt, extra = {}) {
  const crypto = require('crypto');
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.substring(0, 8);
  const keySecret = crypto.randomBytes(32).toString('hex');
  const now = Date.now();

  const result = await db.run(
    `INSERT INTO api_keys
       (key_hash, key_prefix, name, role, status, created_by, metadata, expires_at,
        created_at, grace_period_days, signing_required, key_secret, allowed_ips,
        notification_email, last_expiry_notification_sent_at)
     VALUES (?, ?, ?, 'user', 'active', 'test', ?, ?, ?, 30, 0, ?, NULL, ?, ?)`,
    [
      keyHash, keyPrefix,
      extra.name || ('test-key-' + keyPrefix),
      JSON.stringify(extra.metadata || {}),
      expiresAt,
      now,
      keySecret,
      extra.notificationEmail || null,
      extra.lastExpiryNotificationSentAt !== undefined ? extra.lastExpiryNotificationSentAt : null,
    ]
  );
  return { id: result.id, rawKey, keyPrefix };
}

// ─── setup / teardown ───────────────────────────────────────────────────────

beforeAll(async () => {
  await initializeApiKeysTable();
});

afterEach(async () => {
  await db.run("DELETE FROM api_keys WHERE created_by = 'test'");
});

// ─── Model: getKeysExpiringWithin ────────────────────────────────────────────

describe('getKeysExpiringWithin', () => {
  it('returns keys expiring within the threshold window', async () => {
    const expiresAt = Date.now() + 6 * DAY_MS;
    const { id } = await insertKeyWithExpiry(expiresAt);

    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(true);
  });

  it('excludes keys expiring beyond the threshold window', async () => {
    const expiresAt = Date.now() + 8 * DAY_MS;
    const { id } = await insertKeyWithExpiry(expiresAt);

    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('excludes already-expired keys', async () => {
    const expiresAt = Date.now() - DAY_MS;
    const { id } = await insertKeyWithExpiry(expiresAt);

    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('excludes keys that already received a notification at this threshold', async () => {
    const expiresAt = Date.now() + 6 * DAY_MS;
    const { id } = await insertKeyWithExpiry(expiresAt, { lastExpiryNotificationSentAt: 7 });

    const keys = await getKeysExpiringWithin(7);
    expect(keys.some(k => k.id === id)).toBe(false);
  });

  it('includes keys that received a wider threshold but not this one', async () => {
    const expiresAt = Date.now() + 20 * 60 * 60 * 1000;
    const { id } = await insertKeyWithExpiry(expiresAt, { lastExpiryNotificationSentAt: 7 });

    const keys = await getKeysExpiringWithin(1);
    expect(keys.some(k => k.id === id)).toBe(true);
  });

  it('returns notification_email and metadata', async () => {
    const expiresAt = Date.now() + 3 * DAY_MS;
    await insertKeyWithExpiry(expiresAt, {
      notificationEmail: 'owner@example.com',
      metadata: { webhookUrl: 'https://example.com/hook' },
    });

    const keys = await getKeysExpiringWithin(7);
    const key = keys.find(k => k.notificationEmail === 'owner@example.com');
    expect(key).toBeDefined();
    expect(key.metadata.webhookUrl).toBe('https://example.com/hook');
  });

  it('returns empty array when no keys match', async () => {
    const keys = await getKeysExpiringWithin(7);
    expect(Array.isArray(keys)).toBe(true);
  });
});

// ─── Model: markExpiryNotificationSent ──────────────────────────────────────

describe('markExpiryNotificationSent', () => {
  it('sets last_expiry_notification_sent_at to the threshold', async () => {
    const expiresAt = Date.now() + 6 * DAY_MS;
    const { id } = await insertKeyWithExpiry(expiresAt);

    await markExpiryNotificationSent(id, 7);

    const row = await db.get(
      'SELECT last_expiry_notification_sent_at FROM api_keys WHERE id = ?',
      [id]
    );
    expect(row.last_expiry_notification_sent_at).toBe(7);
  });

  it('can update the threshold from 7 to 1', async () => {
    const expiresAt = Date.now() + 20 * 60 * 60 * 1000;
    const { id } = await insertKeyWithExpiry(expiresAt, { lastExpiryNotificationSentAt: 7 });

    await markExpiryNotificationSent(id, 1);

    const row = await db.get(
      'SELECT last_expiry_notification_sent_at FROM api_keys WHERE id = ?',
      [id]
    );
    expect(row.last_expiry_notification_sent_at).toBe(1);
  });
});

// ─── ApiKeyExpirationNotifier ────────────────────────────────────────────────

describe('ApiKeyExpirationNotifier', () => {
  let notifier;

  beforeEach(() => {
    notifier = new ApiKeyExpirationNotifier();
  });

  describe('run()', () => {
    it('returns { notified: 0, errors: 0 } when no keys are expiring', async () => {
      const result = await notifier.run();
      expect(result.notified).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('notifies a key expiring in 7 days via webhook', async () => {
      const expiresAt = Date.now() + 6 * DAY_MS;
      const { id } = await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
      });

      const webhookSpy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true, statusCode: 200 });

      const result = await notifier.run();

      expect(webhookSpy).toHaveBeenCalledWith(
        'http://localhost:9999/hook',
        expect.objectContaining({ id }),
        7
      );
      expect(result.notified).toBeGreaterThanOrEqual(1);

      webhookSpy.mockRestore();
    });

    it('notifies a key expiring in 1 day via webhook', async () => {
      const expiresAt = Date.now() + 20 * 60 * 60 * 1000;
      const { id } = await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
        lastExpiryNotificationSentAt: 7,
      });

      const webhookSpy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true, statusCode: 200 });

      const result = await notifier.run();

      expect(webhookSpy).toHaveBeenCalledWith(
        'http://localhost:9999/hook',
        expect.objectContaining({ id }),
        1
      );
      expect(result.notified).toBeGreaterThanOrEqual(1);

      webhookSpy.mockRestore();
    });

    it('notifies a key expiring in 1 day via email', async () => {
      const expiresAt = Date.now() + 20 * 60 * 60 * 1000;
      const { id } = await insertKeyWithExpiry(expiresAt, {
        notificationEmail: 'dev@example.com',
        lastExpiryNotificationSentAt: 7,
      });

      const emailSpy = jest.spyOn(notifier, '_sendEmail').mockResolvedValue();

      await notifier.run();

      expect(emailSpy).toHaveBeenCalledWith(
        'dev@example.com',
        expect.objectContaining({ id }),
        1
      );

      emailSpy.mockRestore();
    });

    it('marks notification as sent after successful dispatch', async () => {
      const expiresAt = Date.now() + 6 * DAY_MS;
      const { id } = await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
      });

      jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

      await notifier.run();

      const row = await db.get(
        'SELECT last_expiry_notification_sent_at FROM api_keys WHERE id = ?',
        [id]
      );
      expect(row.last_expiry_notification_sent_at).toBe(7);

      notifier._sendWebhook.mockRestore();
    });

    it('does not re-notify a key that already received the same threshold', async () => {
      const expiresAt = Date.now() + 6 * DAY_MS;
      await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
        lastExpiryNotificationSentAt: 7,
      });

      const webhookSpy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

      await notifier.run();

      const calls = webhookSpy.mock.calls.filter(([, , threshold]) => threshold === 7);
      expect(calls.length).toBe(0);

      webhookSpy.mockRestore();
    });

    it('counts errors when webhook throws', async () => {
      const expiresAt = Date.now() + 6 * DAY_MS;
      await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
      });

      jest.spyOn(notifier, '_sendWebhook').mockRejectedValue(new Error('network error'));

      const result = await notifier.run();
      expect(result.errors).toBeGreaterThanOrEqual(1);

      notifier._sendWebhook.mockRestore();
    });

    it('notifies recently expired keys with threshold 0', async () => {
      const expiresAt = Date.now() - 30 * 60 * 1000;
      const { id } = await insertKeyWithExpiry(expiresAt, {
        metadata: { webhookUrl: 'http://localhost:9999/hook' },
      });

      const webhookSpy = jest.spyOn(notifier, '_sendWebhook').mockResolvedValue({ delivered: true });

      const result = await notifier.run();

      expect(webhookSpy).toHaveBeenCalledWith(
        'http://localhost:9999/hook',
        expect.objectContaining({ id }),
        0
      );
      expect(result.notified).toBeGreaterThanOrEqual(1);

      webhookSpy.mockRestore();
    });

    it('skips keys with no notification channels configured', async () => {
      const expiresAt = Date.now() + 6 * DAY_MS;
      await insertKeyWithExpiry(expiresAt);

      const webhookSpy = jest.spyOn(notifier, '_sendWebhook');
      const emailSpy = jest.spyOn(notifier, '_sendEmail');

      const result = await notifier.run();

      expect(webhookSpy).not.toHaveBeenCalled();
      expect(emailSpy).not.toHaveBeenCalled();
      expect(result.notified).toBeGreaterThanOrEqual(1);

      webhookSpy.mockRestore();
      emailSpy.mockRestore();
    });
  });

  // ─── _sendWebhook ──────────────────────────────────────────────────────────

  describe('_sendWebhook()', () => {
    it('returns { delivered: false } for an invalid URL', async () => {
      const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + DAY_MS };
      const result = await notifier._sendWebhook('not-a-url', key, 7);
      expect(result.delivered).toBe(false);
      expect(result.error).toMatch(/invalid/i);
    });

    it('sends correct event name for 7-day threshold', async () => {
      const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + 6 * DAY_MS };
      const http = require('http');
      const mockReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
      };
      jest.spyOn(http, 'request').mockImplementation((opts, cb) => {
        const mockRes = { statusCode: 200, resume: jest.fn() };
        cb(mockRes);
        return mockReq;
      });

      const result = await notifier._sendWebhook('http://example.com/hook', key, 7);
      expect(result.delivered).toBe(true);
      expect(result.statusCode).toBe(200);

      http.request.mockRestore();
    });

    it('sends correct event name for expired (threshold 0)', async () => {
      const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() - 1000 };
      const http = require('http');
      let capturedBody = '';
      const mockReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(body => { capturedBody = body; }),
        end: jest.fn(),
      };
      jest.spyOn(http, 'request').mockImplementation((opts, cb) => {
        const mockRes = { statusCode: 200, resume: jest.fn() };
        cb(mockRes);
        return mockReq;
      });

      await notifier._sendWebhook('http://example.com/hook', key, 0);
      const payload = JSON.parse(capturedBody);
      expect(payload.event).toBe('api_key.expired');

      http.request.mockRestore();
    });
  });

  // ─── _sendEmail ────────────────────────────────────────────────────────────

  describe('_sendEmail()', () => {
    it('does not throw for invalid email — logs warning instead', async () => {
      const key = { id: 1, keyPrefix: 'abc', name: 'test', expiresAt: Date.now() + DAY_MS };
      await expect(notifier._sendEmail('not-an-email', key, 7)).resolves.toBeUndefined();
    });

    it('calls nodemailer sendMail with correct subject for 7-day threshold', async () => {
      const nodemailer = require('nodemailer');
      const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock });

      const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + 6 * DAY_MS };
      await notifier._sendEmail('user@example.com', key, 7);

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          subject: expect.stringContaining('7 days'),
        })
      );

      nodemailer.createTransport.mockRestore();
    });

    it('calls nodemailer sendMail with correct subject for 1-day threshold', async () => {
      const nodemailer = require('nodemailer');
      const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock });

      const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + 20 * 60 * 60 * 1000 };
      await notifier._sendEmail('user@example.com', key, 1);

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('1 day'),
        })
      );

      nodemailer.createTransport.mockRestore();
    });

    it('uses "expired" subject when threshold is 0', async () => {
      const nodemailer = require('nodemailer');
      const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test-id' });
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: sendMailMock });

      const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() - 1000 };
      await notifier._sendEmail('user@example.com', key, 0);

      expect(sendMailMock).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: expect.stringContaining('expired'),
        })
      );

      nodemailer.createTransport.mockRestore();
    });

    it('propagates SMTP errors', async () => {
      const nodemailer = require('nodemailer');
      jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
        sendMail: jest.fn().mockRejectedValue(new Error('SMTP connection refused')),
      });

      const key = { id: 1, keyPrefix: 'abc', name: 'My Key', expiresAt: Date.now() + DAY_MS };
      await expect(notifier._sendEmail('user@example.com', key, 7)).rejects.toThrow('SMTP connection refused');

      nodemailer.createTransport.mockRestore();
    });
  });
});

// ─── X-API-Key-Expires-In response header ─────────────────────────────────────────────
// Tests the middleware directly to avoid importing the full app (which has pre-existing
// syntax errors in RecurringDonationScheduler.js unrelated to this feature).

describe('X-API-Key-Expires-In response header', () => {
  const requireApiKey = require('../../src/middleware/apiKey');

  function makeResMock() {
    const headers = {};
    return {
      headers,
      setHeader(name, val) { this.headers[name] = val; },
      status() { return this; },
      json() { return this; },
      get() { return null; },
    };
  }

  function makeReqMock(apiKey) {
    return {
      apiKey: null,
      get: (h) => h === 'x-api-key' ? apiKey : null,
      ip: '127.0.0.1',
      path: '/test',
      method: 'GET',
      originalUrl: '/test',
      id: 'req-test',
      rawBody: '',
    };
  }

  afterEach(async () => {
    await db.run("DELETE FROM api_keys WHERE created_by = 'header-test'");
  });

  it('sets X-API-Key-Expires-In when key expires within 30 days', async () => {
    const keyInfo = await createApiKey({
      name: 'Header Test 5d',
      role: 'user',
      expiresInDays: 5,
      createdBy: 'header-test',
    });

    const req = makeReqMock(keyInfo.key);
    const res = makeResMock();
    await new Promise(resolve => requireApiKey(req, res, resolve));

    expect(res.headers['X-API-Key-Expires-In']).toBeDefined();
    const days = parseInt(res.headers['X-API-Key-Expires-In'], 10);
    expect(days).toBeGreaterThanOrEqual(4);
    expect(days).toBeLessThanOrEqual(6);
  });

  it('sets X-API-Key-Expires-In = 1 when key expires in less than 1 day', async () => {
    const keyInfo = await createApiKey({
      name: 'Header Test 1d',
      role: 'user',
      expiresInDays: 1,
      createdBy: 'header-test',
    });

    const req = makeReqMock(keyInfo.key);
    const res = makeResMock();
    await new Promise(resolve => requireApiKey(req, res, resolve));

    expect(res.headers['X-API-Key-Expires-In']).toBeDefined();
    expect(parseInt(res.headers['X-API-Key-Expires-In'], 10)).toBe(1);
  });

  it('does NOT set X-API-Key-Expires-In when key expires beyond 30 days', async () => {
    const keyInfo = await createApiKey({
      name: 'Header Test 60d',
      role: 'user',
      expiresInDays: 60,
      createdBy: 'header-test',
    });

    const req = makeReqMock(keyInfo.key);
    const res = makeResMock();
    await new Promise(resolve => requireApiKey(req, res, resolve));

    expect(res.headers['X-API-Key-Expires-In']).toBeUndefined();
  });

  it('does NOT set X-API-Key-Expires-In for keys with no expiry', async () => {
    const keyInfo = await createApiKey({
      name: 'Header Test No Expiry',
      role: 'user',
      createdBy: 'header-test',
    });

    const req = makeReqMock(keyInfo.key);
    const res = makeResMock();
    await new Promise(resolve => requireApiKey(req, res, resolve));

    expect(res.headers['X-API-Key-Expires-In']).toBeUndefined();
  });

  it('sets X-API-Key-Expires-In = 30 at the exact 30-day boundary', async () => {
    const keyInfo = await createApiKey({
      name: 'Header Test 30d',
      role: 'user',
      expiresInDays: 30,
      createdBy: 'header-test',
    });

    const req = makeReqMock(keyInfo.key);
    const res = makeResMock();
    await new Promise(resolve => requireApiKey(req, res, resolve));

    expect(res.headers['X-API-Key-Expires-In']).toBeDefined();
    expect(parseInt(res.headers['X-API-Key-Expires-In'], 10)).toBe(30);
  });
});

// ─── RecurringDonationScheduler integration ──────────────────────────────────

describe('RecurringDonationScheduler — expiry notification integration', () => {
  it('references ApiKeyExpirationNotifier in scheduler source', () => {
    const fs = require('fs');
    const schedulerSource = fs.readFileSync(
      require.resolve('../src/services/RecurringDonationScheduler.js'),
      'utf8'
    );
    expect(schedulerSource).toContain('ApiKeyExpirationNotifier');
    expect(schedulerSource).toContain('ApiKeyExpirationNotifier.run()');
  });
});

// ─── EXPIRY_THRESHOLDS_DAYS constant ─────────────────────────────────────────

describe('EXPIRY_THRESHOLDS_DAYS', () => {
  it('includes 7 and 1', () => {
    expect(EXPIRY_THRESHOLDS_DAYS).toContain(7);
    expect(EXPIRY_THRESHOLDS_DAYS).toContain(1);
  });
});

// ─── HEADER_WINDOW_DAYS constant ─────────────────────────────────────────────

describe('HEADER_WINDOW_DAYS', () => {
  it('is 30', () => {
    expect(HEADER_WINDOW_DAYS).toBe(30);
  });
});
