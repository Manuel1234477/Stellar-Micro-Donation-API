const log = require('./log');

/**
 * Lightweight abuse detection system
 * Tracks suspicious patterns without blocking traffic.
 *
 * State is backed by the shared rate-limit store (Redis when configured) so
 * counters and flags are shared across instances. Falls back to in-memory
 * Maps when no shared store is available.
 */
class AbuseDetector {
  constructor() {
    // In-memory fallback tracking (used when no shared store is configured)
    this.requestCounts = new Map(); // ip -> { count, windowStart }
    this.failureCounts = new Map(); // ip -> { count, windowStart }
    this.suspiciousIPs = new Set();

    // Configuration
    this.config = {
      burstThreshold: 100, // requests per window
      burstWindow: 60000, // 1 minute
      failureThreshold: 20, // failures per window
      failureWindow: 300000, // 5 minutes
      cleanupInterval: 600000 // 10 minutes
    };

    // Shared rate-limit store (Redis when configured), resolved lazily.
    this._store = null;
    this._storeResolved = false;

    // Start cleanup
    this.startCleanup();
  }

  /**
   * Resolve the shared rate-limit store, if one is configured.
   * @returns {Object|null}
   */
  getStore() {
    if (this._storeResolved) return this._store;
    this._storeResolved = true;
    try {
      const rateLimitStore = require('./rateLimitStore');
      this._store = rateLimitStore && typeof rateLimitStore.increment === 'function'
        ? rateLimitStore
        : null;
    } catch (err) {
      this._store = null;
    }
    return this._store;
  }

  /**
   * Increment a counter in the shared store, falling back to in-memory.
   * @param {string} key - Counter key
   * @param {number} window - Window in ms
   * @param {Map} fallbackMap - In-memory fallback map
   * @returns {Promise<number>} Current count in the window
   */
  async incrementCounter(key, window, fallbackMap) {
    const store = this.getStore();
    if (store) {
      try {
        const result = await store.increment(key, window);
        if (typeof result === 'number') return result;
        if (result && typeof result.count === 'number') return result.count;
      } catch (err) {
        log.warn('ABUSE_DETECTION', 'Shared store increment failed, using in-memory fallback', {
          key,
          error: err.message
        });
      }
    }

    const now = Date.now();
    const data = fallbackMap.get(key) || { count: 0, windowStart: now };
    if (now - data.windowStart > window) {
      data.count = 0;
      data.windowStart = now;
    }
    data.count++;
    fallbackMap.set(key, data);
    return data.count;
  }

  /**
   * Track a request from an IP
   * @param {string} ip - Client IP address
   * @returns {Promise<void>}
   */
  async trackRequest(ip) {
    if (!ip) return;

    const count = await this.incrementCounter(
      `abuse:req:${ip}`,
      this.config.burstWindow,
      this.requestCounts
    );

    // Check for burst
    if (count > this.config.burstThreshold) {
      await this.flagSuspicious(ip, 'request_burst', {
        count,
        threshold: this.config.burstThreshold,
        window: this.config.burstWindow
      });
    }
  }

  /**
   * Track a failed request from an IP
   * @param {string} ip - Client IP address
   * @param {string} reason - Failure reason
   * @returns {Promise<void>}
   */
  async trackFailure(ip, reason) {
    if (!ip) return;

    const count = await this.incrementCounter(
      `abuse:fail:${ip}`,
      this.config.failureWindow,
      this.failureCounts
    );

    // Check for repeated failures
    if (count > this.config.failureThreshold) {
      await this.flagSuspicious(ip, 'repeated_failures', {
        count,
        threshold: this.config.failureThreshold,
        window: this.config.failureWindow,
        reason
      });
    }
  }

  /**
   * Flag an IP as suspicious
   * @param {string} ip - Client IP address
   * @param {string} signal - Signal type
   * @param {Object} metadata - Additional context
   * @returns {Promise<void>}
   */
  async flagSuspicious(ip, signal, metadata) {
    if (this.suspiciousIPs.has(ip)) return; // Already flagged

    const store = this.getStore();
    if (store && typeof store.set === 'function') {
      try {
        const already = await store.get(`abuse:flag:${ip}`);
        if (already) {
          this.suspiciousIPs.add(ip);
          return;
        }
        await store.set(`abuse:flag:${ip}`, '1', 3600);
      } catch (err) {
        log.warn('ABUSE_DETECTION', 'Shared store flag failed, using in-memory fallback', {
          ip,
          error: err.message
        });
      }
    }

    this.suspiciousIPs.add(ip);

    log.warn('ABUSE_DETECTION', `Suspicious activity detected: ${signal}`, {
      ip,
      signal,
      ...metadata,
      timestamp: new Date().toISOString()
    });

    // Auto-unflag after 1 hour (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      const timerRegistry = require('./timerRegistry');
      timerRegistry.createTimeout(() => {
        this.suspiciousIPs.delete(ip);
        log.info('ABUSE_DETECTION', `IP unflagged after cooldown`, { ip });
      }, 3600000, 'abuse-unflag').unref();
    }
  }

  /**
   * Check if an IP is flagged as suspicious
   * @param {string} ip - Client IP address
   * @returns {Promise<boolean>}
   */
  async isSuspicious(ip) {
    if (this.suspiciousIPs.has(ip)) return true;

    const store = this.getStore();
    if (store && typeof store.get === 'function') {
      try {
        const flagged = await store.get(`abuse:flag:${ip}`);
        if (flagged) {
          this.suspiciousIPs.add(ip);
          return true;
        }
      } catch (err) {
        log.warn('ABUSE_DETECTION', 'Shared store lookup failed, using in-memory fallback', {
          ip,
          error: err.message
        });
      }
    }

    return false;
  }

  /**
   * Get current statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      suspiciousIPs: this.suspiciousIPs.size,
      trackedIPs: this.requestCounts.size,
      failureTracking: this.failureCounts.size,
      sharedStore: Boolean(this.getStore())
    };
  }

  /**
   * Cleanup old entries
   */
  cleanup() {
    const now = Date.now();

    // Clean request counts
    for (const [ip, data] of this.requestCounts.entries()) {
      if (now - data.windowStart > this.config.burstWindow * 2) {
        this.requestCounts.delete(ip);
      }
    }

    // Clean failure counts
    for (const [ip, data] of this.failureCounts.entries()) {
      if (now - data.windowStart > this.config.failureWindow * 2) {
        this.failureCounts.delete(ip);
      }
    }

    log.debug('ABUSE_DETECTION', 'Cleanup completed', this.getStats());
  }

  /**
   * Start periodic cleanup
   */
  startCleanup() {
    // Only start if not in test environment
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'testing') {
      const timerRegistry = require('./timerRegistry');
      this.cleanupTimer = timerRegistry.createInterval(() => {
        this.cleanup();
      }, this.config.cleanupInterval, 'abuse-detector-cleanup');
    }
  }

  /**
   * Stop cleanup timer
   */
  stop() {
    if (this.cleanupTimer) {
      this.cleanupTimer.clear();
    }
  }
}

// Singleton instance
const abuseDetector = new AbuseDetector();

module.exports = abuseDetector;
