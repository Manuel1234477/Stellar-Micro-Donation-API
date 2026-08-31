'use strict';

/**
 * HorizonPool — round-robin pool of Horizon.Server instances for StellarService.
 *
 * Provides fault isolation: if one instance fails it is removed from rotation
 * for a configurable cooldown period, then re-admitted after a lightweight health check.
 * 
 * Supports automatic failover to fallback endpoints when the primary becomes unhealthy.
 */

const StellarSdk = require('stellar-sdk');
const log = require('../utils/log');
const {
  horizonPoolAcquireDuration,
  recordHorizonPoolStatus,
  recordHorizonPoolCooldownEvent,
  recordHorizonPoolRecoveryEvent,
} = require('../utils/metrics');

const DEFAULT_POOL_SIZE = 3;
const MAX_POOL_SIZE = 10;
const DEFAULT_COOLDOWN_MS = 30_000;
const DEFAULT_FAILOVER_THRESHOLD = 3;

class HorizonPool {
  /**
   * @param {string} horizonUrl - Primary Horizon server base URL
   * @param {Object} [opts]
   * @param {number} [opts.size=3]        - Pool size (capped at 10)
   * @param {number} [opts.cooldownMs=30000] - Unhealthy member cooldown in ms
   * @param {Function} [opts.createHttpClient] - Factory for the HTTP client passed to each Server
   * @param {string[]} [opts.fallbackUrls=[]] - Fallback Horizon URLs for automatic failover
   * @param {number} [opts.failoverThreshold=3] - Consecutive failures before failover
   * @param {number} [opts.recoveryCooldownMs=60000] - Cooldown before switching back to primary
   */
  constructor(horizonUrl, opts = {}) {
    this.primaryUrl = horizonUrl;
    this.fallbackUrls = opts.fallbackUrls || [];
    this.allEndpoints = [this.primaryUrl, ...this.fallbackUrls];
    this.activeEndpointIndex = 0;
    this.failoverThreshold = parseInt(opts.failoverThreshold || DEFAULT_FAILOVER_THRESHOLD, 10);
    this.recoveryCooldownMs = parseInt(opts.recoveryCooldownMs || 60000, 10);
    
    this.size = Math.min(
      Math.max(1, parseInt(opts.size || DEFAULT_POOL_SIZE, 10)),
      MAX_POOL_SIZE
    );
    this.cooldownMs = parseInt(opts.cooldownMs || DEFAULT_COOLDOWN_MS, 10);
    this._createHttpClient = opts.createHttpClient || (() => undefined);

    // Pool state
    this._members = [];       // { server, healthy, unhealthyAt, url }
    this._index = 0;          // round-robin cursor
    
    // Failover tracking per endpoint
    this._endpointHealth = this.allEndpoints.map(url => ({
      url,
      consecutiveFailures: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
      isPrimary: url === this.primaryUrl,
    }));

    this._init();
    recordHorizonPoolStatus(this.getStatus());
  }

