/**
 * IP-based Abuse Detection and Auto-Blocking Service
 *
 * Unified abuse-detection service with pluggable detectors (rate, pattern,
 * velocity, anomaly). Detector state is backed by the shared rate-limit
 * store (Redis when configured) so counters are shared across instances.
 *
 * Tracks suspicious patterns per IP, auto-blocks repeat offenders
 * Persists blocks with expiry in data/blockedIps.json
 * Admin API for management
 *
 * Threshold: 10 suspicious events in 1 hour → auto-block 24h
 */

const fs = require('fs');
const path = require('path');
const log = require('../utils/log');
const { v4: uuidv4 } = require('uuid');
const timerRegistry = require('../utils/timerRegistry');
const rateLimitStore = require('../utils/rateLimitStore');

const DB_PATH = process.env.ABUSE_DB_PATH || path.join(__dirname, '../../../data/blockedIps.json');

/**
 * Pluggable detector contract:
 *   { name, evaluate(context) -> { suspicious: boolean, reason?: string } }
 *
 * Detectors keep no per-instance state; counters live in the shared
 * rate-limit store so all pods observe the same values.
 */
class RateDetector {
  constructor(service) {
    this.service = service;
    this.name = 'rate';
  }

  async evaluate({ ip }) {
    if (!ip) return { suspicious: false };
    const key = `abuse:rate:${ip}`;
    const count = await this.service.incrementCounter(key, this.service.config.windowMs);
    return {
      suspicious: count >= this.service.config.suspiciousThreshold,
      reason: 'suspicious_threshold_exceeded'
    };
  }
}

class PatternDetector {
  constructor(service) {
    this.service = service;
    this.name = 'pattern';
  }

  async evaluate({ ip, pattern }) {
    if (!ip || !pattern) return { suspicious: false };
    const key = `abuse:pattern:${ip}:${pattern}`;
    const count = await this.service.incrementCounter(key, this.service.config.windowMs);
    return {
      suspicious: count >= this.service.config.patternThreshold,
      reason: `suspicious_pattern:${pattern}`
    };
  }
}

class VelocityDetector {
  constructor(service) {
    this.service = service;
    this.name = 'velocity';
  }

  async evaluate({ ip }) {
    if (!ip) return { suspicious: false };
    const key = `abuse:velocity:${ip}`;
    const count = await this.service.incrementCounter(key, this.service.config.velocityWindowMs);
    return {
      suspicious: count >= this.service.config.velocityThreshold,
      reason: 'velocity_threshold_exceeded'
    };
  }
}

class AnomalyDetector {
  constructor(service) {
    this.service = service;
    this.name = 'anomaly';
  }

  async evaluate({ ip, anomalyScore }) {
    if (!ip || typeof anomalyScore !== 'number') return { suspicious: false };
    return {
      suspicious: anomalyScore >= this.service.config.anomalyThreshold,
      reason: 'anomaly_threshold_exceeded'
    };
  }
}

class AbuseDetectionService {
  constructor() {
    this.blockedIps = this.loadBlocked();
    this.config = {
      suspiciousThreshold: parseInt(process.env.ABUSE_SUSPICIOUS_THRESHOLD) || 10,
      windowMs: parseInt(process.env.ABUSE_WINDOW_MS) || 3600000, // 1h
      blockDurationMs: parseInt(process.env.ABUSE_BLOCK_DURATION_MS) || 86400000, // 24h
      cleanupInterval: 300000, // 5min
      patternThreshold: parseInt(process.env.ABUSE_PATTERN_THRESHOLD) || 5,
      velocityThreshold: parseInt(process.env.ABUSE_VELOCITY_THRESHOLD) || 30,
      velocityWindowMs: parseInt(process.env.ABUSE_VELOCITY_WINDOW_MS) || 60000, // 1min
      anomalyThreshold: parseFloat(process.env.ABUSE_ANOMALY_THRESHOLD) || 0.8
    };

    // Pluggable detectors — one service, many strategies.
    this.detectors = [
      new RateDetector(this),
      new PatternDetector(this),
      new VelocityDetector(this),
      new AnomalyDetector(this)
    ];

    this.ensureDbDir();
    this.startCleanup();
    log.info('ABUSE_DETECTION', 'Service initialized', this.config);
  }

