'use strict';

/**
 * Integration test: GraphQL subscriptions (/graphql) and balance streaming
 * (/ws/balances) must both work against ONE HTTP server, and unknown upgrade
 * paths must receive 404. (#1980)
 *
 * Regression: both WebSocket servers previously registered their own 'upgrade'
 * listeners on the same server, and each aborted the other's handshakes.
 */

const http = require('http');
const WebSocket = require('ws');
const { attachSubscriptionServer } = require('../../src/graphql');
const { attach: attachBalanceWs, subscriptions } = require('../../src/services/websocketService');
const { attachUnknownUpgradeFallback } = require('../../src/utils/wsUpgrade');
const { securityConfig } = require('../../src/config/securityConfig');

describe('WebSocket upgrade coexistence on one HTTP server (#1980)', () => {
  let server, graphqlHandle, balanceWss, port, originalKeys;

  beforeAll((done) => {
    originalKeys = securityConfig.API_KEYS;
    securityConfig.API_KEYS = ['coexist-test-key'];

    server = http.createServer((req, res) => res.end());
    graphqlHandle = attachSubscriptionServer(server);
    balanceWss = attachBalanceWs(server);
    attachUnknownUpgradeFallback(server, ['/graphql', '/ws/balances']);
    server.listen(0, () => {
      port = server.address().port;
      done();
    });
  });

  afterAll((done) => {
    securityConfig.API_KEYS = originalKeys;
    subscriptions.clear();
    balanceWss.close(() => {
      graphqlHandle.dispose();
      server.close(done);
    });
  });

  it('completes the handshake for /graphql', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/graphql`, 'graphql-transport-ws');
    ws.on('open', () => { ws.close(); done(); });
    ws.on('error', done);
  });

  it('completes the handshake and emits "connected" for /ws/balances', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=coexist-test-key`);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      if (msg.event === 'connected') { ws.close(); done(); }
    });
    ws.on('error', done);
  });

  it('still serves /ws/balances after a /graphql connection has been made', (done) => {
    const graphqlWs = new WebSocket(`ws://localhost:${port}/graphql`, 'graphql-transport-ws');
    graphqlWs.on('open', () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws/balances?apiKey=coexist-test-key`);
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw);
        if (msg.event === 'connected') {
          ws.close();
          graphqlWs.close();
          done();
        }
      });
      ws.on('error', done);
    });
    graphqlWs.on('error', done);
  });

  it('rejects an unknown upgrade path with 404', (done) => {
    const ws = new WebSocket(`ws://localhost:${port}/not-a-real-socket`);
    ws.on('unexpected-response', (req, res) => {
      expect(res.statusCode).toBe(404);
      res.resume();
      done();
    });
    ws.on('open', () => done(new Error('unknown path must not upgrade')));
    ws.on('error', () => {});
  });
});
