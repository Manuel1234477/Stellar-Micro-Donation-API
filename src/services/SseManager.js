/**
 * SseManager
 * Manages SSE connections. Events are published through the PubSubAdapter so
 * they reach clients connected to any instance (cross-instance fan-out).
 * Single-instance behaviour is preserved when no shared backend is configured.
 */

const { getPubSubAdapter } = require('./PubSubAdapter');

const MAX_CONNECTIONS_PER_KEY = parseInt(process.env.SSE_MAX_CONNECTIONS_PER_KEY || '5');
const HEARTBEAT_INTERVAL_MS = 30_000;
const EVENT_BUFFER_SIZE = parseInt(process.env.SSE_EVENT_BUFFER_SIZE || '100');
const SSE_CHANNEL = 'sse:broadcast';

class SseManager {
  constructor() {
    /** @type {Map<string, object>} clientId -> { clientId, apiKey, res, filters } */
    this._clients = new Map();
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
    /** @type {Array<{id: number, event: string, data: object}>} replay buffer */
    this._eventBuffer = [];
    this._nextEventId = 1;
    this.MAX_CONNECTIONS_PER_KEY = MAX_CONNECTIONS_PER_KEY;
    this.HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
    this.EVENT_BUFFER_SIZE = EVENT_BUFFER_SIZE;

    // Subscribe to cross-instance broadcasts
    getPubSubAdapter().subscribe(SSE_CHANNEL, ({ event, data, id }) => {
      this._deliverLocally(event, data, id);
    });
  }

  /**
   * Start the periodic heartbeat.
   * Safe to call multiple times.
   */
  start() {
    if (this._heartbeatTimer) return;
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
  }

  /** Stop the heartbeat timer. */
  stop() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Add a new SSE client.
   * @param {string} clientId - Unique identifier for this connection
   * @param {string} apiKey - API key id, used for per-key connection limits
   * @param {object} filters
   * @param {object} res - Express response object
   * @returns {{ added: boolean, limitExceeded: boolean, client?: object }}
   */
  addClient(clientId, apiKey, filters = {}, res) {
    if (this.connectionCountForKey(apiKey) >= MAX_CONNECTIONS_PER_KEY) {
      return { added: false, limitExceeded: true };
    }

    const client = { clientId, apiKey, res, filters: filters || {} };
    this._clients.set(clientId, client);

    if (res && typeof res.on === 'function') {
      res.on('close', () => this.removeClient(clientId));
    }

    return { added: true, limitExceeded: false, client };
  }

  /**
   * Remove a client by id.
   * @param {string} clientId
   */
  removeClient(clientId) {
    this._clients.delete(clientId);
  }

  /**
   * Broadcast a generic SSE event to all matching clients.
   * Publishes through the PubSubAdapter so all instances receive it.
   * @param {string} event
   * @param {object} data
   */
  broadcast(event, data) {
    const id = this._nextEventId++;
    // Record in replay buffer (bounded)
    this._eventBuffer.push({ id, event, data });
    if (this._eventBuffer.length > EVENT_BUFFER_SIZE) {
      this._eventBuffer.shift();
    }
    // Publish cross-instance; the subscription in the constructor delivers locally
    getPubSubAdapter().publish(SSE_CHANNEL, { event, data, id }).catch(() => {
      // If publish fails, still deliver locally
      this._deliverLocally(event, data, id);
    });
  }

  /** Deliver an event to local clients only (called from pub/sub handler). */
  _deliverLocally(event, data, id) {
    const payload = this._formatSse(event, data, id);
    for (const client of this._clients.values()) {
      if (this._matches(client.filters, data)) {
        try { client.res.write(payload); } catch (_) { /* client gone */ }
      }
    }
  }

  /**
   * Broadcast a confirmed transaction to all matching clients.
   * @param {object} transaction
   */
  broadcastTransaction(transaction) {
    this.broadcast('transaction.confirmed', transaction);
  }

  /**
   * Return total number of connected clients (all keys).
   */
  get connectionCount() {
    return this._clients.size;
  }

  /**
   * Return connection count for a specific API key.
   * @param {string} apiKey
   */
  connectionCountForKey(apiKey) {
    let n = 0;
    for (const client of this._clients.values()) {
      if (client.apiKey === apiKey) n++;
    }
    return n;
  }

  /**
   * Return stats for all active SSE connections.
   */
  getStats() {
    const connectionsByKey = {};
    for (const client of this._clients.values()) {
      connectionsByKey[client.apiKey] = (connectionsByKey[client.apiKey] || 0) + 1;
    }

    return {
      totalConnections: this._clients.size,
      connectionsByKey,
    };
  }

  /**
   * Write a plain SSE event to a response.
   * @param {object} res
   * @param {string} id
   * @param {string} event
   * @param {object} data
   */
  writeSseEvent(res, id, event, data) {
    const payload = this._formatSse(event, data, id);
    try {
      res.write(payload);
    } catch (_) {
      // ignore broken pipe
    }
  }

  /**
   * Return buffered events with an id greater than the given Last-Event-ID.
   * @param {string|number} lastEventId
   * @returns {Array<{id: number, event: string, data: object}>}
   */
  getMissedEvents(lastEventId) {
    const lastId = parseInt(lastEventId, 10);
    if (!Number.isFinite(lastId)) return [];
    return this._eventBuffer.filter(e => e.id > lastId);
  }

  /**
   * Check if the given data passes the client filters.
   * @param {object} data
   * @param {object} filters
   */
  matchesFilter(data, filters) {
    return this._matches(filters, data);
  }

  // ---------------------------------------------------------------------------

  _sendHeartbeat() {
    for (const client of this._clients.values()) {
      try { client.res.write(': ping\n\n'); } catch (_) { /* client gone */ }
    }
  }

  _formatSse(event, data, id) {
    let lines = '';
    if (id !== undefined && id !== null) {
      lines += `id: ${id}\n`;
    }
    if (event) {
      lines += `event: ${event}\n`;
    }
    lines += `data: ${JSON.stringify(data)}\n\n`;
    return lines;
  }

  _matches(filters, data) {
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }

    if (filters.walletAddress) {
      const walletAddress = filters.walletAddress;
      if (data.donor !== walletAddress && data.recipient !== walletAddress) {
        return false;
      }
    }

    if (filters.campaignId && data.campaignId !== filters.campaignId) {
      return false;
    }

    if (filters.status && data.status !== filters.status) {
      return false;
    }

    if (typeof filters.minAmount === 'number') {
      const amount = typeof data.amount === 'number' ? data.amount : parseFloat(data.amount);
      if (!Number.isFinite(amount) || amount < filters.minAmount) {
        return false;
      }
    }

    if (typeof filters.maxAmount === 'number') {
      const amount = typeof data.amount === 'number' ? data.amount : parseFloat(data.amount);
      if (!Number.isFinite(amount) || amount > filters.maxAmount) {
        return false;
      }
    }

    if (filters.window && data.window !== filters.window) {
      return false;
    }

    return true;
  }

  /** Reset all state — for use in tests only. */
  _reset() {
    this.stop();
    this._clients = new Map();
    this._eventBuffer = [];
    this._nextEventId = 1;
  }
}

module.exports = new SseManager();
