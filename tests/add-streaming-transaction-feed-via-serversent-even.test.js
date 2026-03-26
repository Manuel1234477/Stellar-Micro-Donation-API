'use strict';

/**
 * Tests for SSE transaction feed (issue #312).
 *
 * Covers:
 *  - SseManager unit: addClient, removeClient, connectionCount, broadcast, getStats
 *  - matchesFilter: all filter combinations
 *  - getMissedEvents: Last-Event-ID reconnection
 *  - writeSseEvent: correct SSE wire format
 *  - GET /stream/feed: SSE headers, connected event, filtering, heartbeat comment
 *  - GET /stream/feed: per-key connection limit (429)
 *  - GET /stream/feed: invalid filter params (400)
 *  - GET /stream/feed: Last-Event-ID replay
 *  - GET /stream/stats: connection counts
 */

const http = require('http');
const express = require('express');
const request = require('supertest');

// ─── helpers ────────────────────────────────────────────────────────────────

/** Parse SSE text into an array of {id, event, data} objects. */
function parseSse(text) {
  const events = [];
  const blocks = text.split('\n\n').filter(Boolean);
  for (const block of blocks) {
    const obj = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('id: '))    obj.id    = line.slice(4);
      if (line.startsWith('event: ')) obj.event = line.slice(7);
      if (line.startsWith('data: '))  obj.data  = JSON.parse(line.slice(6));
      if (line.startsWith(': '))      obj.comment = line.slice(2);
    }
    if (Object.keys(obj).length) events.push(obj);
  }
  return events;
}

/** Build a minimal express app with the stream router and a fake requireApiKey. */
function buildApp(keyId = 'key-1', role = 'user') {
  const app = express();
  app.use(express.json());
  // Fake auth middleware — sets both req.apiKey and req.user
  app.use((req, _res, next) => {
    req.apiKey = { id: keyId, role };
    req.user   = { id: `apikey-${keyId}`, role, name: 'Test' };
    next();
  });
  app.use('/stream', require('../src/routes/stream'));
  // Simple error handler so ForbiddenError etc. return JSON
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ success: false, error: { code: err.errorCode || 'ERROR', message: err.message } });
  });
  return app;
}

/** Collect SSE bytes from a supertest response for a short window. */
function collectSse(app, path, headers = {}, ms = 200) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const req = http.request({ port, path, headers: { 'x-api-key': 'test', ...headers } }, res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        setTimeout(() => {
          req.destroy();
          server.close();
          resolve({ status: res.statusCode, headers: res.headers, body });
        }, ms);
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  });
}

// ─── SseManager unit tests ───────────────────────────────────────────────────

const SseManager = require('../src/services/SseManager');

beforeEach(() => SseManager._reset());

describe('SseManager.matchesFilter', () => {
  const tx = { donor: 'ALICE', recipient: 'BOB', status: 'completed', amount: 50 };

  it('passes with empty filter', () => {
    expect(SseManager.matchesFilter(tx, {})).toBe(true);
  });

  it('filters by walletAddress (donor match)', () => {
    expect(SseManager.matchesFilter(tx, { walletAddress: 'ALICE' })).toBe(true);
  });

  it('filters by walletAddress (recipient match)', () => {
    expect(SseManager.matchesFilter(tx, { walletAddress: 'BOB' })).toBe(true);
  });

  it('rejects non-matching walletAddress', () => {
    expect(SseManager.matchesFilter(tx, { walletAddress: 'CAROL' })).toBe(false);
  });

  it('filters by status (match)', () => {
    expect(SseManager.matchesFilter(tx, { status: 'completed' })).toBe(true);
  });

  it('rejects non-matching status', () => {
    expect(SseManager.matchesFilter(tx, { status: 'pending' })).toBe(false);
  });

  it('filters by minAmount (pass)', () => {
    expect(SseManager.matchesFilter(tx, { minAmount: 50 })).toBe(true);
  });

  it('filters by minAmount (fail)', () => {
    expect(SseManager.matchesFilter(tx, { minAmount: 51 })).toBe(false);
  });

  it('filters by maxAmount (pass)', () => {
    expect(SseManager.matchesFilter(tx, { maxAmount: 50 })).toBe(true);
  });

  it('filters by maxAmount (fail)', () => {
    expect(SseManager.matchesFilter(tx, { maxAmount: 49 })).toBe(false);
  });

  it('combines multiple filters (all match)', () => {
    expect(SseManager.matchesFilter(tx, { walletAddress: 'ALICE', status: 'completed', minAmount: 10, maxAmount: 100 })).toBe(true);
  });

  it('combines multiple filters (one fails)', () => {
    expect(SseManager.matchesFilter(tx, { walletAddress: 'ALICE', status: 'pending' })).toBe(false);
  });
});

