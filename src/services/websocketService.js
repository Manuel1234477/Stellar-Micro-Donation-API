'use strict';

/**
 * WebSocketService — real-time balance streaming (Issue #410)
 *
 * Protocol:
 *   connect  ws://host/ws/balances?apiKey=<key>
 *   → send   {"action":"subscribe","wallets":["GA...","GB..."]}
 *   → recv   {"event":"balance_update","wallet":"GA...","new_balance":"100.00","asset":"XLM"}
 *   → send   {"action":"unsubscribe","wallets":["GA..."]}
 *
 * Opt-out / limits:
 *   MAX_WALLETS_PER_CONNECTION = 50
 *   Heartbeat every 30 s (ping/pong)
 *   Close code 4001 = Unauthorized
 */

const { WebSocketServer } = require('ws');
const { validateKey } = require('../models/apiKeys');
const { securityConfig } = require('../config/securityConfig');
const donationEvents = require('../events/donationEvents');
const log = require('../utils/log');

const MAX_WALLETS = parseInt(process.env.WS_MAX_WALLETS || '50', 10);
const HEARTBEAT_MS = parseInt(process.env.WS_HEARTBEAT_MS || '30000', 10);

// Map<walletAddress, Set<WebSocket>>
const subscriptions = new Map();

// ── internal helpers ──────────────────────────────────────────────────────────

function send(ws, obj) {
  if (ws.readyState === ws.constructor.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function addSub(wallet, ws) {
  if (!subscriptions.has(wallet)) subscriptions.set(wallet, new Set());
  subscriptions.get(wallet).add(ws);
}

function removeSub(wallet, ws) {
  const set = subscriptions.get(wallet);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscriptions.delete(wallet);
}

function removeAllSubs(ws) {
  for (const [wallet, set] of subscriptions) {
    set.delete(ws);
    if (set.size === 0) subscriptions.delete(wallet);
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

  // Legacy env keys
  const legacyKeys = securityConfig.API_KEYS || [];
  if (legacyKeys.includes(apiKey)) return { role: 'user', id: null };

  return null;
}

// ── message handler ───────────────────────────────────────────────────────────

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch (_) { return; }

  const { action, wallets } = msg;
  if (!Array.isArray(wallets) || !wallets.length) return;

  if (action === 'subscribe') {
    const current = ws._wallets.size;
    const toAdd = wallets.slice(0, MAX_WALLETS - current);
    for (const w of toAdd) {
      ws._wallets.add(w);
      addSub(w, ws);
    }
    if (wallets.length > toAdd.length) {
      send(ws, { event: 'error', message: `Subscription limit is ${MAX_WALLETS} wallets` });
    }
  } else if (action === 'unsubscribe') {
    for (const w of wallets) {
      ws._wallets.delete(w);
      removeSub(w, ws);
    }
  }
}

// ── broadcast ─────────────────────────────────────────────────────────────────

function broadcast(wallet, payload) {
  const set = subscriptions.get(wallet);
  if (!set) return;
  const msg = JSON.stringify({ event: 'balance_update', wallet, ...payload });
  for (const ws of set) {
    if (ws.readyState === ws.constructor.OPEN) ws.send(msg);
  }
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
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    if (req.url && !req.url.startsWith('/ws/balances')) {
      socket.destroy();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const apiKey = url.searchParams.get('apiKey') ||
                   (req.headers['x-api-key']);

    const keyInfo = await authenticate(apiKey);
    if (!keyInfo) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._wallets = new Set();
      ws._keyInfo = keyInfo;
      ws._alive = true;

      ws.on('pong', () => { ws._alive = true; });
      ws.on('message', (raw) => handleMessage(ws, raw));
      ws.on('close', () => removeAllSubs(ws));
      ws.on('error', () => removeAllSubs(ws));

      send(ws, { event: 'connected', message: 'Authenticated. Send subscribe action.' });
    });
  });

  // Heartbeat interval
  const heartbeat = setInterval(() => runHeartbeat(wss.clients), HEARTBEAT_MS);

  wss.on('close', () => clearInterval(heartbeat));

  log.info('WS', 'WebSocket balance streaming attached at /ws/balances');
  return wss;
}

module.exports = { attach, broadcast, subscriptions, _handleMessage: handleMessage, _authenticate: authenticate, _runHeartbeat: runHeartbeat };
