'use strict';

/**
 * WebSocketService — real-time balance streaming (Issue #410)
 *
 * Protocol:
 *   connect  ws://host/ws/balances
 *            with the key in one of (preferred first):
 *              - header            x-api-key: <key>
 *              - subprotocol       Sec-WebSocket-Protocol: apikey.<key>
 *              - query (DEPRECATED) ?apiKey=<key>   (#1942)
 *   → send   {"action":"subscribe","wallets":["GA...","GB..."]}
 *   → recv   {"event":"balance_update","wallet":"GA...","new_balance":"100.00","asset":"XLM"}
 *   → send   {"action":"unsubscribe","wallets":["GA..."]}
 *
 * Cross-instance broadcast (#1136):
 *   Broadcasts flow through a pluggable WsChannel. The default channel uses
 *   an in-process EventEmitter (single instance). To enable cross-instance
 *   delivery set REDIS_URL and install ioredis; then replace the channel
 *   returned by _createChannel() with a Redis pub/sub adapter that implements
 *   the same { publish, subscribe } interface.
 *
 * Opt-out / limits:
 *   MAX_WALLETS_PER_CONNECTION = 50
 *   Heartbeat every 30 s (ping/pong)
 *   Close code 4001 = Unauthorized
 */

const { EventEmitter } = require('events');
const { WebSocketServer } = require('ws');
const { upgradePathname } = require('../utils/wsUpgrade');
const { validateKey } = require('../models/apiKeys');
const { securityConfig } = require('../config/securityConfig');
const donationEvents = require('../events/donationEvents');
const log = require('../utils/log');
const { env } = require('../config/env');
const { streamConnectionsActive, streamConnectionsRejectedTotal } = require('../utils/metrics');
const { createTokenBucket } = require('../utils/tokenBucket');
const { safeEqual } = require('../utils/safeEqual');

// Subprotocol prefix that carries an API key in the WebSocket handshake (#1942).
// Subprotocol values are not written to request URLs, so they stay out of access
// logs, proxy logs and Referer headers. Clients should also offer BALANCE_SUBPROTOCOL,
// which the server selects so the key is not echoed back in the handshake response.
const API_KEY_SUBPROTOCOL_PREFIX = 'apikey.';
const BALANCE_SUBPROTOCOL = 'balances.v1';

// Deprecation switch for the ?apiKey= query parameter (#1942). Defaults to
// accepting it, with a warning, so existing clients keep working. Set to
// "false" to reject query-string keys.
const queryApiKeyAllowed = () => process.env.WS_ALLOW_QUERY_API_KEY !== 'false';

const MAX_WALLETS = parseInt(process.env.WS_MAX_WALLETS || '50', 10);
const HEARTBEAT_MS = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);
// Abuse limits (#1981, #1983)
const MAX_PAYLOAD_BYTES = env.WS_MAX_PAYLOAD_BYTES;
const MAX_CONNECTIONS = env.WS_MAX_CONNECTIONS;
const MAX_MESSAGES_PER_SECOND = env.WS_MAX_MESSAGES_PER_SECOND;
const CAPACITY_RETRY_AFTER_SECONDS = 30;
const STREAMS = new Map();

// Map<walletAddress, Set<WebSocket>> — local subscriber routing for this instance
const activeServers = new Set();
const subscriptions = new Map();

// ── Pub/sub channel abstraction ───────────────────────────────────────────────
//
// The channel decouples event producers from local WS delivery so that, in a
// multi-instance deployment, a Redis-backed channel can be swapped in without
// changing any other code.  Both instances publish to the channel; both
// instances' channel subscriptions fan out to their locally-connected clients.
//
// Default: in-process EventEmitter (works for a single instance or a local dev
// environment with no external broker).

function _createChannel() {
  const emitter = new EventEmitter();
  return {
    publish(topic, payload) {
      emitter.emit(topic, payload);
    },
    subscribe(topic, handler) {
      emitter.on(topic, handler);
    },
  };
}

const channel = _createChannel();

const WS_TOPIC = 'ws:balance_update';

