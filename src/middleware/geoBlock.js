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
const config = require('../config');
const log = require('../utils/log');
const AuditLogService = require('../services/AuditLogService');
const GeoRuleService = require('../services/GeoRuleService');

/**
 * Geo-blocking middleware class
 */
class GeoBlockMiddleware {
  constructor(options = {}) {
    this.lookup = null;
    this.initialized = false;
    this.ruleService = options.ruleService || GeoRuleService;
    this.auditLogService = options.auditLogService || AuditLogService;
    if (process.env.NODE_ENV !== 'test') {
      this.initPromise = this.initialize();
    } else {
      this.initPromise = Promise.resolve();
    }
  }

  /**
   * Initialize MaxMind database
   * @returns {Promise<void>}
   */
  async initialize(forceReload = false) {
    try {
      const dbPath = config.geoBlocking.maxmindDbPath;

      // Check if database file exists
      if (!fs.existsSync(dbPath)) {
        log.warn('GEO_BLOCK', `MaxMind database not found at ${dbPath}. Geo-blocking will be disabled.`);
        this.initialized = false;
        return;
      }

      // Open the database
      if (!forceReload && this.lookup && this.initialized) {
        return;
      }

      this.lookup = await maxmind.open(dbPath);
      this.initialized = true;
      log.info('GEO_BLOCK', `MaxMind GeoIP database loaded from ${dbPath}`);
    } catch (error) {
      log.error('GEO_BLOCK', 'Failed to initialize MaxMind database', { error: error.message });
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
      const result = this.lookup.get(this.normalizeIp(ip));
      return result?.country?.iso_code || null;
    } catch (error) {
      log.warn('GEO_BLOCK', `Failed to lookup country for IP ${ip}`, { error: error.message });
      return null;
    }
  }

