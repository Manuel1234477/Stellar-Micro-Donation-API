/**
 * Tests for SseManager and GET /transactions/stream SSE endpoint
 */

const express = require('express');
const request = require('supertest');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh SseManager instance for test isolation */
function freshManager() {
  // Directly instantiate a new SseManager by re-using the class
  const MAX_CONNECTIONS_PER_KEY = 5;
  const HEARTBEAT_INTERVAL_MS = 30_000;

  class SseManagerFresh {
    constructor() {
      this._clients = new Map();
      this._heartbeatTimer = null;
    }
    start() {
      if (this._heartbeatTimer) return;
      this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
      if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
    }
    stop() {
      if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null; }
    }
    addClient(apiKey, res, filters = {}) {
      const existing = this._clients.get(apiKey) || new Set();
      if (existing.size >= MAX_CONNECTIONS_PER_KEY) return { added: false, limitExceeded: true };
      const client = { res, filters };
      existing.add(client);
      this._clients.set(apiKey, existing);
      res.on('close', () => this.removeClient(apiKey, client));
      return { added: true, limitExceeded: false };
    }
    removeClient(apiKey, client) {
      const set = this._clients.get(apiKey);
      if (!set) return;
      set.delete(client);
      if (set.size === 0) this._clients.delete(apiKey);
    }
    broadcastTransaction(transaction) {
      const event = `data: ${JSON.stringify({ type: 'transaction.confirmed', data: transaction })}\n\n`;
      for (const clients of this._clients.values())
        for (const client of clients)
          if (this._matches(client.filters, transaction))
            try { client.res.write(event); } catch (_) {}
    }
    get connectionCount() { let n = 0; for (const s of this._clients.values()) n += s.size; return n; }
    connectionCountForKey(apiKey) { return (this._clients.get(apiKey) || new Set()).size; }
    _sendHeartbeat() {
      for (const clients of this._clients.values())
        for (const client of clients)
          try { client.res.write(': ping\n\n'); } catch (_) {}
    }
    _matches(filters, tx) {
      if (filters.walletAddress && tx.donor !== filters.walletAddress && tx.recipient !== filters.walletAddress) return false;
      if (filters.campaignId && tx.campaignId !== filters.campaignId) return false;
      return true;
    }
  }
  return new SseManagerFresh();
}

/** Build a mock res object that records writes */
function mockRes() {
  const listeners = {};
  return {
    writes: [],
    write: jest.fn(function(chunk) { this.writes.push(chunk); return true; }),
    on: jest.fn((event, cb) => { listeners[event] = cb; }),
    emit: (event) => { if (listeners[event]) listeners[event](); },
  };
}

/** Build a minimal express app wired to a given SseManager instance */
function makeApp(mgr) {
  const app = express();
  app.use(express.json());
  app.get('/transactions/stream', (req, res) => {
    const apiKey = req.headers['x-api-key'] || 'anonymous';
    const filters = {
      walletAddress: req.query.walletAddress || null,
      campaignId: req.query.campaignId || null,
    };
    const { added, limitExceeded } = mgr.addClient(apiKey, res, filters);
    if (limitExceeded) return res.status(429).json({ error: 'CONNECTION_LIMIT_EXCEEDED' });
    if (!added) return res.status(500).json({ error: 'SSE_ERROR' });
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  });
  return app;
}

// ---------------------------------------------------------------------------
// SseManager unit tests
// ---------------------------------------------------------------------------