  /**
   * Increment a counter in the shared rate-limit store.
   * Falls back to an in-memory store when Redis is not configured.
   */
  async incrementCounter(key, windowMs) {
    if (rateLimitStore && typeof rateLimitStore.increment === 'function') {
      return rateLimitStore.increment(key, windowMs);
    }
    if (rateLimitStore && typeof rateLimitStore.incr === 'function') {
      return rateLimitStore.incr(key, windowMs);
    }
    return 0;
  }

  ensureDbDir() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadBlocked() {
    try {
      if (fs.existsSync(DB_PATH)) {
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      log.error('ABUSE_DETECTION', 'Failed to load blocked IPs', error);
    }
    return [];
  }

  saveBlocked() {
    try {
      const activeBlocks = this.blockedIps.filter(b => b.expiresAt > Date.now());
      fs.writeFileSync(DB_PATH, JSON.stringify(activeBlocks, null, 2));
      this.blockedIps = activeBlocks; // Update in memory
    } catch (error) {
      log.error('ABUSE_DETECTION', 'Failed to save blocked IPs', error);
    }
  }

  /**
   * Track a suspicious event for IP.
   * Runs every pluggable detector; auto-blocks when any detector fires.
   */
  async trackSuspicious(ip, context = {}) {
    if (!ip) return false;
    // Never auto-block in test environment — tests generate expected 4xx responses
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'testing') return false;

    const ctx = { ip, ...context };

    for (const detector of this.detectors) {
      let result;
      try {
        result = await detector.evaluate(ctx);
      } catch (error) {
        log.error('ABUSE_DETECTION', `Detector ${detector.name} failed`, error);
        continue;
      }
      if (result && result.suspicious) {
        log.warn('ABUSE_DETECTION', 'Suspicious event tracked', {
          ip,
          detector: detector.name,
          reason: result.reason
        });
        return this.autoBlock(ip, result.reason || detector.name);
      }
    }
    return false;
  }

  /**
   * Auto-block IP if not already blocked
   */
  autoBlock(ip, reason) {
    const now = Date.now();
    const existing = this.blockedIps.find(b => b.ip === ip && b.expiresAt > now);
    if (existing) return true;

    const block = {
      id: uuidv4(),
      ip,
      reason,
      blockedAt: now,
      expiresAt: now + this.config.blockDurationMs
    };

    this.blockedIps.push(block);
    this.saveBlocked();

    log.error('ABUSE_DETECTION', 'IP AUTO-BLOCKED', {
      ip,
      reason,
      expiresAt: new Date(block.expiresAt).toISOString()
    });

    // Alert (extend for email if nodemailer used)
    this.sendBlockAlert(ip, reason);

    return true;
  }

  /**
   * Check if IP is currently blocked
   */
  isBlocked(ip) {
    if (!ip) return false;
    const now = Date.now();
    return this.blockedIps.some(b => b.ip === ip && b.expiresAt > now);
  }

  /**
   * Get active blocked IPs for admin
   */
  getBlocked() {
    const now = Date.now();
    return this.blockedIps
      .filter(b => b.expiresAt > now)
      .sort((a, b) => b.blockedAt - a.blockedAt);
  }

  /**
   * Unblock IP (admin)
   */
  unblock(ip) {
    const beforeCount = this.blockedIps.length;
    this.blockedIps = this.blockedIps.filter(b => b.ip !== ip);
    if (this.blockedIps.length < beforeCount) {
      this.saveBlocked();
      log.info('ABUSE_DETECTION', 'IP manually unblocked', { ip });
      return true;
    }
    return false;
  }

  sendBlockAlert(ip, reason) {
    // Log alert; extend with email via nodemailer if configured
    log.error('ABUSE_ALERT', 'AUTO-BLOCK ALERT', { ip, reason });
  }

  /**
   * Cleanup expired blocks
   */
  cleanup() {
    const now = Date.now();
    const before = this.blockedIps.length;
    this.blockedIps = this.blockedIps.filter(b => b.expiresAt > now);
    if (this.blockedIps.length < before) this.saveBlocked();
    log.debug('ABUSE_DETECTION', 'Cleanup complete');
  }

  startCleanup() {
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'testing') {
      this.cleanupTimer = timerRegistry.createInterval(
        () => this.cleanup(),
        this.config.cleanupInterval,
        'abuse-detection-cleanup'
      );
      this.cleanupTimer.unref();
    }
  }

  stop() {
    if (this.cleanupTimer) {
      this.cleanupTimer.clear();
      this.cleanupTimer = null;
    }
  }
}

// Singleton
const abuseDetectionService = new AbuseDetectionService();

module.exports = abuseDetectionService;
