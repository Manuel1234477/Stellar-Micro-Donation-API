/**
 * Webhook Tests
 * Tests for WebhookService (registration, delivery, retry, HMAC signing, auto-disable)
 * and the /webhooks HTTP endpoints.
 */

// Mock broken modules with duplicate declarations (pre-existing issue)
jest.mock('../../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', key_hash: 'x' }),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../../src/services/RecurringDonationScheduler', () => ({
  Class: class { start() {} stop() {} },
}));

// Database mock — store lives inside the factory to satisfy Jest's scope rules
jest.mock('../../src/utils/database', () => {
  const mockStore = { rows: [], nextId: 1 };

  const run = jest.fn().mockImplementation(async (sql, params) => {
    if (sql.includes('CREATE TABLE')) return {};
    if (sql.includes('INSERT INTO webhooks')) {
      const id = mockStore.nextId++;
      mockStore.rows.push({
        id, url: params[0], events: params[1], secret: params[2],
        api_key_id: params[3], created_at: new Date().toISOString(),
        is_active: 1, consecutive_failures: 0,
      });
      return { id, changes: 1 };
    }
    if (sql.includes('DELETE FROM webhooks')) {
      const id = params[0];
      const idx = mockStore.rows.findIndex(w => w.id === id);
      if (idx === -1) return { changes: 0 };
      mockStore.rows.splice(idx, 1);
      return { changes: 1 };
    }
    if (sql.includes('UPDATE webhooks')) {
      const id = params[params.length - 1];
      const w = mockStore.rows.find(h => h.id === id);
      if (w) {
        if (sql.includes('is_active = 0')) { w.is_active = 0; w.consecutive_failures = params[0]; }
        else if (sql.includes('consecutive_failures = 0')) { w.consecutive_failures = 0; }
        else { w.consecutive_failures = params[0]; }
      }
      return { changes: 1 };
    }
    return { changes: 0 };
  });

  const query = jest.fn().mockImplementation(async (sql) => {
    if (sql.includes('FROM webhooks')) return [...mockStore.rows];
    return [];
  });

  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    run,
    query,
    get: jest.fn().mockResolvedValue(null),
    close: jest.fn().mockResolvedValue(undefined),
    _store: mockStore, // expose for test assertions
  };
});

process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const request = require('supertest');
const express = require('express');
const WebhookService = require('../../src/services/WebhookService');
const db = require('../../src/utils/database');

// Reset store before each test
beforeEach(() => {
  db._store.rows.length = 0;
  db._store.nextId = 1;
});

// ── WebhookService unit tests ─────────────────────────────────────────────────

describe('WebhookService.register()', () => {
  it('registers a webhook and returns it with a secret', async () => {
    const wh = await WebhookService.register({
      url: 'https://example.com/hook',
      events: ['transaction.confirmed'],
    });

    expect(wh.id).toBe(1);
    expect(wh.url).toBe('https://example.com/hook');
    expect(wh.events).toEqual(['transaction.confirmed']);
    expect(typeof wh.secret).toBe('string');
    expect(wh.secret.length).toBeGreaterThan(0);
    expect(wh.isActive).toBe(true);
  });

  it('generates a server-side secret and ignores caller-supplied secrets', async () => {
    const wh = await WebhookService.register({
      url: 'https://example.com/hook',
      events: ['transaction.confirmed'],
      secret: 'my-secret',
    });

    // Caller-supplied secret must be ignored; a fresh server-generated secret is returned.
    expect(wh.secret).not.toBe('my-secret');
    expect(typeof wh.secret).toBe('string');
    // 32 random bytes hex-encoded => 64 hex characters.
    expect(wh.secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a high-entropy secret that differs across registrations', async () => {
    const a = await WebhookService.register({ url: 'https://a.com/hook', events: ['*'] });
    const b = await WebhookService.register({ url: 'https://b.com/hook', events: ['*'] });

    expect(a.secret).not.toBe(b.secret);
    // Entropy sanity check: 32 bytes of randomness.
    expect(Buffer.from(a.secret, 'hex')).toHaveLength(32);
    expect(Buffer.from(b.secret, 'hex')).toHaveLength(32);
  });

  it('returns the plaintext secret only once (not on subsequent list)', async () => {
    const wh = await WebhookService.register({ url: 'https://example.com/hook', events: ['*'] });
    expect(typeof wh.secret).toBe('string');

    const list = await WebhookService.list();
    expect(list[0].secret).toBeUndefined();
  });

  it('throws 400 for missing url', async () => {
    await expect(WebhookService.register({ events: ['transaction.confirmed'] }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 for empty events array', async () => {
    await expect(WebhookService.register({ url: 'https://example.com/hook', events: [] }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('throws 400 for invalid URL', async () => {
    await expect(WebhookService.register({ url: 'not-a-url', events: ['transaction.confirmed'] }))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('WebhookService TLS skip-verify gating', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalFlag = process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    if (originalFlag === undefined) {
      delete process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY;
    } else {
      process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY = originalFlag;
    }
  });

  it('blocks tlsSkipVerify=true in production and throws 400', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY;
    await expect(
      WebhookService.register({ url: 'https://example.com/hook', events: ['*'], tlsSkipVerify: true })
    ).rejects.toMatchObject({ status: 400, message: /not allowed in production/i });
  });

  it('allows tlsSkipVerify=true in production when break-glass flag is set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY = 'break-glass';
    const wh = await WebhookService.register({
      url: 'https://example.com/hook',
      events: ['*'],
      tlsSkipVerify: true,
    });
    expect(wh.tlsSkipVerify).toBe(true);
  });

  it('allows tlsSkipVerify=true in non-production environments', async () => {
    process.env.NODE_ENV = 'development';
    delete process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY;
    const wh = await WebhookService.register({
      url: 'https://example.com/hook',
      events: ['*'],
      tlsSkipVerify: true,
    });
    expect(wh.tlsSkipVerify).toBe(true);
  });

  it('_httpPost forces rejectUnauthorized=true in production without break-glass', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.WEBHOOK_ALLOW_TLS_SKIP_VERIFY;
    // _httpPost should not actually make a network call; capture the options
    const https = require('https');
    const captured = [];
    const origRequest = https.request;
    https.request = (opts, cb) => {
      captured.push(opts);
      // return a minimal fake request
      const EventEmitter = require('events');
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 200;
        res.resume = () => {};
        if (cb) cb(res);
      };
      req.destroy = () => {};
      return req;
    };
    try {
      const { WebhookService: WS } = require('../../src/services/WebhookService');
      await WS._httpPost('https://example.com/hook', '{}', 'sig', {}, true, 42);
      expect(captured[0].rejectUnauthorized).toBe(true);
    } finally {
      https.request = origRequest;
    }
  });
});

describe('WebhookService.list()', () => {
  it('returns empty array when no webhooks registered', async () => {
    const list = await WebhookService.list();
    expect(list).toEqual([]);
  });

  it('returns registered webhooks without secret', async () => {
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.confirmed'] });
    const list = await WebhookService.list();

    expect(list).toHaveLength(1);
    expect(list[0].url).toBe('https://a.com/hook');
    expect(list[0].secret).toBeUndefined();
  });
});

describe('WebhookService.remove()', () => {
  it('removes a registered webhook', async () => {
    const wh = await WebhookService.register({ url: 'https://a.com/hook', events: ['*'] });
    await WebhookService.remove(wh.id);
    expect(db._store.rows).toHaveLength(0);
  });

  it('throws 404 for unknown id', async () => {
    await expect(

/* … truncated 7742 chars — edit only what you need near the top … */