describe('SseManager.getMissedEvents', () => {
  it('returns empty array for non-numeric lastEventId', () => {
    expect(SseManager.getMissedEvents('abc')).toEqual([]);
  });

  it('returns events with id > lastEventId', () => {
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 1 });
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 2 });
    const missed = SseManager.getMissedEvents('1');
    expect(missed).toHaveLength(1);
    expect(missed[0].data.amount).toBe(2);
  });

  it('returns all events when lastEventId is 0', () => {
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 1 });
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 2 });
    expect(SseManager.getMissedEvents('0')).toHaveLength(2);
  });
});

describe('SseManager.addClient / removeClient / connectionCount', () => {
  function fakeRes() { return { write: jest.fn() }; }

  it('tracks connections per key', () => {
    SseManager.addClient('c1', 'key-1', {}, fakeRes());
    SseManager.addClient('c2', 'key-1', {}, fakeRes());
    expect(SseManager.connectionCount('key-1')).toBe(2);
  });

  it('removes client correctly', () => {
    SseManager.addClient('c1', 'key-1', {}, fakeRes());
    SseManager.removeClient('c1');
    expect(SseManager.connectionCount('key-1')).toBe(0);
  });

  it('returns 0 for unknown key', () => {
    expect(SseManager.connectionCount('unknown')).toBe(0);
  });
});

