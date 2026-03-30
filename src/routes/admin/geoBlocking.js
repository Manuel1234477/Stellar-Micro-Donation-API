/**
 * Geographic Blocking Admin Routes - Dynamic Geo-blocking Configuration API
 *
 * RESPONSIBILITY: Admin endpoints for managing geographic IP blocking configuration
 * OWNER: Security Team
 * DEPENDENCIES: RBAC middleware, validation, audit logging
 *
 * Provides admin-only endpoints for:
 * - Viewing current geo-blocking configuration
 * - Updating blocked/allowed countries and IPs
 * - Reloading MaxMind database
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { ValidationError } = require('../../utils/errors');
const { validateSchema } = require('../../middleware/schemaValidation');
const AuditLogService = require('../../services/AuditLogService');
const config = require('../../config');
const logger = require('../../middleware/logger');
const fs = require('fs');
const path = require('path');

/**
 * GET /admin/geo-blocking
 * Get current geo-blocking configuration
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const geoConfig = {
      blockedCountries: config.geoBlocking.blockedCountries,
      allowedCountries: config.geoBlocking.allowedCountries,
      allowedIPs: config.geoBlocking.allowedIPs,
      maxmindDbPath: config.geoBlocking.maxmindDbPath,
      dbExists: fs.existsSync(config.geoBlocking.maxmindDbPath)
    };

    res.success(geoConfig);
  } catch (error) {
    next(error);
  }
});

/**
 * PUT /admin/geo-blocking
 * Update geo-blocking configuration
 *
 * Body:
 * - blockedCountries: Array of ISO country codes to block
 * - allowedCountries: Array of ISO country codes to allow
 * - allowedIPs: Array of IP addresses/CIDR ranges to allow
 */
router.put('/', checkPermission(PERMISSIONS.ADMIN_ALL), validateSchema({
  type: 'object',
  properties: {
    blockedCountries: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Z]{2}$' },
      maxItems: 100
    },
    allowedCountries: {
      type: 'array',
      items: { type: 'string', pattern: '^[A-Z]{2}$' },
      maxItems: 100
    },
    allowedIPs: {
      type: 'array',
      items: { type: 'string', pattern: '^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?:\\/[0-9]{1,2})?$' },
      maxItems: 100
    }
  },
  additionalProperties: false
}), async (req, res, next) => {
  try {
    const { blockedCountries = [], allowedCountries = [], allowedIPs = [] } = req.body;

    // Validate country codes are valid ISO codes
    const invalidBlocked = blockedCountries.filter(code => !isValidCountryCode(code));
    const invalidAllowed = allowedCountries.filter(code => !isValidCountryCode(code));

    if (invalidBlocked.length > 0 || invalidAllowed.length > 0) {
      throw new ValidationError(
        `Invalid country codes: ${[...invalidBlocked, ...invalidAllowed].join(', ')}`
      );
    }

    // Validate IP addresses/CIDR ranges
    const invalidIPs = allowedIPs.filter(ip => !isValidIPOrCIDR(ip));
    if (invalidIPs.length > 0) {
      throw new ValidationError(`Invalid IP addresses/CIDR ranges: ${invalidIPs.join(', ')}`);
    }

    // Update environment variables (in-memory only - restart required for persistence)
    process.env.GEO_BLOCKED_COUNTRIES = blockedCountries.join(',');
    process.env.GEO_ALLOWED_COUNTRIES = allowedCountries.join(',');
    process.env.GEO_ALLOWED_IPS = allowedIPs.join(',');

    // Update config object
    config.geoBlocking.blockedCountries = blockedCountries;
    config.geoBlocking.allowedCountries = allowedCountries;
    config.geoBlocking.allowedIPs = allowedIPs;

    // Audit log the change
    await AuditLogService.log({
      action: 'GEO_BLOCKING_UPDATE',
      entityType: 'configuration',
      entityId: 'geo-blocking',
      details: {
        blockedCountries,
        allowedCountries,
        allowedIPs
      },
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      adminId: req.apiKey?.id || 'unknown'
    });

    logger.info('Geo-blocking configuration updated', {
      blockedCountries,
      allowedCountries,
      allowedIPs,
      adminId: req.apiKey?.id || 'unknown'
    });

    res.success({
      message: 'Geo-blocking configuration updated successfully',
      blockedCountries,
      allowedCountries,
      allowedIPs,
      note: 'Changes are in-memory only. Restart server to persist or update environment variables.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/geo-blocking/reload-db
 * Reload MaxMind database
 */
router.post('/reload-db', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const geoBlockMiddleware = require('../../middleware/geoBlock');

    // Reinitialize the middleware
    if (geoBlockMiddleware.GeoBlockMiddleware) {
      const instance = new geoBlockMiddleware.GeoBlockMiddleware();
      await instance.initialize();

      // Replace the global instance
      Object.setPrototypeOf(geoBlockMiddleware, instance);
    }

    // Audit log
    await AuditLogService.log({
      action: 'GEO_DB_RELOAD',
      entityType: 'configuration',
      entityId: 'maxmind-db',
      details: { dbPath: config.geoBlocking.maxmindDbPath },
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      adminId: req.apiKey?.id || 'unknown'
    });

    logger.info('MaxMind database reloaded', {
      dbPath: config.geoBlocking.maxmindDbPath,
      adminId: req.apiKey?.id || 'unknown'
    });

    res.success({
      message: 'MaxMind database reloaded successfully',
      dbPath: config.geoBlocking.maxmindDbPath
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Validate ISO country code
 * @param {string} code - Country code to validate
 * @returns {boolean} True if valid
 */
function isValidCountryCode(code) {
  // Basic validation - 2 uppercase letters
  return /^[A-Z]{2}$/.test(code);
}

/**
 * Validate IP address or CIDR range
 * @param {string} ip - IP or CIDR to validate
 * @returns {boolean} True if valid
 */
function isValidIPOrCIDR(ip) {
  // Basic IP validation
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  const cidrRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/;

  if (ipRegex.test(ip)) {
    // Validate IP address ranges
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }

  if (cidrRegex.test(ip)) {
    // Validate CIDR
    const [ipPart, mask] = ip.split('/');
    const maskNum = parseInt(mask);
    const parts = ipPart.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255) && maskNum >= 0 && maskNum <= 32;
  }

  return false;
}

module.exports = router;