// Fan published events out to locally-connected WebSocket clients
channel.subscribe(WS_TOPIC, ({ wallet, payload }) => {
  _broadcastLocal(wallet, payload);
});

// ── internal helpers ──────────────────────────────────────────────────────────

function send(ws, obj) {
  if (ws.readyState === ws.constructor.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function normalizeBalancePayload(address, payload = {}) {
  const balance = payload.balance ?? payload.new_balance ?? payload.value ?? '0';
  return {
    type: 'balance_update',
    event: 'balance_update',
    address,
    wallet: address,
    balance: String(balance),
    ...(payload.asset ? { asset: payload.asset } : {}),
  };
}

function addSub(wallet, ws) {
  if (!subscriptions.has(wallet)) subscriptions.set(wallet, new Set());
  subscriptions.get(wallet).add(ws);
  if (subscriptions.get(wallet).size === 1) {
    ensureBalanceStream(wallet);
  }
}

function removeSub(wallet, ws) {
  const set = subscriptions.get(wallet);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    subscriptions.delete(wallet);
    stopBalanceStream(wallet);
  }
}

function removeAllSubs(ws) {
  for (const [wallet, set] of subscriptions) {
    set.delete(ws);
    if (set.size === 0) {
      subscriptions.delete(wallet);
      stopBalanceStream(wallet);
    }
  }
}

function ensureBalanceStream(address) {
  if (STREAMS.has(address)) return;

  let closeStream = () => {};
  try {
    const { serviceContainer } = require('../config/serviceContainer');
    const stellar = serviceContainer?.getStellarService ? serviceContainer.getStellarService() : null;
    const horizon = stellar && stellar.server ? stellar.server : null;
    if (horizon && typeof horizon.accounts === 'function') {
      closeStream = horizon.accounts().accountId(address).stream({
        onmessage: (account) => {
          const native = Array.isArray(account?.balances)
            ? account.balances.find((balance) => balance.asset_type === 'native')
            : null;
          if (native && native.balance !== undefined) {
            broadcast(address, { balance: String(native.balance), asset: 'XLM' });
          }
        },
        onerror: (error) => {
          log.warn('WS', 'Balance stream error for address', { address, error: error.message || String(error) });
        },
      });
    }
  } catch (error) {
    log.warn('WS', 'Unable to attach Horizon balance stream', { address, error: error.message });
  }

  STREAMS.set(address, { closeStream });
}

function stopBalanceStream(address) {
  const entry = STREAMS.get(address);
  if (!entry) return;
  try { entry.closeStream(); } catch (error) { log.warn('WS', 'Failed to close Horizon balance stream', { address, error: error.message }); }
  STREAMS.delete(address);
}

// Send a balance_update event to all local WS clients subscribed to wallet
function _broadcastLocal(wallet, payload) {
  const set = subscriptions.get(wallet);
  if (!set) return;
  const msg = JSON.stringify(normalizeBalancePayload(wallet, payload));
  for (const ws of set) {
    if (ws.readyState === ws.constructor.OPEN) ws.send(msg);
  }
}

// ── auth ──────────────────────────────────────────────────────────────────────

async function authenticate(apiKey) {
  if (!apiKey) return null;

  // DB-backed key
  try {
    const info = await validateKey(apiKey);
    if (info) return info;
  } catch (_) { /* fall through */ }

  // Legacy env keys (constant-time comparison, #1942)
  const legacyKeys = securityConfig.API_KEYS || [];
  if (legacyKeys.some((legacyKey) => safeEqual(apiKey, legacyKey))) return { role: 'user', id: null };

  return null;
}

/**
 * Reads the API key from the upgrade request, preferring non-URL transports.
 *
 * @returns {{ apiKey: string|null, source: 'header'|'subprotocol'|'query'|null }}
 */
function extractCredentials(req) {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) {
    return { apiKey: headerKey.trim(), source: 'header' };
  }

  const offered = String(req.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((p) => p.trim());
  const keyProtocol = offered.find((p) => p.startsWith(API_KEY_SUBPROTOCOL_PREFIX));
  if (keyProtocol && keyProtocol.length > API_KEY_SUBPROTOCOL_PREFIX.length) {
    return { apiKey: keyProtocol.slice(API_KEY_SUBPROTOCOL_PREFIX.length), source: 'subprotocol' };
  }

  const url = new URL(req.url, 'http://localhost');
  const queryKey = url.searchParams.get('apiKey');
  if (queryKey) return { apiKey: queryKey, source: 'query' };

  return { apiKey: null, source: null };
}

// ── message handler ───────────────────────────────────────────────────────────

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }

  const isBalanceSubscribe = msg && (msg.subscribe === 'balance' || msg.subscribe === 'balances');
  const balanceAddress = isBalanceSubscribe ? (msg.address || msg.wallet) : null;
  if (isBalanceSubscribe && balanceAddress) {
    const current = ws._wallets.size;
    if (current >= MAX_WALLETS) {
      send(ws, { type: 'error', event: 'error', message: `Subscription limit is ${MAX_WALLETS} wallets` });
      return;
    }
    ws._wallets.add(balanceAddress);
    addSub(balanceAddress, ws);
    send(ws, { type: 'subscribed', event: 'subscribed', address: balanceAddress, subscribe: 'balance' });
    return;
  }

  const { action, wallets, address } = msg;
  const legacyWallets = Array.isArray(wallets) ? wallets : [];
  const subscribeAddress = !legacyWallets.length && action === 'subscribe' && address ? [address] : [];
  const effectiveWallets = legacyWallets.length ? legacyWallets : subscribeAddress;
  if (!effectiveWallets.length) return;

  if (action === 'subscribe') {
    const current = ws._wallets.size;
    const toAdd = effectiveWallets.slice(0, MAX_WALLETS - current);
    for (const w of toAdd) {
      ws._wallets.add(w);
      addSub(w, ws);
    }
    if (effectiveWallets.length > toAdd.length) {
      send(ws, { type: 'error', event: 'error', message: `Subscription limit is ${MAX_WALLETS} wallets` });
    }
  } else if (action === 'unsubscribe') {
    for (const w of effectiveWallets) {
      ws._wallets.delete(w);
      removeSub(w, ws);
    }
  }
}

