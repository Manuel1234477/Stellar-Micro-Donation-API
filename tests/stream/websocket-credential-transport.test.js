'use strict';

/**
 * WebSocket balance stream: API key transport (#1942)
 *
 * API keys are accepted in the x-api-key header or the apikey.<key> subprotocol,
 * which keep them out of request URLs. The ?apiKey= query form still works while
 * it is deprecated, and WS_ALLOW_QUERY_API_KEY=false turns it off.
 */

const http = require('http');
const WebSocket = require('ws');
const { attach, subscriptions } = require('../../src/services/websocketService');
const { securityConfig } = require('../../src/config/securityConfig');

const KEY = 'ws-transport-test-key';

function connect(port, path, options = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}${path}`, options.protocols, {
      headers: options.headers || {},
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'connected') resolve({ outcome: 'connected', ws, protocol: ws.protocol });
    });
    ws.on('unexpected-response', (_req, res) => resolve({ outcome: 'rejected', status: res.statusCode }));
    ws.on('error', () => resolve({ outcome: 'error' }));
  });
}

describe('WebSocket API key transport (#1942)', () => {
  let server;
  let wss;
  let port;
  const originalKeys = securityConfig.API_KEYS;
  const originalFlag = process.env.WS_ALLOW_QUERY_API_KEY;

  beforeAll((done) => {
    securityConfig.API_KEYS = [KEY];
    server = http.createServer((req, res) => res.end());
    wss = attach(server);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    securityConfig.API_KEYS = originalKeys;
    if (originalFlag === undefined) delete process.env.WS_ALLOW_QUERY_API_KEY;
    else process.env.WS_ALLOW_QUERY_API_KEY = originalFlag;
    subscriptions.clear();
    wss.close(() => server.close(done));
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.WS_ALLOW_QUERY_API_KEY;
    else process.env.WS_ALLOW_QUERY_API_KEY = originalFlag;
  });

  it('accepts the key from the apikey.<key> subprotocol and selects balances.v1, not the key', async () => {
    const result = await connect(port, '/ws/balances', { protocols: ['balances.v1', `apikey.${KEY}`] });
    expect(result.outcome).toBe('connected');
    expect(result.protocol).toBe('balances.v1');
    result.ws.close();
  });

  it('accepts a client that offers only the apikey.<key> subprotocol (RFC 6455 requires selecting it)', async () => {
    const result = await connect(port, '/ws/balances', { protocols: [`apikey.${KEY}`] });
    expect(result.outcome).toBe('connected');
    result.ws.close();
  });

  it('accepts the key from the x-api-key header', async () => {
    const result = await connect(port, '/ws/balances', { headers: { 'x-api-key': KEY } });
    expect(result.outcome).toBe('connected');
    result.ws.close();
  });

  it('still accepts the deprecated ?apiKey= query form by default', async () => {
    delete process.env.WS_ALLOW_QUERY_API_KEY;
    const result = await connect(port, `/ws/balances?apiKey=${KEY}`);
    expect(result.outcome).toBe('connected');
    result.ws.close();
  });

  it('rejects the ?apiKey= query form when WS_ALLOW_QUERY_API_KEY=false', async () => {
    process.env.WS_ALLOW_QUERY_API_KEY = 'false';
    const result = await connect(port, `/ws/balances?apiKey=${KEY}`);
    expect(result.outcome).not.toBe('connected');
  });

  it('rejects an unknown key sent through the subprotocol', async () => {
    const result = await connect(port, '/ws/balances', { protocols: ['apikey.not-a-real-key'] });
    expect(result.outcome).not.toBe('connected');
  });

  it('rejects a connection that carries no credentials', async () => {
    const result = await connect(port, '/ws/balances');
    expect(result.outcome).not.toBe('connected');
  });
});
