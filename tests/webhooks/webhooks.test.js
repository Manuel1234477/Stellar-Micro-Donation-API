/**
 * Webhook Tests
 * Tests for WebhookService (registration, delivery, retry, HMAC signing, auto-disable)
 * and the /webhooks HTTP endpoints.
 */

// Mock broken modules with duplicate declarations (pre-existing issue)
jest.mock('../src/models/apiKeys', () => ({
  initializeApiKeysTable: jest.fn().mockResolvedValue(undefined),
  createApiKey: jest.fn(),
  listApiKeys: jest.fn(),
  getApiKeyByValue: jest.fn().mockResolvedValue({ id: 1, role: 'admin', status: 'active', key_hash: 'x' }),
  rotateApiKey: jest.fn(),
  deprecateApiKey: jest.fn(),
  revokeApiKey: jest.fn(),
  revokeExpiredDeprecatedKeys: jest.fn().mockResolvedValue(0),
}));

jest.mock('../src/services/RecurringDonationScheduler', () => ({
  Class: class { start() {} stop() {} },
}));

// Database mock — store lives inside the factory to satisfy Jest's scope rules
jest.mock('../src/utils/database', () => {
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

  it('uses provided secret when given', async () => {
    const wh = await WebhookService.register({
      url: 'https://example.com/hook',
      events: ['transaction.confirmed'],
      secret: 'my-secret',
    });
    expect(wh.secret).toBe('my-secret');
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
    await expect(WebhookService.remove(999)).rejects.toMatchObject({ status: 404 });
  });
});

describe('WebhookService HMAC signing', () => {
  it('_sign produces consistent HMAC-SHA256 hex', () => {
    const body = '{"event":"transaction.confirmed"}';
    const secret = 'test-secret';
    const sig = WebhookService._sign(body, secret);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(sig).toBe(expected);
  });

  it('different secrets produce different signatures', () => {
    const body = '{"event":"test"}';
    expect(WebhookService._sign(body, 'secret-a')).not.toBe(WebhookService._sign(body, 'secret-b'));
  });
});

describe('WebhookService.deliver()', () => {
  it('skips delivery when no webhooks match the event', async () => {
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.failed'] });
    await expect(WebhookService.deliver('transaction.confirmed', { id: '1' })).resolves.toBeUndefined();
  });

  it('delivers to wildcard (*) subscribed webhooks', async () => {
    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockResolvedValue(undefined);
    await WebhookService.register({ url: 'https://a.com/hook', events: ['*'] });
    await WebhookService.deliver('transaction.confirmed', { id: '1' });
    await new Promise(r => setImmediate(r));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('delivers to matching event subscribers', async () => {
    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockResolvedValue(undefined);
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.confirmed'] });
    await WebhookService.deliver('transaction.confirmed', { id: '1' });
    await new Promise(r => setImmediate(r));
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('does not deliver to non-matching event subscribers', async () => {
    const spy = jest.spyOn(WebhookService, '_deliverWithRetry').mockResolvedValue(undefined);
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.failed'] });
    await WebhookService.deliver('transaction.confirmed', { id: '1' });
    await new Promise(r => setImmediate(r));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('WebhookService retry and auto-disable', () => {
  it('auto-disables webhook after 5 consecutive failures', async () => {
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.confirmed'] });
    db._store.rows[0].consecutive_failures = 4;

    jest.spyOn(WebhookService, '_httpPost').mockRejectedValue(new Error('connection refused'));

    await WebhookService._deliverWithRetry(db._store.rows[0], 'transaction.confirmed', {}, 0);

    expect(db._store.rows[0].is_active).toBe(0);
    jest.restoreAllMocks();
  });

  it('resets consecutive_failures counter on successful delivery', async () => {
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.confirmed'] });
    db._store.rows[0].consecutive_failures = 2;

    jest.spyOn(WebhookService, '_httpPost').mockResolvedValue(200);

    await WebhookService._deliverWithRetry(db._store.rows[0], 'transaction.confirmed', {}, 0);

    expect(db._store.rows[0].consecutive_failures).toBe(0);
    jest.restoreAllMocks();
  });

  it('increments consecutive_failures on each failed attempt', async () => {
    await WebhookService.register({ url: 'https://a.com/hook', events: ['transaction.confirmed'] });
    db._store.rows[0].consecutive_failures = 1;

    // Fail once then succeed to stop the chain
    jest.spyOn(WebhookService, '_httpPost')
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue(200);

    await WebhookService._deliverWithRetry(db._store.rows[0], 'transaction.confirmed', {}, 0);

    // After retry succeeds, failures reset to 0
    expect(db._store.rows[0].consecutive_failures).toBe(0);
    jest.restoreAllMocks();
  });
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

describe('Webhook HTTP endpoints', () => {
  let app;

  beforeAll(() => {
    const webhooksRouter = require('../../src/routes/webhooks');
    app = express();
    app.use(express.json());
    app.use('/webhooks', webhooksRouter);
    app.use((err, req, res, next) => {
      void next;
      res.status(err.status || 500).json({ success: false, error: { message: err.message } });
    });
  });

  it('POST /webhooks registers a webhook', async () => {
    const res = await request(app)
      .post('/webhooks')
      .set('X-API-Key', 'test-key-1')
      .send({ url: 'https://example.com/hook', events: ['transaction.confirmed'] });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.url).toBe('https://example.com/hook');
    expect(res.body.data.events).toEqual(['transaction.confirmed']);
    expect(res.body.data.secret).toBeDefined();
  });

  it('POST /webhooks returns 400 for missing url', async () => {
    const res = await request(app)
      .post('/webhooks')
      .set('X-API-Key', 'test-key-1')
      .send({ events: ['transaction.confirmed'] });

    expect(res.status).toBe(400);
  });

  it('GET /webhooks lists registered webhooks', async () => {
    await WebhookService.register({ url: 'https://list-test.com/hook', events: ['*'] });

    const res = await request(app)
      .get('/webhooks')
      .set('X-API-Key', 'test-key-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('DELETE /webhooks/:id removes a webhook', async () => {
    const wh = await WebhookService.register({ url: 'https://del-test.com/hook', events: ['*'] });

    const res = await request(app)
      .delete(`/webhooks/${wh.id}`)
      .set('X-API-Key', 'test-key-1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('DELETE /webhooks/:id returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/webhooks/9999')
      .set('X-API-Key', 'test-key-1');

    expect(res.status).toBe(404);
  });
});
