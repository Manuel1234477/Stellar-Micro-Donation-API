'use strict';

/**
 * Global SSE connection cap (#1983). Refused streams get 503 + Retry-After, and
 * the per-key limit is still enforced independently.
 */
describe('SseManager global connection cap (#1983)', () => {
  const SAVED = { ...process.env };
  let SseManager;

  const fakeRes = () => ({ on() {}, write() {}, end() {}, setHeader() {} });

  beforeEach(() => {
    jest.resetModules();
    process.env.SSE_MAX_CONNECTIONS = '2';
    process.env.SSE_MAX_CONNECTIONS_PER_KEY = '10';
    SseManager = require('../../src/services/SseManager');
  });

  afterEach(() => {
    SseManager.stop();
    SseManager._clients.clear();
    process.env = { ...SAVED };
  });

  test('refuses a stream above the global cap and flags it as global', () => {
    expect(SseManager.addClient('a', 'k1', {}, fakeRes()).added).toBe(true);
    expect(SseManager.addClient('b', 'k2', {}, fakeRes()).added).toBe(true);
    const refused = SseManager.addClient('c', 'k3', {}, fakeRes());
    expect(refused.added).toBe(false);
    expect(refused.limitExceeded).toBe(true);
    expect(refused.globalLimit).toBe(true);
  });

  test('frees capacity when a stream is removed', () => {
    const first = SseManager.addClient('a', 'k1', {}, fakeRes());
    SseManager.addClient('b', 'k2', {}, fakeRes());
    SseManager.removeClient('a', first.client);
    expect(SseManager.addClient('c', 'k3', {}, fakeRes()).added).toBe(true);
  });

  test('sendGlobalLimitResponse returns 503 with Retry-After', () => {
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } };
    SseManager.sendGlobalLimitResponse(res);
    expect(res.code).toBe(503);
    expect(res.headers['Retry-After']).toBe('30');
    expect(res.body.error.code).toBe('STREAM_CAPACITY_EXCEEDED');
  });
});