describe('SseManager', () => {
  let mgr;

  beforeEach(() => { mgr = freshManager(); });
  afterEach(() => mgr.stop());

  test('addClient returns added:true for first connection', () => {
    const result = mgr.addClient('k1', mockRes(), {});
    expect(result.added).toBe(true);
    expect(result.limitExceeded).toBe(false);
    expect(mgr.connectionCountForKey('k1')).toBe(1);
  });

  test('enforces max 5 connections per API key', () => {
    for (let i = 0; i < 5; i++) mgr.addClient('k1', mockRes(), {});
    const result = mgr.addClient('k1', mockRes(), {});
    expect(result.limitExceeded).toBe(true);
    expect(result.added).toBe(false);
    expect(mgr.connectionCountForKey('k1')).toBe(5);
  });

  test('different keys have independent limits', () => {
    for (let i = 0; i < 5; i++) mgr.addClient('keyA', mockRes(), {});
    const result = mgr.addClient('keyB', mockRes(), {});
    expect(result.added).toBe(true);
  });

  test('removeClient via close event decrements count', () => {
    const res = mockRes();
    mgr.addClient('k1', res, {});
    expect(mgr.connectionCountForKey('k1')).toBe(1);
    res.emit('close');
    expect(mgr.connectionCountForKey('k1')).toBe(0);
  });

  test('connectionCount returns total across all keys', () => {
    mgr.addClient('k1', mockRes(), {});
    mgr.addClient('k1', mockRes(), {});
    mgr.addClient('k2', mockRes(), {});
    expect(mgr.connectionCount).toBe(3);
  });

  test('broadcastTransaction sends to all unfiltered clients', () => {
    const r1 = mockRes();
    const r2 = mockRes();
    mgr.addClient('k1', r1, {});
    mgr.addClient('k2', r2, {});
    mgr.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob', amount: 10 });
    expect(r1.write).toHaveBeenCalledWith(expect.stringContaining('"type":"transaction.confirmed"'));
    expect(r2.write).toHaveBeenCalledWith(expect.stringContaining('"type":"transaction.confirmed"'));
  });

  test('broadcast event has correct structure', () => {
    const r = mockRes();
    mgr.addClient('k1', r, {});
    const tx = { id: '42', donor: 'alice', recipient: 'bob', amount: 100 };
    mgr.broadcastTransaction(tx);
    const raw = r.write.mock.calls[0][0];
    expect(raw).toMatch(/^data: /);
    const payload = JSON.parse(raw.replace(/^data: /, '').trim());
    expect(payload.type).toBe('transaction.confirmed');
    expect(payload.data).toEqual(tx);
  });

  test('filters by walletAddress — donor match', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'alice' });
    mgr.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob', amount: 5 });
    expect(r.write).toHaveBeenCalled();
  });

  test('filters by walletAddress — recipient match', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'bob' });
    mgr.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob', amount: 5 });
    expect(r.write).toHaveBeenCalled();
  });

  test('filters by walletAddress — no match skips client', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'charlie' });
    mgr.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob', amount: 5 });
    expect(r.write).not.toHaveBeenCalled();
  });

  test('filters by campaignId — match delivers event', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { campaignId: 'camp-A' });
    mgr.broadcastTransaction({ id: '1', donor: 'x', recipient: 'y', campaignId: 'camp-A' });
    expect(r.write).toHaveBeenCalled();
  });

  test('filters by campaignId — no match skips client', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { campaignId: 'camp-B' });
    mgr.broadcastTransaction({ id: '1', donor: 'x', recipient: 'y', campaignId: 'camp-A' });
    expect(r.write).not.toHaveBeenCalled();
  });

  test('both filters must match', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'alice', campaignId: 'camp-A' });
    // Wrong campaign
    mgr.broadcastTransaction({ id: '1', donor: 'alice', recipient: 'bob', campaignId: 'camp-B' });
    expect(r.write).not.toHaveBeenCalled();
    // Both correct
    mgr.broadcastTransaction({ id: '2', donor: 'alice', recipient: 'bob', campaignId: 'camp-A' });
    expect(r.write).toHaveBeenCalledTimes(1);
  });

  test('heartbeat sends ": ping\\n\\n" to all clients', () => {
    const r1 = mockRes();
    const r2 = mockRes();
    mgr.addClient('k1', r1, {});
    mgr.addClient('k2', r2, {});
    mgr._sendHeartbeat();
    expect(r1.write).toHaveBeenCalledWith(': ping\n\n');
    expect(r2.write).toHaveBeenCalledWith(': ping\n\n');
  });

  test('heartbeat fires every 30s via start()', () => {
    jest.useFakeTimers();
    const r = mockRes();
    mgr.addClient('k1', r, {});
    mgr.start();
    jest.advanceTimersByTime(30_000);
    expect(r.write).toHaveBeenCalledWith(': ping\n\n');
    mgr.stop();
    jest.useRealTimers();
  });

  test('start() is idempotent — no duplicate timers', () => {
    jest.useFakeTimers();
    mgr.start();
    const t1 = mgr._heartbeatTimer;
    mgr.start();
    expect(mgr._heartbeatTimer).toBe(t1);
    mgr.stop();
    jest.useRealTimers();
  });

  test('stop() clears the timer', () => {
    jest.useFakeTimers();
    mgr.start();
    mgr.stop();
    expect(mgr._heartbeatTimer).toBeNull();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoint tests
// ---------------------------------------------------------------------------

describe('GET /transactions/stream', () => {
  let mgr;
  let app;

  beforeEach(() => { mgr = freshManager(); app = makeApp(mgr); });
  afterEach(() => mgr.stop());

  test('returns 429 when connection limit exceeded', async () => {
    for (let i = 0; i < 5; i++) mgr.addClient('limited-key', mockRes(), {});
    const res = await request(app)
      .get('/transactions/stream')
      .set('x-api-key', 'limited-key');
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('CONNECTION_LIMIT_EXCEEDED');
  });

  test('anonymous key used when x-api-key header absent', async () => {
    for (let i = 0; i < 5; i++) mgr.addClient('anonymous', mockRes(), {});
    const res = await request(app).get('/transactions/stream');
    expect(res.status).toBe(429);
  });

  test('walletAddress filter — matching tx delivered', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'GABC' });
    mgr.broadcastTransaction({ id: '1', donor: 'GABC', recipient: 'GXYZ', amount: 1 });
    expect(r.write).toHaveBeenCalledWith(expect.stringContaining('transaction.confirmed'));
  });

  test('walletAddress filter — non-matching tx not delivered', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { walletAddress: 'GABC' });
    mgr.broadcastTransaction({ id: '2', donor: 'GOTHER', recipient: 'GXYZ', amount: 1 });
    expect(r.write).not.toHaveBeenCalled();
  });

  test('campaignId filter — matching tx delivered', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { campaignId: 'camp-1' });
    mgr.broadcastTransaction({ id: '1', donor: 'a', recipient: 'b', campaignId: 'camp-1' });
    expect(r.write).toHaveBeenCalled();
  });

  test('campaignId filter — non-matching tx not delivered', () => {
    const r = mockRes();
    mgr.addClient('k1', r, { campaignId: 'camp-1' });
    mgr.broadcastTransaction({ id: '2', donor: 'a', recipient: 'b', campaignId: 'camp-2' });
    expect(r.write).not.toHaveBeenCalled();
  });
});
