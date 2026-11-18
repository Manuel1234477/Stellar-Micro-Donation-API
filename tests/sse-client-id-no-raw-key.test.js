/**
 * SSE client id secrecy tests (Issue #1894)
 *
 * SSE client ids are written to logs, metrics labels and admin endpoints,
 * so they must never embed the raw API key.
 */

const sseManager = require('../src/services/SseManager');

function fakeRes() {
  const listeners = {};
  return {
    write: jest.fn(),
    end: jest.fn(),
    on: jest.fn((event, fn) => { listeners[event] = fn; }),
    _listeners: listeners,
  };
}

describe('SseManager client ids (Issue #1894)', () => {
  const RAW_KEY = 'sk_live_super_secret_raw_key_value_1234567890';

  afterEach(() => {
    for (const id of [...sseManager._clients.keys()]) {
      sseManager.removeClient(id);
    }
  });

  it('does not embed the raw API key in the generated client id', () => {
    const res = fakeRes();
    const result = sseManager.addClient(RAW_KEY, res, {});

    expect(result.added).toBe(true);
    expect(result.client.clientId).not.toContain(RAW_KEY);
    expect(result.client.clientId).not.toContain(RAW_KEY.slice(0, 16));
  });

  it('does not store the raw API key on the client object', () => {
    const res = fakeRes();
    const result = sseManager.addClient(RAW_KEY, res, {});

    const stored = JSON.stringify(result.client);
    expect(stored).not.toContain(RAW_KEY);
  });

  it('keeps the per-key connection limit working without the raw key in ids', () => {
    const keyId = 'key-id-limit-test';
    const limit = sseManager.constructor.MAX_CONNECTIONS_PER_KEY
      || require('../src/services/SseManager').MAX_CONNECTIONS_PER_KEY
      || 5;

    const added = [];
    for (let i = 0; i < limit; i++) {
      added.push(sseManager.addClient(keyId, fakeRes(), {}));
    }
    expect(added.every(r => r.added)).toBe(true);
    expect(sseManager.addClient(keyId, fakeRes(), {})).toEqual({ added: false, limitExceeded: true });
  });
});
