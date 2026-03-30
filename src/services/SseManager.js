/**
 * SseManager
 * Manages SSE connections for the transactions channel.
 * Supports filtering by walletAddress / campaignId, heartbeats, and per-key connection limits.
 */

const MAX_CONNECTIONS_PER_KEY = 5;
const HEARTBEAT_INTERVAL_MS = 30_000;

class SseManager {
  constructor() {
    /** @type {Map<string, Set<object>>} apiKey -> Set of client objects */
    this._clients = new Map();
    /** @type {NodeJS.Timeout|null} */
    this._heartbeatTimer = null;
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
   * @param {{walletAddress?: string, campaignId?: string}} filters
   * @returns {{ added: boolean, limitExceeded: boolean }}
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

    return { added: true, limitExceeded: false };
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
   * Broadcast a confirmed transaction to all matching clients.
   * @param {object} transaction
   */
  broadcastTransaction(transaction) {
    const event = `data: ${JSON.stringify({ type: 'transaction.confirmed', data: transaction })}\n\n`;
    for (const clients of this._clients.values()) {
      for (const client of clients) {
        if (this._matches(client.filters, transaction)) {
          try { client.res.write(event); } catch (_) { /* client gone */ }
        }
      }
    }
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

  // ---------------------------------------------------------------------------

  _sendHeartbeat() {
    for (const clients of this._clients.values()) {
      for (const client of clients) {
        try { client.res.write(': ping\n\n'); } catch (_) { /* client gone */ }
      }
    }
  }

  _matches(filters, transaction) {
    if (filters.walletAddress &&
        transaction.donor !== filters.walletAddress &&
        transaction.recipient !== filters.walletAddress) {
      return false;
    }
    if (filters.campaignId && transaction.campaignId !== filters.campaignId) {
      return false;
    }
    return true;
  }
}

module.exports = new SseManager();
