/**
 * Suspicious Pattern Detector - Security Observability Layer
 * 
 * RESPONSIBILITY: Detect and log suspicious usage patterns without blocking
 * OWNER: Security Team
 * DEPENDENCIES: Logger, correlation utilities
 * 
 * Provides soft alerts (logs/metrics only) for suspicious behavior patterns.
 * No blocking behavior - purely observability for security monitoring.
 */

const log = require('./log');

class SuspiciousPatternDetector {
  constructor() {
    // Pattern tracking stores
    this.velocityTracking = new Map(); // ip -> { donations: [], window }
    this.amountPatterns = new Map(); // ip -> { amounts: [], timestamps: [] }
    this.recipientPatterns = new Map(); // donor -> Set(recipients)
    this.sequentialFailures = new Map(); // ip -> { count, lastFailure }
    this.timePatterns = new Map(); // ip -> { requests: [] }

    // Heuristic thresholds
    this.thresholds = {
      velocityWindow: 300000, // 5 minutes
      velocityLimit: 5, // donations per window
      identicalAmountCount: 3, // same amount repeated
      identicalAmountWindow: 600000, // 10 minutes
      recipientDiversityLimit: 10, // unique recipients per donor
      sequentialFailureLimit: 5, // consecutive failures
      offHoursStart: 2, // 2 AM
      offHoursEnd: 6, // 6 AM
      offHoursRequestLimit: 20, // requests during off-hours
      cleanupInterval: 900000 // 15 minutes
    };

    this.startCleanup();
  }

  /**
   * Detect high-velocity donation pattern
   */
  detectHighVelocity(ip, donationData) {
    if (!ip) return;

    const now = Date.now();
    const tracking = this.velocityTracking.get(ip) || { donations: [], windowStart: now };

    // Reset window if expired
    if (now - tracking.windowStart > this.thresholds.velocityWindow) {
      tracking.donations = [];
      tracking.windowStart = now;
    }

    tracking.donations.push({ timestamp: now, ...donationData });
    this.velocityTracking.set(ip, tracking);

    if (tracking.donations.length >= this.thresholds.velocityLimit) {
      this._emitAlert('high_velocity_donations', ip, {
        count: tracking.donations.length,
        window: this.thresholds.velocityWindow,
        threshold: this.thresholds.velocityLimit,
        pattern: 'rapid_succession'
      });
    }
  }

  /**
   * Detect identical amount pattern (potential automation)
   */
  detectIdenticalAmounts(ip, amount) {
    if (!ip || !amount) return;

    const now = Date.now();
    const tracking = this.amountPatterns.get(ip) || { amounts: [], timestamps: [] };

    // Clean old entries
    const cutoff = now - this.thresholds.identicalAmountWindow;
    const validIndices = tracking.timestamps
      .map((ts, idx) => (ts > cutoff ? idx : -1))
      .filter(idx => idx !== -1);

    tracking.amounts = validIndices.map(idx => tracking.amounts[idx]);
    tracking.timestamps = validIndices.map(idx => tracking.timestamps[idx]);

    // Add new entry
    tracking.amounts.push(amount);
    tracking.timestamps.push(now);
    this.amountPatterns.set(ip, tracking);

    // Check for identical amounts
    const amountCounts = tracking.amounts.reduce((acc, amt) => {
      acc[amt] = (acc[amt] || 0) + 1;
      return acc;
    }, {});

    const maxCount = Math.max(...Object.values(amountCounts));
    if (maxCount >= this.thresholds.identicalAmountCount) {
      this._emitAlert('identical_amount_pattern', ip, {
        amount,
        count: maxCount,
        window: this.thresholds.identicalAmountWindow,
        pattern: 'automation_suspected'
      });
    }
  }

  /**
   * Detect unusual recipient diversity (potential money laundering)
   */
  detectRecipientDiversity(donor, recipient) {
    if (!donor || !recipient) return;

    const recipients = this.recipientPatterns.get(donor) || new Set();
    recipients.add(recipient);
    this.recipientPatterns.set(donor, recipients);

    if (recipients.size >= this.thresholds.recipientDiversityLimit) {
      this._emitAlert('high_recipient_diversity', donor, {
        uniqueRecipients: recipients.size,
        threshold: this.thresholds.recipientDiversityLimit,
        pattern: 'distribution_suspected'
      });
    }
  }