describe('SseManager.broadcast', () => {
  it('sends matching events to clients', () => {
    const res = { write: jest.fn() };
    SseManager.addClient('c1', 'k1', { status: 'completed' }, res);
    SseManager.broadcast('tx.confirmed', { donor: 'A', recipient: 'B', status: 'completed', amount: 10 });
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.write.mock.calls[0][0]).toContain('event: tx.confirmed');
  });

  it('does not send non-matching events', () => {
    const res = { write: jest.fn() };
    SseManager.addClient('c1', 'k1', { status: 'pending' }, res);
    SseManager.broadcast('tx.confirmed', { donor: 'A', recipient: 'B', status: 'completed', amount: 10 });
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe('SseManager.getStats', () => {
  it('returns zero totals when no clients', () => {
    const stats = SseManager.getStats();
    expect(stats.totalConnections).toBe(0);
    expect(stats.connectionsByKey).toEqual({});
  });

  it('counts connections by key', () => {
    const res = { write: jest.fn() };
    SseManager.addClient('c1', 'k1', {}, res);
    SseManager.addClient('c2', 'k1', {}, res);
    SseManager.addClient('c3', 'k2', {}, res);
    const stats = SseManager.getStats();
    expect(stats.totalConnections).toBe(3);
    expect(stats.connectionsByKey['k1']).toBe(2);
    expect(stats.connectionsByKey['k2']).toBe(1);
  });
});

describe('SseManager.writeSseEvent', () => {
  it('writes correct SSE wire format', () => {
    const res = { write: jest.fn() };
    SseManager.writeSseEvent(res, '42', 'tx.created', { amount: 5 });
    const written = res.write.mock.calls[0][0];
    expect(written).toContain('id: 42\n');
    expect(written).toContain('event: tx.created\n');
    expect(written).toContain('data: {"amount":5}\n');
    expect(written.endsWith('\n\n')).toBe(true);
  });
});

// ─── HTTP integration tests ──────────────────────────────────────────────────

describe('GET /stream/feed', () => {
  beforeEach(() => SseManager._reset());

  it('returns SSE headers', async () => {
    const { status, headers } = await collectSse(buildApp(), '/stream/feed');
    expect(status).toBe(200);
    expect(headers['content-type']).toMatch(/text\/event-stream/);
    expect(headers['cache-control']).toMatch(/no-cache/);
  });

  it('sends a connected event on open', async () => {
    const { body } = await collectSse(buildApp(), '/stream/feed');
    const events = parseSse(body);
    const connected = events.find(e => e.event === 'connected');
    expect(connected).toBeDefined();
    expect(connected.data.message).toBe('Stream connected');
  });

  it('sends heartbeat comment lines', async () => {
    // The heartbeat is 30s normally; we verify the route writes ': ping\n\n'
    // by temporarily patching the interval on the module and opening a connection.
    // Instead of waiting 30s, we verify the format by directly inspecting the route
    // behaviour: open a connection, manually trigger a write, and check the body.
    // We do this by monkey-patching setInterval for this test only.
    const origSetInterval = global.setInterval;
    let capturedCb;
    global.setInterval = (cb, _ms) => { capturedCb = cb; return origSetInterval(() => {}, 999999); };

    const { body } = await new Promise((resolve, reject) => {
      const app = buildApp('key-hb');
      const server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        const req = http.request({ port, path: '/stream/feed', headers: { 'x-api-key': 'test' } }, res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          setTimeout(() => {
            // Manually fire the heartbeat callback
            if (capturedCb) capturedCb();
            setTimeout(() => {
              req.destroy();
              server.close();
              global.setInterval = origSetInterval;
              resolve({ body });
            }, 50);
          }, 100);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
    });

    expect(body).toContain(': ping');
  });

  it('rejects with 429 when connection limit exceeded', async () => {
    const app = buildApp('key-limit');
    // Fill up connections with fake clients
    for (let i = 0; i < SseManager.MAX_CONNECTIONS_PER_KEY; i++) {
      SseManager.addClient(`fake-${i}`, 'key-limit', {}, { write: jest.fn() });
    }
    const res = await request(app).get('/stream/feed');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_CONNECTIONS');
  });

  it('rejects invalid minAmount with 400', async () => {
    const res = await request(buildApp()).get('/stream/feed?minAmount=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILTER');
  });

  it('rejects invalid maxAmount with 400', async () => {
    const res = await request(buildApp()).get('/stream/feed?maxAmount=xyz');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_FILTER');
  });

  it('replays missed events on reconnect via Last-Event-ID', async () => {
    // Pre-populate buffer with two events
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 1 });
    SseManager.broadcast('tx.created', { donor: 'A', recipient: 'B', status: 'pending', amount: 2 });
    const firstId = SseManager._eventBuffer[0].id;

    // Connect with Last-Event-ID = firstId; should receive the second event
    const { body } = await collectSse(buildApp(), '/stream/feed', { 'last-event-id': firstId }, 300);
    const events = parseSse(body);
    const txEvents = events.filter(e => e.event === 'tx.created');
    expect(txEvents.length).toBeGreaterThanOrEqual(1);
    expect(txEvents[0].data.amount).toBe(2);
  });

  it('filters events by walletAddress', async () => {
    const app = buildApp('key-filter');
    await new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(0, () => {
        const port = server.address().port;
        const req = http.request({ port, path: '/stream/feed?walletAddress=ALICE', headers: { 'x-api-key': 'test' } }, res => {
          let body = '';
          res.on('data', chunk => { body += chunk; });
          // Wait for the connected event, then broadcast
          setTimeout(() => {
            SseManager.broadcast('tx.created', { donor: 'ALICE', recipient: 'BOB', status: 'pending', amount: 5 });
            SseManager.broadcast('tx.created', { donor: 'CAROL', recipient: 'BOB', status: 'pending', amount: 5 });
            setTimeout(() => {
              req.destroy();
              server.close();
              const events = parseSse(body).filter(e => e.event === 'tx.created');
              try {
                expect(events).toHaveLength(1);
                expect(events[0].data.donor).toBe('ALICE');
                resolve();
              } catch (e) { reject(e); }
            }, 100);
          }, 150);
          res.on('error', reject);
        });
        req.on('error', reject);
        req.end();
      });
    });
  });
});

describe('GET /stream/stats', () => {
  beforeEach(() => SseManager._reset());

  it('returns connection stats', async () => {
    SseManager.addClient('c1', 'k1', {}, { write: jest.fn() });
    const res = await request(buildApp('k1')).get('/stream/stats');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('totalConnections');
    expect(res.body.data).toHaveProperty('connectionsByKey');
  });

  it('returns zero when no connections', async () => {
    const res = await request(buildApp()).get('/stream/stats');
    expect(res.status).toBe(200);
    expect(res.body.data.totalConnections).toBe(0);
  });
});