// ── broadcast ─────────────────────────────────────────────────────────────────

/**
 * Publish a balance_update for wallet through the shared channel.
 * On a single instance this is equivalent to a direct local delivery;
 * with a Redis-backed channel all instances receive the event.
 *
 * @param {string} wallet
 * @param {Object} payload - e.g. { new_balance, asset }
 */
function broadcast(wallet, payload) {
  channel.publish(WS_TOPIC, { wallet, payload });
  _broadcastLocal(wallet, payload);
}

// ── donation event hook ───────────────────────────────────────────────────────

donationEvents.on(donationEvents.constructor.EVENTS
  ? donationEvents.constructor.EVENTS.CONFIRMED
  : 'donation.confirmed', (payload) => {
  const { senderAddress, receiverAddress, amount, asset = 'XLM' } = payload || {};
  if (senderAddress)   broadcast(senderAddress,   { new_balance: String(amount || ''), asset });
  if (receiverAddress) broadcast(receiverAddress,  { new_balance: String(amount || ''), asset });
});

// ── heartbeat tick (exported for testing) ─────────────────────────────────────

function runHeartbeat(clients) {
  for (const ws of clients) {
    if (!ws._alive) { ws.terminate(); continue; }
    ws._alive = false;
    ws.ping();
  }
}

// ── server factory ────────────────────────────────────────────────────────────