  /**
   * Check if IP is in allowlist
   * @param {string} ip - IP address to check
   * @returns {boolean} True if IP is allowlisted
   */
  isIPAllowlisted(ip) {
    const normalizedIp = this.normalizeIp(ip);
    const allowedIPs = config.geoBlocking.allowedIPs;
    if (!allowedIPs.length) {
      return false;
    }

    // Check exact IP matches
    if (allowedIPs.includes(normalizedIp)) {
      return true;
    }

    // Check CIDR ranges
    for (const allowedIP of allowedIPs) {
      if (this.isIPInCIDR(normalizedIp, allowedIP)) {
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
      const prefixLength = Number.parseInt(bits, 10);
      if (!bits || !Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
        return false;
      }

      const mask = prefixLength === 0 ? 0 : ~(2 ** (32 - prefixLength) - 1);
      const [a, b, c, d] = ip.split('.').map(Number);
      const [ra, rb, rc, rd] = range.split('.').map(Number);

      if ([a, b, c, d, ra, rb, rc, rd].some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
      }

      const ipNum = (a << 24) | (b << 16) | (c << 8) | d;
      const rangeNum = (ra << 24) | (rb << 16) | (rc << 8) | rd;

      return (ipNum & mask) === (rangeNum & mask);
    } catch (error) {
      return false;
    }
  }

  /**
   * Normalize a client IP for consistent lookup and allowlist checks.
   * @param {string} ip - Raw client IP.
   * @returns {string} Normalized IP address.
   */
  normalizeIp(ip) {
    const rawIp = String(ip || '').split(',')[0].trim();

    if (rawIp.startsWith('::ffff:')) {
      return rawIp.substring('::ffff:'.length);
    }

    return rawIp || '127.0.0.1';
  }

  /**
   * Build effective allow/block rules from static config and cached DB rules.
   * @param {Array<Object>} [databaseRules=[]] - Database-backed geo rules.
   * @returns {Object} Effective geo rule state.
   */
  buildRuleState(databaseRules = []) {
    const configAllowedCountries = new Set(
      config.geoBlocking.allowedCountries.map((countryCode) => String(countryCode).trim().toUpperCase())
    );
    const configBlockedCountries = new Set(
      config.geoBlocking.blockedCountries.map((countryCode) => String(countryCode).trim().toUpperCase())
    );
    const dbAllowedCountries = new Set();
    const dbBlockedCountries = new Set();

    for (const rule of databaseRules) {
      if (rule.ruleType === 'allow') {
        dbAllowedCountries.add(rule.countryCode);
      }

      if (rule.ruleType === 'block') {
        dbBlockedCountries.add(rule.countryCode);
      }
    }

    return {
      allowedCountries: new Set([...configAllowedCountries, ...dbAllowedCountries]),
      blockedCountries: new Set([...configBlockedCountries, ...dbBlockedCountries]),
      configAllowedCountries,
      configBlockedCountries,
      dbAllowedCountries,
      dbBlockedCountries,
    };
  }

  /**
   * Check whether any geo restrictions are currently active.
   * @param {Object} ruleState - Effective geo rule state.
   * @returns {boolean} True when geo checks should run.
   */
  hasActiveRules(ruleState) {
    return Boolean(
      config.geoBlocking.allowedIPs.length ||
      ruleState.allowedCountries.size ||
      ruleState.blockedCountries.size
    );
  }

  /**
   * Check if request should be blocked
   * @param {string} ip - Client IP address
   * @param {Object} [ruleState] - Effective geo rule state
   * @returns {Object} Block decision with reason
   */
  shouldBlock(ip, ruleState = this.buildRuleState(this.ruleService.getCachedRules())) {
    const normalizedIp = this.normalizeIp(ip);

    // IP allowlist takes precedence
    if (this.isIPAllowlisted(normalizedIp)) {
      return { block: false, reason: null };
    }

    const countryCode = this.getCountryCode(normalizedIp);

    // If no country found and no blocking configured, allow
    if (!countryCode) {
      return { block: false, reason: null };
    }

    // Check allowlist first (takes precedence over blocklist)
    if (ruleState.allowedCountries.has(countryCode)) {
      return { block: false, reason: null };
    }

    // Check blocklist
    if (ruleState.blockedCountries.has(countryCode)) {
      const source = ruleState.dbBlockedCountries.has(countryCode) ? 'database' : 'config';

      return {
        block: true,
        reason: 'geo',
        countryCode,
        matchedRule: {
          type: 'block',
          countryCode,
          source,
        }
      };
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

    const databaseRules = await this.ruleService.loadRules();
    const ruleState = this.buildRuleState(databaseRules);

    // Skip if geo-blocking is not configured
    if (!this.hasActiveRules(ruleState)) {
      return next();
    }

    // Get client IP
    const clientIP = this.normalizeIp(req.ip || req.connection.remoteAddress ||
                     (req.socket && req.socket.remoteAddress) ||
                     (req.connection.socket && req.connection.socket.remoteAddress) ||
                     '127.0.0.1');

    const decision = this.shouldBlock(clientIP, ruleState);

    if (decision.block) {
      // Log blocked request
      log.warn('GEO_BLOCK', 'Request blocked by geo-blocking', {
        ip: clientIP,
        country: decision.countryCode,
        path: req.path,
        method: req.method,
        userAgent: req.get('User-Agent'),
        reason: decision.reason,
        matchedRule: decision.matchedRule
      });

      await this.auditLogService.log({
        category: this.auditLogService.CATEGORY.AUTHORIZATION,
        action: 'GEO_REQUEST_BLOCKED',
        severity: this.auditLogService.SEVERITY.MEDIUM,
        result: 'FAILURE',
        userId: req.user?.id || req.apiKey?.id?.toString() || null,
        requestId: req.id || null,
        ipAddress: clientIP,
        resource: req.originalUrl || req.path,
        reason: 'Blocked by geographic access policy',
        details: {
          detectedCountry: decision.countryCode,
          matchedRule: decision.matchedRule,
          method: req.method,
          path: req.path,
          userAgent: req.get('User-Agent'),
        }
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
module.exports.reloadGeoIpDatabase = () => geoBlockMiddleware.initialize(true);
module.exports.geoBlockMiddleware = geoBlockMiddleware;
