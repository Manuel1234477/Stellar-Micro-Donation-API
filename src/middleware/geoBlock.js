/**
 * Geographic IP Blocking Middleware
 *
 * RESPONSIBILITY: Block requests from specified countries and allowlisted IPs
 * OWNER: Security Team
 * DEPENDENCIES: maxmind, config, logger
 *
 * Implements geographic IP blocking using MaxMind GeoIP database.
 * Supports blocking by country codes, allowlisting by country codes, and IP allowlisting.
 * Logs all blocked requests for audit purposes.
 */

const maxmind = require('maxmind');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

/**
 * Geo-blocking middleware class
 */
class GeoBlockMiddleware {
  constructor() {
    this.lookup = null;
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  /**
   * Initialize MaxMind database
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const dbPath = config.geoBlocking.maxmindDbPath;

      // Check if database file exists
      if (!fs.existsSync(dbPath)) {
        logger.warn(`MaxMind database not found at ${dbPath}. Geo-blocking will be disabled.`);
        this.initialized = false;
        return;
      }

      // Open the database
      this.lookup = await maxmind.open(dbPath);
      this.initialized = true;
      logger.info(`MaxMind GeoIP database loaded from ${dbPath}`);
    } catch (error) {
      logger.error('Failed to initialize MaxMind database:', error);
      this.initialized = false;
    }
  }

  /**
   * Get country code for an IP address
   * @param {string} ip - IP address to lookup
   * @returns {string|null} ISO country code or null if not found
   */
  getCountryCode(ip) {
    if (!this.initialized || !this.lookup) {
      return null;
    }

    try {
      const result = this.lookup.get(ip);
      return result?.country?.iso_code || null;
    } catch (error) {
      logger.warn(`Failed to lookup country for IP ${ip}:`, error);
      return null;
    }
  }

  /**
   * Check if IP is in allowlist
   * @param {string} ip - IP address to check
   * @returns {boolean} True if IP is allowlisted
   */
  isIPAllowlisted(ip) {
    const allowedIPs = config.geoBlocking.allowedIPs;
    if (!allowedIPs.length) {
      return false;
    }

    // Check exact IP matches
    if (allowedIPs.includes(ip)) {
      return true;
    }

    // Check CIDR ranges
    for (const allowedIP of allowedIPs) {
      if (this.isIPInCIDR(ip, allowedIP)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP is within a CIDR range
   * @param {string} ip - IP address to check
   * @param {string} cidr - CIDR range (e.g., "192.168.1.0/24")
   * @returns {boolean} True if IP is in range
   */
  isIPInCIDR(ip, cidr) {
    try {
      const [range, bits] = cidr.split('/');
      if (!bits) return false;

      const mask = ~(2 ** (32 - parseInt(bits)) - 1);
      const [a, b, c, d] = ip.split('.').map(Number);
      const [ra, rb, rc, rd] = range.split('.').map(Number);

      const ipNum = (a << 24) | (b << 16) | (c << 8) | d;
      const rangeNum = (ra << 24) | (rb << 16) | (rc << 8) | rd;

      return (ipNum & mask) === (rangeNum & mask);
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if request should be blocked
   * @param {string} ip - Client IP address
   * @returns {Object} Block decision with reason
   */
  shouldBlock(ip) {
    // IP allowlist takes precedence
    if (this.isIPAllowlisted(ip)) {
      return { block: false, reason: null };
    }

    const countryCode = this.getCountryCode(ip);

    // If no country found and no blocking configured, allow
    if (!countryCode) {
      return { block: false, reason: null };
    }

    const blockedCountries = config.geoBlocking.blockedCountries;
    const allowedCountries = config.geoBlocking.allowedCountries;

    // Check allowlist first (takes precedence over blocklist)
    if (allowedCountries.length > 0 && allowedCountries.includes(countryCode)) {
      return { block: false, reason: null };
    }

    // Check blocklist
    if (blockedCountries.length > 0 && blockedCountries.includes(countryCode)) {
      return { block: true, reason: 'geo', countryCode };
    }

    return { block: false, reason: null };
  }

  /**
   * Middleware function
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @param {Function} next - Express next function
   */
  async middleware(req, res, next) {
    // Wait for initialization if not ready
    if (!this.initialized) {
      await this.initPromise;
    }

    // Skip if geo-blocking is not configured
    if (!config.geoBlocking.blockedCountries.length &&
        !config.geoBlocking.allowedCountries.length &&
        !config.geoBlocking.allowedIPs.length) {
      return next();
    }

    // Get client IP
    const clientIP = req.ip || req.connection.remoteAddress ||
                     (req.socket && req.socket.remoteAddress) ||
                     (req.connection.socket && req.connection.socket.remoteAddress) ||
                     '127.0.0.1';

    const decision = this.shouldBlock(clientIP);

    if (decision.block) {
      // Log blocked request
      logger.warn('Request blocked by geo-blocking', {
        ip: clientIP,
        country: decision.countryCode,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent'),
        reason: decision.reason
      });

      // Return 403 with custom header
      res.set('X-Blocked-Reason', decision.reason);
      return res.status(403).json({
        success: false,
        error: {
          code: 'GEO_BLOCKED',
          message: 'Access denied from your location'
        }
      });
    }

    next();
  }
}

// Create singleton instance
const geoBlockMiddleware = new GeoBlockMiddleware();

// Export middleware function
module.exports = (req, res, next) => geoBlockMiddleware.middleware(req, res, next);

// Export class for testing
module.exports.GeoBlockMiddleware = GeoBlockMiddleware;