/**
 * IP-based Abuse Detection and Auto-Blocking Service
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

const DB_PATH = process.env.ABUSE_DB_PATH || path.join(__dirname, '../../../data/blockedIps.json');

class AbuseDetectionService {
  constructor() {
    this.suspiciousCounts = new Map(); // ip → {count: number, windowStart: number}
    this.blockedIps = this.loadBlocked();
    this.config = {
      suspiciousThreshold: parseInt(process.env.ABUSE_SUSPICIOUS_THRESHOLD) || 10,
      windowMs: parseInt(process.env.ABUSE_WINDOW_MS) || 3600000, // 1h
      blockDurationMs: parseInt(process.env.ABUSE_BLOCK_DURATION_MS) || 86400000, // 24h
      cleanupInterval: 300000 // 5min
    };

    this.ensureDbDir();
    this.startCleanup();
    log.info('ABUSE_DETECTION', 'Service initialized', this.config);
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
   * Track a suspicious event for IP
   */
  trackSuspicious(ip) {
    if (!ip) return false;

    const now = Date.now();
    let data = this.suspiciousCounts.get(ip);

    if (!data || now - data.windowStart > this.config.windowMs) {
      data = { count: 0, windowStart: now };
    }

    data.count += 1;
    this.suspiciousCounts.set(ip, data);

    log.warn('ABUSE_DETECTION', 'Suspicious event tracked', { ip, total: data.count });

    if (data.count >= this.config.suspiciousThreshold) {
      return this.autoBlock(ip, 'suspicious_threshold_exceeded');
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
    this.suspiciousCounts.delete(ip); // Reset count

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
   * Cleanup expired blocks and old counts
   */
  cleanup() {
    const now = Date.now();
    const before = this.blockedIps.length;
    this.blockedIps = this.blockedIps.filter(b => b.expiresAt > now);
    if (this.blockedIps.length < before) this.saveBlocked();

    for (const [ip, data] of this.suspiciousCounts) {
      if (now - data.windowStart > this.config.windowMs * 2) {
        this.suspiciousCounts.delete(ip);
      }
    }
    log.debug('ABUSE_DETECTION', 'Cleanup complete');
  }

  startCleanup() {
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'testing') {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.config.cleanupInterval);
    }
  }

  stop() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }
}

// Singleton
const abuseDetectionService = new AbuseDetectionService();

module.exports = abuseDetectionService;