  /**
   * Detect sequential failure pattern (potential probing)
   */
  detectSequentialFailures(ip, errorType) {
    if (!ip) return;

    const now = Date.now();
    const tracking = this.sequentialFailures.get(ip) || { count: 0, lastFailure: now };

    // Reset if gap is too large (> 1 minute)
    if (now - tracking.lastFailure > 60000) {
      tracking.count = 0;
    }

    tracking.count++;
    tracking.lastFailure = now;
    this.sequentialFailures.set(ip, tracking);

    if (tracking.count >= this.thresholds.sequentialFailureLimit) {
      this._emitAlert('sequential_failures', ip, {
        count: tracking.count,
        errorType,
        threshold: this.thresholds.sequentialFailureLimit,
        pattern: 'probing_suspected'
      });
    }
  }

  /**
   * Detect off-hours activity pattern
   */
  detectOffHoursActivity(ip) {
    if (!ip) return;

    const now = Date.now();
    const hour = new Date(now).getUTCHours();

    // Check if off-hours
    if (hour >= this.thresholds.offHoursStart && hour < this.thresholds.offHoursEnd) {
      const tracking = this.timePatterns.get(ip) || { requests: [] };

      // Clean old entries (last 24 hours)
      const cutoff = now - 86400000;
      tracking.requests = tracking.requests.filter(ts => ts > cutoff);

      tracking.requests.push(now);
      this.timePatterns.set(ip, tracking);

      // Count off-hours requests
      const offHoursCount = tracking.requests.filter(ts => {
        const h = new Date(ts).getUTCHours();
        return h >= this.thresholds.offHoursStart && h < this.thresholds.offHoursEnd;
      }).length;

      if (offHoursCount >= this.thresholds.offHoursRequestLimit) {
        this._emitAlert('off_hours_activity', ip, {
          count: offHoursCount,
          hour,
          threshold: this.thresholds.offHoursRequestLimit,
          pattern: 'unusual_timing'
        });
      }
    }
  }

  /**
   * Reset sequential failure counter on success
   */
  resetFailures(ip) {
    if (ip && this.sequentialFailures.has(ip)) {
      this.sequentialFailures.delete(ip);
    }
  }

  /**
   * Emit structured alert (log only, no blocking)
   */
  _emitAlert(signalType, identifier, metadata) {
    log.warn('SUSPICIOUS_PATTERN', `Suspicious pattern detected: ${signalType}`, {
      signal: signalType,
      identifier,
      ...metadata,
      timestamp: new Date().toISOString(),
      severity: this._calculateSeverity(signalType, metadata)
    });
  }

  /**
   * Calculate severity level for alerting
   */
  _calculateSeverity(signalType, metadata) {
    const severityMap = {
      high_velocity_donations: 'medium',
      identical_amount_pattern: 'medium',
      high_recipient_diversity: 'high',
      sequential_failures: 'low',
      off_hours_activity: 'low'
    };

    return severityMap[signalType] || 'low';
  }

  /**
   * Get current metrics for observability
   */
  getMetrics() {
    return {
      velocityTracking: this.velocityTracking.size,
      amountPatterns: this.amountPatterns.size,
      recipientPatterns: this.recipientPatterns.size,
      sequentialFailures: this.sequentialFailures.size,
      timePatterns: this.timePatterns.size
    };
  }

  /**
   * Cleanup old entries
   */
  cleanup() {
    const now = Date.now();

    // Clean velocity tracking
    for (const [ip, data] of this.velocityTracking.entries()) {
      if (now - data.windowStart > this.thresholds.velocityWindow * 2) {
        this.velocityTracking.delete(ip);
      }
    }

    // Clean amount patterns
    for (const [ip, data] of this.amountPatterns.entries()) {
      const cutoff = now - this.thresholds.identicalAmountWindow * 2;
      data.timestamps = data.timestamps.filter(ts => ts > cutoff);
      data.amounts = data.amounts.slice(-data.timestamps.length);
      
      if (data.timestamps.length === 0) {
        this.amountPatterns.delete(ip);
      }
    }

    // Clean sequential failures (older than 1 hour)
    for (const [ip, data] of this.sequentialFailures.entries()) {
      if (now - data.lastFailure > 3600000) {
        this.sequentialFailures.delete(ip);
      }
    }

    // Clean time patterns (older than 24 hours)
    for (const [ip, data] of this.timePatterns.entries()) {
      const cutoff = now - 86400000;
      data.requests = data.requests.filter(ts => ts > cutoff);
      
      if (data.requests.length === 0) {
        this.timePatterns.delete(ip);
      }
    }

    log.debug('SUSPICIOUS_PATTERN', 'Cleanup completed', this.getMetrics());
  }

  /**
   * Start periodic cleanup
   */
  startCleanup() {
    if (process.env.NODE_ENV !== 'test') {
      this.cleanupTimer = setInterval(() => {
        this.cleanup();
      }, this.thresholds.cleanupInterval);
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
const suspiciousPatternDetector = new SuspiciousPatternDetector();

module.exports = suspiciousPatternDetector;
