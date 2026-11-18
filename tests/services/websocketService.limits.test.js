'use strict';

/**
 * Balance WebSocket hardening (#1981, #1983): payload cap, per-connection message
 * rate limit, and a global connection cap. Uses a real server on an ephemeral port.
 */
const http = require('http');
const WebSocket = require('ws');

describe('balance WebSocket limits (#1981, #1983)', () => {
  const SAVED = { ...process.env };
  let srv;
  let url;

  beforeAll(async () => {
    process.env.API_KEYS = 'ws-limit-test-key';
    process.env.WS_MAX_PAYLOAD_BYTES = '1024';
    process.env.WS_MAX_MESSAGES_PER_SECOND = '5';
    process.env.WS_MAX_CONNECTIONS = '2';
    jest.resetModules();
    const wsService = require('../../src/services/websocketService');
    srv = http.createServer((req, res) => res.end('ok'));
    wsService.attach(srv);
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    url = `ws://127.0.0.1:${srv.address().port}/ws/balances?apiKey=ws-limit-test-key`;
  });

  afterAll(async () => {
    await new Promise((resolve) => srv.close(resolve));
    process.env = SAVED;
  });

  const open = (u) => new Promise((resolve, reject) => {
    const c = new WebSocket(u);
    c.on('open', () => resolve(c));
    c.on('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, retryAfter: res.headers['retry-after'] })));
    c.on('error', reject);
  });

  const closeCode = (c) => new Promise((resolve) => c.on('close', (code) => resolve(code)));

  test('refuses connections above the global cap with 503 and Retry-After', async () => {
    const a = await open(url);
    const b = await open(url);
    const err = await open(url).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.status).toBe(503);
    expect(err.retryAfter).toBe('30');
    a.terminate();
    b.terminate();
  });

  test('closes a connection that sends a frame above WS_MAX_PAYLOAD_BYTES with 1009', async () => {
    const c = await open(url);
    const closed = closeCode(c);
    c.send('x'.repeat(4096));
    expect(await closed).toBe(1009);
  });

  test('drops messages beyond the per-connection rate and reports it', async () => {
    const c = await open(url);
    const received = [];
    c.on('message', (m) => received.push(JSON.parse(m.toString())));
    for (let i = 0; i < 20; i++) c.send(JSON.stringify({ action: 'ping' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(received.some((m) => /Rate limit/.test(m.message || ''))).toBe(true);
    c.terminate();
  });
});
