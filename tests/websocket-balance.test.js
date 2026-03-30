'use strict';

/**
 * Tests for src/services/websocketService.js  (Issue #410)
 */

const http = require('http');
const WebSocket = require('ws');
const {
  broadcast,
  subscriptions,
  _handleMessage: handleMessage,
  _authenticate: authenticate,
  _runHeartbeat: runHeartbeat,
  attach,
} = require('../src/services/websocketService');

// ── helpers ───────────────────────────────────────────────────────────────────

function makeWs(extra = {}) {
  return {
    readyState: WebSocket.OPEN,
    _wallets: new Set(),
    _alive: true,
    _sent: [],
    _terminated: false,
    send(msg) { this._sent.push(JSON.parse(msg)); },
    terminate() { this._terminated = true; },
    ping() {},
    constructor: { OPEN: WebSocket.OPEN },
    ...extra,
  };
}

// ── authenticate ──────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('returns null for missing key', async () => {
    expect(await authenticate(null)).toBeNull();
    expect(await authenticate('')).toBeNull();
  });

  it('returns null for an invalid key', async () => {
    expect(await authenticate('totally-invalid-key-xyz')).toBeNull();
  });

  it('accepts a legacy env key', async () => {
    const { securityConfig } = require('../src/config/securityConfig');
    const original = securityConfig.API_KEYS;
    securityConfig.API_KEYS = ['test-legacy-key'];
    const result = await authenticate('test-legacy-key');
    securityConfig.API_KEYS = original;
    expect(result).not.toBeNull();
    expect(result.role).toBe('user');
  });
});

// ── handleMessage — subscribe ─────────────────────────────────────────────────

describe('handleMessage subscribe', () => {
  afterEach(() => subscriptions.clear());

  it('adds wallets to subscriptions', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA1', 'GA2'] }));
    expect(subscriptions.has('GA1')).toBe(true);
    expect(subscriptions.has('GA2')).toBe(true);
    expect(ws._wallets.has('GA1')).toBe(true);
  });

  it('enforces MAX_WALLETS limit', () => {
    const ws = makeWs();
    const wallets = Array.from({ length: 60 }, (_, i) => `GA${i}`);
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets }));
    expect(ws._wallets.size).toBeLessThanOrEqual(50);
    expect(ws._sent.some(m => m.event === 'error')).toBe(true);
  });

  it('does not exceed limit across multiple subscribe calls', () => {
    const ws = makeWs();
    const first = Array.from({ length: 50 }, (_, i) => `GA${i}`);
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: first }));
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['EXTRA'] }));
    expect(ws._wallets.size).toBe(50);
  });

  it('ignores malformed JSON', () => {
    const ws = makeWs();
    expect(() => handleMessage(ws, 'not-json')).not.toThrow();
  });

  it('ignores messages with no wallets array', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe' }));
    expect(subscriptions.size).toBe(0);
  });

  it('ignores messages with empty wallets array', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: [] }));
    expect(subscriptions.size).toBe(0);
  });
});

// ── handleMessage — unsubscribe ───────────────────────────────────────────────

describe('handleMessage unsubscribe', () => {
  afterEach(() => subscriptions.clear());

  it('removes wallet from subscriptions', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA1'] }));
    handleMessage(ws, JSON.stringify({ action: 'unsubscribe', wallets: ['GA1'] }));
    expect(subscriptions.has('GA1')).toBe(false);
    expect(ws._wallets.has('GA1')).toBe(false);
  });

  it('cleans up empty sets from the map', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA1'] }));
    handleMessage(ws, JSON.stringify({ action: 'unsubscribe', wallets: ['GA1'] }));
    expect(subscriptions.size).toBe(0);
  });

  it('is a no-op for unsubscribed wallet', () => {
    const ws = makeWs();
    expect(() => handleMessage(ws, JSON.stringify({ action: 'unsubscribe', wallets: ['NONE'] }))).not.toThrow();
  });
});

// ── broadcast ─────────────────────────────────────────────────────────────────

describe('broadcast', () => {
  afterEach(() => subscriptions.clear());

  it('sends balance_update to subscribed clients', () => {
    const ws = makeWs();
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA1'] }));
    broadcast('GA1', { new_balance: '50.00', asset: 'XLM' });
    expect(ws._sent).toContainEqual({ event: 'balance_update', wallet: 'GA1', new_balance: '50.00', asset: 'XLM' });
  });

  it('does not send to closed connections', () => {
    const ws = makeWs({ readyState: WebSocket.CLOSED });
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA1'] }));
    broadcast('GA1', { new_balance: '10', asset: 'XLM' });
    expect(ws._sent.filter(m => m.event === 'balance_update').length).toBe(0);
  });

  it('is a no-op for unsubscribed wallet', () => {
    expect(() => broadcast('UNKNOWN', { new_balance: '0', asset: 'XLM' })).not.toThrow();
  });

  it('does not send when readyState is CONNECTING', () => {
    const ws = makeWs({ readyState: WebSocket.CONNECTING });
    handleMessage(ws, JSON.stringify({ action: 'subscribe', wallets: ['GA_CONN'] }));
    broadcast('GA_CONN', { new_balance: '1', asset: 'XLM' });
    expect(ws._sent.filter(m => m.event === 'balance_update').length).toBe(0);
  });
});

