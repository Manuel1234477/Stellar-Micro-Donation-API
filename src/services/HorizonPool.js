'use strict';

/**
 * HorizonPool — round-robin pool of Horizon.Server instances for StellarService.
 *
 * Provides fault isolation: if one instance fails it is removed from rotation
 * for a configurable cooldown period, then re-admitted after a lightweight health check.
 */

const StellarSdk = require('stellar-sdk');
const log = require('../utils/log');

const DEFAULT_POOL_SIZE = 3;
const MAX_POOL_SIZE = 10;
const DEFAULT_COOLDOWN_MS = 30_000;

class HorizonPool {
  /**
   * @param {string} horizonUrl - Horizon server base URL shared by all pool members
   * @param {Object} [opts]
   * @param {number} [opts.size=3]        - Pool size (capped at 10)
   * @param {number} [opts.cooldownMs=30000] - Unhealthy member cooldown in ms
   * @param {Function} [opts.createHttpClient] - Factory for the HTTP client passed to each Server
   */
  constructor(horizonUrl, opts = {}) {
    this.horizonUrl = horizonUrl;
    this.size = Math.min(
      Math.max(1, parseInt(opts.size || DEFAULT_POOL_SIZE, 10)),
      MAX_POOL_SIZE
    );
    this.cooldownMs = parseInt(opts.cooldownMs || DEFAULT_COOLDOWN_MS, 10);
    this._createHttpClient = opts.createHttpClient || (() => undefined);

    // Pool state
    this._members = [];       // { server, healthy, unhealthyAt }
    this._index = 0;          // round-robin cursor

    this._init();
  }

  _init() {
    for (let i = 0; i < this.size; i++) {
      this._members.push({
        server: new StellarSdk.Horizon.Server(this.horizonUrl, {
          httpClient: this._createHttpClient(),
        }),
        healthy: true,
        unhealthyAt: null,
      });
    }
  }

  /**
   * Return the next healthy server instance using round-robin.
   * If all members are unhealthy, attempt to recover any that have cooled down,
   * then return the first recoverable one; as a last resort return any member.
   *
   * @returns {import('stellar-sdk').Horizon.Server}
   */
  getServer() {
    this._tryRecover();

    const healthyMembers = this._members.filter(m => m.healthy);
    if (healthyMembers.length === 0) {
      // All unhealthy — return first member as emergency fallback
      return this._members[0].server;
    }

    // Round-robin over healthy members
    this._index = (this._index + 1) % healthyMembers.length;
    return healthyMembers[this._index % healthyMembers.length].server;
  }

  /**
   * Mark the given server as unhealthy (remove from rotation for cooldownMs).
   * @param {import('stellar-sdk').Horizon.Server} server
   */
  markUnhealthy(server) {
    const member = this._members.find(m => m.server === server);
    if (member && member.healthy) {
      member.healthy = false;
      member.unhealthyAt = Date.now();
      log.warn('HORIZON_POOL', 'Pool member marked unhealthy', {
        url: this.horizonUrl,
        healthy: this.healthyCount,
        total: this.size,
      });
    }
  }

  /**
   * Re-admit members whose cooldown has elapsed, after a lightweight health check.
   * @private
   */
  _tryRecover() {
    const now = Date.now();
    for (const member of this._members) {
      if (!member.healthy && member.unhealthyAt !== null &&
          now - member.unhealthyAt >= this.cooldownMs) {
        // Fire-and-forget health check; re-admit optimistically, demote on failure
        this._healthCheck(member).catch(() => {});
        member.healthy = true;
        member.unhealthyAt = null;
        log.info('HORIZON_POOL', 'Pool member re-admitted after cooldown', {
          url: this.horizonUrl,
        });
      }
    }
  }

  /**
   * Lightweight health check — hits the root endpoint (GET /).
   * @private
   * @param {{ server: import('stellar-sdk').Horizon.Server }} member
   */
  async _healthCheck(member) {
    try {
      await member.server.fetchTimebounds(10);
    } catch {
      this.markUnhealthy(member.server);
    }
  }

  get healthyCount() {
    return this._members.filter(m => m.healthy).length;
  }

  get unhealthyCount() {
    return this._members.filter(m => !m.healthy).length;
  }

  /**
   * Pool status shape for health endpoint.
   * @returns {{ size: number, healthy: number, unhealthy: number }}
   */
  getStatus() {
    return {
      size: this.size,
      healthy: this.healthyCount,
      unhealthy: this.unhealthyCount,
    };
  }
}

module.exports = HorizonPool;