  _init() {
    const activeUrl = this.allEndpoints[this.activeEndpointIndex];
    for (let i = 0; i < this.size; i++) {
      this._members.push({
        server: new StellarSdk.Horizon.Server(activeUrl, {
          httpClient: this._createHttpClient(),
        }),
        healthy: true,
        unhealthyAt: null,
        url: activeUrl,
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
    const endTimer = horizonPoolAcquireDuration.startTimer();
    try {
      this._tryRecover();
      this._checkFailover();

      const healthyMembers = this._members.filter(m => m.healthy);
      if (healthyMembers.length === 0) {
        // All unhealthy — return first member as emergency fallback
        return this._members[0].server;
      }

      // Round-robin over healthy members
      this._index = (this._index + 1) % healthyMembers.length;
      return healthyMembers[this._index % healthyMembers.length].server;
    } finally {
      endTimer();
    }
  }

  /**
   * Mark the given server as unhealthy (remove from rotation for cooldownMs).
   * Also tracks consecutive failures for failover logic.
   * @param {import('stellar-sdk').Horizon.Server} server
   */
  markUnhealthy(server) {
    const member = this._members.find(m => m.server === server);
    if (member && member.healthy) {
      member.healthy = false;
      member.unhealthyAt = Date.now();
      
      // Track endpoint failures for failover
      const endpoint = this._endpointHealth[this.activeEndpointIndex];
      endpoint.consecutiveFailures += 1;
      endpoint.lastFailureAt = Date.now();
      
      recordHorizonPoolCooldownEvent();
      recordHorizonPoolStatus(this.getStatus());
      log.warn('HORIZON_POOL', 'Pool member marked unhealthy', {
        url: member.url,
        consecutiveFailures: endpoint.consecutiveFailures,
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
        
        // Reset consecutive failures on successful recovery
        const endpoint = this._endpointHealth[this.activeEndpointIndex];
        endpoint.consecutiveFailures = 0;
        endpoint.lastSuccessAt = now;
        
        recordHorizonPoolRecoveryEvent();
        recordHorizonPoolStatus(this.getStatus());
        log.info('HORIZON_POOL', 'Pool member re-admitted after cooldown', {
          url: member.url,
        });
      }
    }
  }

  /**
   * Check if failover is needed based on consecutive failures.
   * Switches to the next available fallback endpoint if threshold is exceeded.
   * @private
   */
  _checkFailover() {
    if (this.fallbackUrls.length === 0) return;

    const currentEndpoint = this._endpointHealth[this.activeEndpointIndex];
    
    // Check if we should failover to a fallback
    if (currentEndpoint.consecutiveFailures >= this.failoverThreshold) {
      // Find next healthy endpoint
      for (let i = 1; i < this.allEndpoints.length; i++) {
        const nextIndex = (this.activeEndpointIndex + i) % this.allEndpoints.length;
        const nextEndpoint = this._endpointHealth[nextIndex];
        
        // Skip if this endpoint also has recent failures
        if (nextEndpoint.consecutiveFailures > 0 && 
            nextEndpoint.lastFailureAt && 
            Date.now() - nextEndpoint.lastFailureAt < this.cooldownMs) {
          continue;
        }
        
        this._switchToEndpoint(nextIndex);
        return;
      }
    }
    
    // Check if we should recover back to primary
    if (!currentEndpoint.isPrimary) {
      const primaryEndpoint = this._endpointHealth[0];
      const timeSinceLastFailure = primaryEndpoint.lastFailureAt 
        ? Date.now() - primaryEndpoint.lastFailureAt 
        : Infinity;
      
      if (primaryEndpoint.consecutiveFailures === 0 && 
          timeSinceLastFailure >= this.recoveryCooldownMs) {
        this._switchToEndpoint(0);
      }
    }
  }

  /**
   * Switch the pool to use a different endpoint URL.
   * Recreates all pool members with the new URL.
   * @private
   * @param {number} endpointIndex
   */
  _switchToEndpoint(endpointIndex) {
    const previousUrl = this.allEndpoints[this.activeEndpointIndex];
    const newUrl = this.allEndpoints[endpointIndex];
    
    if (previousUrl === newUrl) return;
    
    this.activeEndpointIndex = endpointIndex;
    const isPrimary = this._endpointHealth[endpointIndex].isPrimary;
    
    log.warn('HORIZON_POOL', `${isPrimary ? 'Recovering to primary' : 'Failing over to fallback'} endpoint`, {
      from: previousUrl,
      to: newUrl,
      isPrimary,
    });
    
    // Recreate pool members with new URL
    this._members = [];
    for (let i = 0; i < this.size; i++) {
      this._members.push({
        server: new StellarSdk.Horizon.Server(newUrl, {
          httpClient: this._createHttpClient(),
        }),
        healthy: true,
        unhealthyAt: null,
        url: newUrl,
      });
    }
    
    this._index = 0;
    recordHorizonPoolStatus(this.getStatus());
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
   * @returns {{ size: number, healthy: number, unhealthy: number, activeEndpoint: string, endpoints: Array }}
   */
  getStatus() {
    return {
      size: this.size,
      healthy: this.healthyCount,
      unhealthy: this.unhealthyCount,
      activeEndpoint: this.allEndpoints[this.activeEndpointIndex],
      endpoints: this._endpointHealth.map(e => ({
        url: e.url,
        isPrimary: e.isPrimary,
        consecutiveFailures: e.consecutiveFailures,
        lastFailureAt: e.lastFailureAt ? new Date(e.lastFailureAt).toISOString() : null,
        lastSuccessAt: e.lastSuccessAt ? new Date(e.lastSuccessAt).toISOString() : null,
      })),
    };
  }
}

module.exports = HorizonPool;