// ── heartbeat ─────────────────────────────────────────────────────────────────

describe('runHeartbeat', () => {
  it('terminates clients that did not pong', () => {
    const dead = makeWs({ _alive: false });
    runHeartbeat([dead]);
    expect(dead._terminated).toBe(true);
  });

  it('pings alive clients and resets _alive flag', () => {
    const alive = makeWs({ _alive: true });
    const pinged = [];
    alive.ping = () => pinged.push(true);
    runHeartbeat([alive]);
    expect(alive._alive).toBe(false);
    expect(pinged.length).toBe(1);
  });
});

// ── donation.confirmed event hook ─────────────────────────────────────────────

describe('donation.confirmed hook', () => {
  afterEach(() => subscriptions.clear());

  it('broadcasts to sender and receiver on confirmed donation', () => {
    const sender = makeWs();
    const receiver = makeWs();
    handleMessage(sender,   JSON.stringify({ action: 'subscribe', wallets: ['SENDER'] }));
    handleMessage(receiver, JSON.stringify({ action: 'subscribe', wallets: ['RECEIVER'] }));

    const donationEvents = require('../src/events/donationEvents');
    donationEvents.emit('donation.confirmed', {
      senderAddress: 'SENDER',
      receiverAddress: 'RECEIVER',
      amount: '25.00',
      asset: 'XLM',
    });

    expect(sender._sent.some(m => m.event === 'balance_update' && m.wallet === 'SENDER')).toBe(true);
    expect(receiver._sent.some(m => m.event === 'balance_update' && m.wallet === 'RECEIVER')).toBe(true);
  });

  it('handles confirmed event with no addresses gracefully', () => {
    const donationEvents = require('../src/events/donationEvents');
    expect(() => donationEvents.emit('donation.confirmed', {})).not.toThrow();
  });

  it('handles confirmed event with null payload gracefully', () => {
    const donationEvents = require('../src/events/donationEvents');
    expect(() => donationEvents.emit('donation.confirmed', null)).not.toThrow();
  });
});

// ── integration: upgrade + close clears subscriptions ────────────────────────

describe('WebSocket server integration', () => {
  let server, wss, port;

  beforeAll((done) => {
    const { securityConfig } = require('../src/config/securityConfig');
    securityConfig.API_KEYS = ['int-test-key'];

    server = http.createServer((req, res) => res.end());
    wss = attach(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    subscriptions.clear();
    wss.close(() => server.close(done));
  });

  it('rejects connection with invalid API key', (done) => {
    let finished = false;
    const finish = (code) => {
      if (finished) return;
      finished = true;
      expect([4001, 1006]).toContain(code);
      done();
    };
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=bad-key`);
    ws.on('error', () => finish(1006));
    ws.on('close', (code) => finish(code));
  });

  it('accepts auth via x-api-key header', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances`, {
      headers: { 'x-api-key': 'int-test-key' },
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'connected') { ws.close(); done(); }
    });
    ws.on('error', done);
  });

  it('destroys non-ws-balances upgrade requests', (done) => {
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    const ws = new WebSocket(`ws://localhost:${port}/other-path`);
    ws.on('error', finish);
    ws.on('close', finish);
  });

  it('accepts connection with valid API key and receives connected event', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=int-test-key`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'connected') { ws.close(); done(); }
    });
    ws.on('error', done);
  });

  it('receives balance_update after subscribing', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=int-test-key`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'subscribe', wallets: ['WALLET_INT'] }));
      setTimeout(() => broadcast('WALLET_INT', { new_balance: '99.00', asset: 'XLM' }), 50);
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'balance_update') {
        expect(msg.wallet).toBe('WALLET_INT');
        expect(msg.new_balance).toBe('99.00');
        ws.close();
        done();
      }
    });
    ws.on('error', done);
  });

  it('clears subscriptions when connection closes', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=int-test-key`);
    ws.on('open', () => {
      ws.send(JSON.stringify({ action: 'subscribe', wallets: ['WALLET_CLOSE'] }));
      setTimeout(() => {
        expect(subscriptions.has('WALLET_CLOSE')).toBe(true);
        ws.close();
        setTimeout(() => {
          expect(subscriptions.has('WALLET_CLOSE')).toBe(false);
          done();
        }, 100);
      }, 100);
    });
    ws.on('error', done);
  });
});