function attach(server) {
  // Prefer the fixed balances.v1 token. If the client offered only apikey.<key>,
  // RFC 6455 requires selecting one of the offered tokens, so that one is echoed.
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_PAYLOAD_BYTES,
    handleProtocols: (protocols) => (protocols.has(BALANCE_SUBPROTOCOL)
      ? BALANCE_SUBPROTOCOL
      : protocols.values().next().value),
  });

  // maxPayload: ws buffers whole frames in memory; the default is 100 MiB (#1981).
  // Frames above the limit close the socket with code 1009.

  const updateGauge = () => streamConnectionsActive.set({ transport: 'ws_balances' }, wss.clients.size);

  // Reject early, before doing any authentication work, when at the global cap (#1983).
  const rejectAtCapacity = (socket) => {
    streamConnectionsRejectedTotal.inc({ transport: 'ws_balances' });
    socket.write(
      `HTTP/1.1 503 Service Unavailable\r\nRetry-After: ${CAPACITY_RETRY_AFTER_SECONDS}\r\nConnection: close\r\n\r\n`
    );
    socket.destroy();
  };

  server.on('upgrade', async (req, socket, head) => {
    // Only handle our own path. Other upgrades belong to other transports (GraphQL)
    // or to the unknown-path fallback in bootstrap/server.js. (#1980)
    if (upgradePathname(req) !== '/ws/balances') return;

    let credentials;
    try {
      credentials = extractCredentials(req);
    } catch (_) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    if (wss.clients.size >= MAX_CONNECTIONS) {
      rejectAtCapacity(socket);
      return;
    }

    if (credentials.source === 'query') {
      if (!queryApiKeyAllowed()) {
        log.warn('WS', 'Rejected WebSocket connection: API key in query string is disabled (WS_ALLOW_QUERY_API_KEY=false)');
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      log.warn('WS', 'Deprecated: API key sent in WebSocket URL. Use the x-api-key header or the apikey.<key> subprotocol.');
    }

    const keyInfo = await authenticate(credentials.apiKey);
    if (!keyInfo) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // Re-check: concurrent upgrades can pass the first check while authenticating.
      // ws adds this socket to wss.clients before invoking the callback, so the
      // count already includes it and the comparison must be strict (#1983).
      if (wss.clients.size > MAX_CONNECTIONS) {
        streamConnectionsRejectedTotal.inc({ transport: 'ws_balances' });
        ws.close(1013, 'Server at capacity');
        return;
      }

      ws._wallets = new Set();
      ws._keyInfo = keyInfo;
      ws._alive = true;
      ws._msgBucket = createTokenBucket(MAX_MESSAGES_PER_SECOND);

      ws.on('pong', () => { ws._alive = true; });
      ws.on('message', (raw) => {
        if (!ws._msgBucket.take()) {
          send(ws, { type: 'error', event: 'error', message: 'Rate limit exceeded; message dropped' });
          return;
        }
        handleMessage(ws, raw);
      });
      ws.on('close', () => { removeAllSubs(ws); updateGauge(); });
      ws.on('error', () => removeAllSubs(ws));

      updateGauge();
      send(ws, { type: 'connected', event: 'connected', message: 'Authenticated. Send subscribe action.' });
    });
  });

  // Heartbeat interval — cleared when the WebSocket server closes (tied to wss lifetime)
  const heartbeat = setInterval(() => runHeartbeat(wss.clients), HEARTBEAT_MS); // eslint-disable-line local/no-bare-timers

  wss.on('close', () => clearInterval(heartbeat)); // eslint-disable-line local/no-bare-timers

  activeServers.add(wss);
  wss.on('close', () => activeServers.delete(wss));

  log.info('WS', 'WebSocket balance streaming attached at /ws/balances');
  return wss;
}

/**
 * Close every balance WebSocket with 1001 (going away) so graceful shutdown
 * drains promptly instead of waiting on idle clients (#1983).
 * @param {string} [reason]
 * @returns {number} number of sockets signalled
 */
function closeAll(reason = 'server_shutdown') {
  let count = 0;
  for (const wss of activeServers) {
    for (const ws of wss.clients) {
      try { ws.close(1001, reason); count++; } catch (_) { /* already closing */ }
    }
  }
  return count;
}

module.exports = { attach, broadcast, closeAll, subscriptions, _handleMessage: handleMessage, _authenticate: authenticate, _runHeartbeat: runHeartbeat, _createChannel };
