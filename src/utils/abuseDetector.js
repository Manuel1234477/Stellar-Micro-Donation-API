const log = require('./log');

/**
 * Lightweight abuse detection system
 * Tracks suspicious patterns without blocking traffic
 */
class AbuseDetector {
  constructor() {
    // In-memory tracking (use Redis in production)
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

    // Start cleanup
    this.startCleanup();
  }

  /**
   * Track a request from an IP
   * @param {string} ip - Client IP address
   */
  trackRequest(ip) {
    if (!ip) return;

    const now = Date.now();
    const data = this.requestCounts.get(ip) || { count: 0, windowStart: now };

    // Reset window if expired
    if (now - data.windowStart > this.config.burstWindow) {
      data.count = 0;
      data.windowStart = now;
    }

    data.count++;
    this.requestCounts.set(ip, data);

    // Check for burst
    if (data.count > this.config.burstThreshold) {
      this.flagSuspicious(ip, 'request_burst', {
        count: data.count,
        threshold: this.config.burstThreshold,
        window: this.config.burstWindow
      });
    }
  }

  /**
   * Track a failed request from an IP
   * @param {string} ip - Client IP address
   * @param {string} reason - Failure reason
   */
  trackFailure(ip, reason) {
    if (!ip) return;

    const now = Date.now();
    const data = this.failureCounts.get(ip) || { count: 0, windowStart: now };

    // Reset window if expired
    if (now - data.windowStart > this.config.failureWindow) {
      data.count = 0;
      data.windowStart = now;
    }

    data.count++;
    this.failureCounts.set(ip, data);

    // Check for repeated failures
    if (data.count > this.config.failureThreshold) {
      this.flagSuspicious(ip, 'repeated_failures', {
        count: data.count,
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
   */
  flagSuspicious(ip, signal, metadata) {
    if (this.suspiciousIPs.has(ip)) return; // Already flagged

    this.suspiciousIPs.add(ip);

    log.warn('ABUSE_DETECTION', `Suspicious activity detected: ${signal}`, {
      ip,
      signal,
      ...metadata,
      timestamp: new Date().toISOString()
    });

    // Auto-unflag after 1 hour (skip in test environment)
    if (process.env.NODE_ENV !== 'test') {
      setTimeout(() => {
        this.suspiciousIPs.delete(ip);
        log.info('ABUSE_DETECTION', `IP unflagged after cooldown`, { ip });
      }, 3600000);
    }
  }

  /**
   * Check if an IP is flagged as suspicious
   * @param {string} ip - Client IP address
   * @returns {boolean}
   */
  isSuspicious(ip) {
    return this.suspiciousIPs.has(ip);
  }

  /**
   * Get current statistics
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      suspiciousIPs: this.suspiciousIPs.size,
      trackedIPs: this.requestCounts.size,
      failureTracking: this.failureCounts.size
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
    if (process.env.NODE_ENV !== 'test') {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.config.cleanupInterval);
    }
  }

  /**
   * Stop cleanup timer
   */
  stop() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }
}

// Singleton instance
const abuseDetector = new AbuseDetector();

module.exports = abuseDetector;
