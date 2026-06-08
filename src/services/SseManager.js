/**
 * SseManager
 * Manages SSE connections for the transactions channel.
 * Supports filtering by walletAddress / campaignId / window, heartbeats,
 * and per-key connection limits.
 */

const MAX_CONNECTIONS_PER_KEY = 5;
const HEARTBEAT_INTERVAL_MS = 30_000;

class SseManager {
  constructor() {
    /** @type {Map<string, Set<object>>} apiKey -> Set of client objects */
    this._clients = new Map();
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
    this.MAX_CONNECTIONS_PER_KEY = MAX_CONNECTIONS_PER_KEY;
    this.HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
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
   * @param {string} apiKey
   * @param {object} res - Express response object
   * @param {object} filters
   * @returns {{ added: boolean, limitExceeded: boolean, client?: object }}
   */
  addClient(apiKey, res, filters = {}) {
    const existing = this._clients.get(apiKey) || new Set();
    if (existing.size >= MAX_CONNECTIONS_PER_KEY) {
      return { added: false, limitExceeded: true };
    }

    const client = { res, filters };
    existing.add(client);
    this._clients.set(apiKey, existing);

    res.on('close', () => this.removeClient(apiKey, client));

    return { added: true, limitExceeded: false, client };
  }

  /**
   * Remove a specific client.
   * @param {string} apiKey
   * @param {object} client
   */
  removeClient(apiKey, client) {
    const set = this._clients.get(apiKey);
    if (!set) return;
    set.delete(client);
    if (set.size === 0) this._clients.delete(apiKey);
  }

  /**
   * Broadcast a generic SSE event to all matching clients.
   * @param {string} event
   * @param {object} data
   */
  broadcast(event, data) {
    const payload = this._formatSse(event, data);
    for (const clients of this._clients.values()) {
      for (const client of clients) {
        if (this._matches(client.filters, data)) {
          try { client.res.write(payload); } catch (_) { /* client gone */ }
        }
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
    let n = 0;
    for (const s of this._clients.values()) n += s.size;
    return n;
  }

  /**
   * Return connection count for a specific API key.
   * @param {string} apiKey
   */
  connectionCountForKey(apiKey) {
    return (this._clients.get(apiKey) || new Set()).size;
  }

  /**
   * Return stats for all active SSE connections.
   */
  getStats() {
    const byKey = {};
    for (const [key, clients] of this._clients.entries()) {
      byKey[key] = clients.size;
    }

    return {
      totalClients: this.connectionCount,
      activeKeys: Object.keys(byKey).length,
      clientsByKey: byKey,
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
   * Return missed events since a given Last-Event-ID.
   * NOTE: This is not supported in the current implementation.
   * @param {string} lastEventId
   * @returns {Array}
   */
  getMissedEvents(_lastEventId) {
    return [];
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
    for (const clients of this._clients.values()) {
      for (const client of clients) {
        try { client.res.write(': ping\n\n'); } catch (_) { /* client gone */ }
      }
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

    if (typeof filters.minAmount === 'number' && typeof data.amount === 'string') {
      if (parseFloat(data.amount) < filters.minAmount) {
        return false;
      }
    }

    if (typeof filters.maxAmount === 'number' && typeof data.amount === 'string') {
      if (parseFloat(data.amount) > filters.maxAmount) {
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
  }
}

module.exports = new SseManager();
