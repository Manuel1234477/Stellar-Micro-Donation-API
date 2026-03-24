/**
 * SSE Transaction Feed
 *
 * Manages Server-Sent Events connections for real-time transaction streaming.
 * Supports filtering, reconnection via Last-Event-ID, heartbeats, and per-key
 * connection limits.
 */

'use strict';

/** Maximum concurrent SSE connections per API key. */
const MAX_CONNECTIONS_PER_KEY = 5;

/** Heartbeat interval in milliseconds. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** How many recent events to buffer for Last-Event-ID reconnection. */
const EVENT_BUFFER_SIZE = 500;

/**
 * @typedef {object} SseFilter
 * @property {string} [walletAddress] - Match donor or recipient address.
 * @property {string} [status]        - Match transaction status.
 * @property {number} [minAmount]     - Minimum amount (inclusive).
 * @property {number} [maxAmount]     - Maximum amount (inclusive).
 */

/**
 * @typedef {object} SseClient
 * @property {string}   id        - Unique client ID.
 * @property {string}   keyId     - API key identifier.
 * @property {SseFilter} filter   - Active event filter.
 * @property {Function} send      - Send an SSE event to this client.
 * @property {Function} close     - Close this client's connection.
 */

/** @type {Map<string, SseClient>} clientId → client */
const clients = new Map();

/** @type {Map<string, Set<string>>} keyId → Set of clientIds */
const keyConnections = new Map();

/**
 * Circular event buffer for Last-Event-ID reconnection support.
 * @type {Array<{id: string, event: string, data: object}>}
 */
const eventBuffer = [];
let eventCounter = 0;

/**
 * Generate a monotonically increasing event ID.
 * @returns {string}
 */
function nextEventId() {
  return String(++eventCounter);
}

/**
 * Append an event to the circular buffer.
 * @param {{id: string, event: string, data: object}} entry
 */
function bufferEvent(entry) {
  if (eventBuffer.length >= EVENT_BUFFER_SIZE) {
    eventBuffer.shift();
  }
  eventBuffer.push(entry);
}

/**
 * Retrieve buffered events with id > lastEventId.
 * @param {string} lastEventId
 * @returns {Array<{id: string, event: string, data: object}>}
 */
function getMissedEvents(lastEventId) {
  const threshold = Number(lastEventId);
  if (!Number.isFinite(threshold)) return [];
  return eventBuffer.filter(e => Number(e.id) > threshold);
}

/**
 * Check whether a transaction matches the given filter.
 * @param {object} tx
 * @param {SseFilter} filter
 * @returns {boolean}
 */
function matchesFilter(tx, filter) {
  if (filter.walletAddress) {
    if (tx.donor !== filter.walletAddress && tx.recipient !== filter.walletAddress) return false;
  }
  if (filter.status && tx.status !== filter.status) return false;
  const amount = Number(tx.amount);
  if (filter.minAmount !== undefined && amount < filter.minAmount) return false;
  if (filter.maxAmount !== undefined && amount > filter.maxAmount) return false;
  return true;
}

/**
 * Format and write a single SSE message to a response stream.
 * @param {import('http').ServerResponse} res
 * @param {string} id
 * @param {string} event
 * @param {object} data
 */
function writeSseEvent(res, id, event, data) {
  res.write(`id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Register a new SSE client.
 * @param {string} clientId
 * @param {string} keyId
 * @param {SseFilter} filter
 * @param {import('http').ServerResponse} res
 * @returns {SseClient}
 */
function addClient(clientId, keyId, filter, res) {
  const send = (id, event, data) => writeSseEvent(res, id, event, data);
  const close = () => removeClient(clientId);

  const client = { id: clientId, keyId, filter, send, close };
  clients.set(clientId, client);

  if (!keyConnections.has(keyId)) keyConnections.set(keyId, new Set());
  keyConnections.get(keyId).add(clientId);

  return client;
}

/**
 * Remove a client and clean up its key-connection slot.
 * @param {string} clientId
 */
function removeClient(clientId) {
  const client = clients.get(clientId);
  if (!client) return;
  clients.delete(clientId);
  const set = keyConnections.get(client.keyId);
  if (set) {
    set.delete(clientId);
    if (set.size === 0) keyConnections.delete(client.keyId);
  }
}

/**
 * Count active connections for a given API key.
 * @param {string} keyId
 * @returns {number}
 */
function connectionCount(keyId) {
  return keyConnections.get(keyId)?.size ?? 0;
}

/**
 * Broadcast a transaction event to all matching clients.
 * @param {string} event - SSE event name.
 * @param {object} tx    - Transaction payload.
 */
function broadcast(event, tx) {
  const id = nextEventId();
  const entry = { id, event, data: tx };
  bufferEvent(entry);

  for (const client of clients.values()) {
    if (matchesFilter(tx, client.filter)) {
      client.send(id, event, tx);
    }
  }
}

/**
 * Return a snapshot of current connection stats.
 * @returns {{ totalConnections: number, connectionsByKey: Record<string, number> }}
 */
function getStats() {
  const connectionsByKey = {};
  for (const [keyId, set] of keyConnections.entries()) {
    connectionsByKey[keyId] = set.size;
  }
  return { totalConnections: clients.size, connectionsByKey };
}

module.exports = {
  addClient,
  removeClient,
  connectionCount,
  broadcast,
  getStats,
  matchesFilter,
  getMissedEvents,
  writeSseEvent,
  MAX_CONNECTIONS_PER_KEY,
  HEARTBEAT_INTERVAL_MS,
  // exposed for testing
  _clients: clients,
  _eventBuffer: eventBuffer,
  _reset() {
    clients.clear();
    keyConnections.clear();
    eventBuffer.length = 0;
    eventCounter = 0;
  },
};
