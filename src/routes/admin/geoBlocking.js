'use strict';

/**
 * Geographic Blocking Admin Routes
 *
 * RESPONSIBILITY: Runtime management of country-level geo allow/block rules
 * OWNER: Security Team
 * DEPENDENCIES: GeoRuleService, geo middleware, RBAC, audit logging
 *
 * Primary endpoints:
 * - POST   /admin/geo/block
 * - DELETE /admin/geo/block/:countryCode
 * - POST   /admin/geo/allow
 * - DELETE /admin/geo/allow/:countryCode
 * - GET    /admin/geo/rules
 *
 * Legacy endpoints under /admin/geo-blocking are preserved for compatibility.
 */

const express = require('express');
const fs = require('fs');
const config = require('../../config');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const AuditLogService = require('../../services/AuditLogService');
const GeoRuleService = require('../../services/GeoRuleService');
const log = require('../../utils/log');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { reloadGeoIpDatabase } = require('../../middleware/geoBlock');

const router = express.Router();

/**
 * Send a successful JSON response with or without the response formatter helper.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {Object} payload - Response payload.
 * @param {number} [status=200] - HTTP status code.
 * @returns {import('express').Response} Response object.
 */
function respondSuccess(res, payload, status = 200) {
  if (typeof res.success === 'function') {
    return res.status(status).success(payload);
  }

  return res.status(status).json({ success: true, data: payload });
}

/**
 * Build a normalized validation error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} message - Validation message.
 * @returns {import('express').Response} Response object.
 */
function respondValidationError(res, message) {
  return res.status(400).json({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
    },
  });
}

/**
 * Resolve the acting admin identifier for audit entries.
 *
 * @param {import('express').Request} req - Express request object.
 * @returns {string|null} Admin identifier.
 */
function getActorId(req) {
  return req.user?.id?.toString() || req.apiKey?.id?.toString() || null;
}

/**
 * Validate and normalize a country code.
 *
 * @param {string} countryCode - Raw country code.
 * @returns {string|null} Normalized code or null when invalid.
 */
function getCountryCodeOrNull(countryCode) {
  const normalizedCountryCode = GeoRuleService.normalizeCountryCode(countryCode);
  return GeoRuleService.isValidCountryCode(normalizedCountryCode)
    ? normalizedCountryCode
    : null;
}

/**
 * Validate an IPv4 address or CIDR block.
 *
 * @param {string} value - Raw IP or CIDR string.
 * @returns {boolean} True when valid.
 */
function isValidIPOrCIDR(value) {
  const input = String(value || '').trim();
  const parts = input.split('/');
  const ip = parts[0];
  const mask = parts[1];
  const octets = ip.split('.').map(Number);

  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  if (mask === undefined) {
    return true;
  }

  const numericMask = Number.parseInt(mask, 10);
  return Number.isInteger(numericMask) && numericMask >= 0 && numericMask <= 32;
}

/**
 * Backfill req.user from a validated API key when tests mount the router in isolation.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next callback.
 * @returns {void}
 */
function hydrateUserFromApiKey(req, res, next) {
  void res;

  if (!req.user && req.apiKey) {
    req.user = {
      id: req.apiKey.id?.toString() || 'geo-admin',
      role: req.apiKey.role || 'admin',
    };
  }

  next();
}

/**
 * Write an audit entry for a geo rule change.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {string} action - Audit action string.
 * @param {string} ruleType - Geo rule type.
 * @param {string} countryCode - Country code affected.
 * @returns {Promise<void>}
 */
async function logGeoRuleChange(req, action, ruleType, countryCode) {
  await AuditLogService.log({
    category: AuditLogService.CATEGORY.CONFIGURATION,
    action,
    severity: AuditLogService.SEVERITY.MEDIUM,
    result: 'SUCCESS',
    userId: getActorId(req),
    requestId: req.id || null,
    ipAddress: req.ip || null,
    resource: req.originalUrl || req.path,
    details: {
      ruleType,
      countryCode,
      adminId: getActorId(req),
    },
  });
}

/**
 * POST helper for creating a geo rule.
 *
 * @param {'allow'|'block'} ruleType - Geo rule type.
 * @returns {Function} Express route handler.
 */
function createRuleHandler(ruleType) {
  return async (req, res, next) => {
    try {
      const countryCode = getCountryCodeOrNull(req.body?.countryCode);
      if (!countryCode) {
        return respondValidationError(res, 'countryCode must be a valid ISO 3166-1 alpha-2 code');
      }

      try {
        const rule = await GeoRuleService.addRule(ruleType, countryCode, getActorId(req));

        await logGeoRuleChange(
          req,
          ruleType === GeoRuleService.GEO_RULE_TYPES.BLOCK ? 'GEO_RULE_BLOCK_CREATED' : 'GEO_RULE_ALLOW_CREATED',
          ruleType,
          countryCode
        );

        log.info('GEO_RULES', `Geo ${ruleType} rule created`, {
          countryCode,
          adminId: getActorId(req),
        });

        return respondSuccess(res, rule, 201);
      } catch (error) {
        if (error.message && (error.message.includes('UNIQUE') || error.message.includes('Duplicate'))) {
          return res.status(409).json({
            success: false,
            error: {
              code: 'DUPLICATE_GEO_RULE',
              message: `${countryCode} is already present in the ${ruleType}list`,
            },
          });
        }

        throw error;
      }
    } catch (error) {
      next(error);
    }
  };
}

/**
 * DELETE helper for removing a geo rule.
 *
 * @param {'allow'|'block'} ruleType - Geo rule type.
 * @returns {Function} Express route handler.
 */
function deleteRuleHandler(ruleType) {
  return async (req, res, next) => {
    try {
      const countryCode = getCountryCodeOrNull(req.params.countryCode);
      if (!countryCode) {
        return respondValidationError(res, 'countryCode must be a valid ISO 3166-1 alpha-2 code');
      }

      const changes = await GeoRuleService.removeRule(ruleType, countryCode);
      if (!changes) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `No ${ruleType} rule exists for ${countryCode}`,
          },
        });
      }

      await logGeoRuleChange(
        req,
        ruleType === GeoRuleService.GEO_RULE_TYPES.BLOCK ? 'GEO_RULE_BLOCK_DELETED' : 'GEO_RULE_ALLOW_DELETED',
        ruleType,
        countryCode
      );

      log.info('GEO_RULES', `Geo ${ruleType} rule deleted`, {
        countryCode,
        adminId: getActorId(req),
      });

      return respondSuccess(res, {
        countryCode,
        ruleType,
        removed: true,
      });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * GET /rules
 * List active config-backed and database-backed geo rules.
 */
router.get('/rules', requireApiKey, hydrateUserFromApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const rules = await GeoRuleService.listActiveRules();
    return respondSuccess(res, rules);
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /block
 * Add a country to the runtime blocklist.
 */
router.post(
  '/block',
  requireApiKey,
  hydrateUserFromApiKey,
  requireAdmin(),
  createRuleHandler(GeoRuleService.GEO_RULE_TYPES.BLOCK)
);

/**
 * DELETE /block/:countryCode
 * Remove a country from the runtime blocklist.
 */
router.delete(
  '/block/:countryCode',
  requireApiKey,
  hydrateUserFromApiKey,
  requireAdmin(),
  deleteRuleHandler(GeoRuleService.GEO_RULE_TYPES.BLOCK)
);

/**
 * POST /allow
 * Add a country to the runtime allowlist.
 */
router.post(
  '/allow',
  requireApiKey,
  hydrateUserFromApiKey,
  requireAdmin(),
  createRuleHandler(GeoRuleService.GEO_RULE_TYPES.ALLOW)
);

/**
 * DELETE /allow/:countryCode
 * Remove a country from the runtime allowlist.
 */
router.delete(
  '/allow/:countryCode',
  requireApiKey,
  hydrateUserFromApiKey,
  requireAdmin(),
  deleteRuleHandler(GeoRuleService.GEO_RULE_TYPES.ALLOW)
);

/**
 * GET /
 * Legacy endpoint for returning geo-blocking configuration.
 */
router.get('/', requireApiKey, hydrateUserFromApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const rules = await GeoRuleService.listActiveRules();
    return respondSuccess(res, {
      blockedCountries: rules.effective.blockCountries,
      allowedCountries: rules.effective.allowCountries,
      allowedIPs: [...config.geoBlocking.allowedIPs],
      maxmindDbPath: config.geoBlocking.maxmindDbPath,
      dbExists: fs.existsSync(config.geoBlocking.maxmindDbPath),
      databaseRules: rules.database.rules,
      cache: rules.cache,
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * PUT /
 * Legacy endpoint for updating static in-memory config values.
 */
router.put('/', requireApiKey, hydrateUserFromApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const blockedCountries = Array.isArray(req.body?.blockedCountries)
      ? req.body.blockedCountries.map(GeoRuleService.normalizeCountryCode)
      : [];
    const allowedCountries = Array.isArray(req.body?.allowedCountries)
      ? req.body.allowedCountries.map(GeoRuleService.normalizeCountryCode)
      : [];
    const allowedIPs = Array.isArray(req.body?.allowedIPs)
      ? req.body.allowedIPs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];

    const invalidCountryCode = [...blockedCountries, ...allowedCountries].find(
      (countryCode) => !GeoRuleService.isValidCountryCode(countryCode)
    );
    const invalidIP = allowedIPs.find((value) => !isValidIPOrCIDR(value));

    if (invalidCountryCode) {
      return respondValidationError(res, `Invalid country code: ${invalidCountryCode}`);
    }

    if (invalidIP) {
      return respondValidationError(res, `Invalid IP addresses/CIDR ranges: ${invalidIP}`);
    }

    process.env.GEO_BLOCKED_COUNTRIES = blockedCountries.join(',');
    process.env.GEO_ALLOWED_COUNTRIES = allowedCountries.join(',');
    process.env.GEO_ALLOWED_IPS = allowedIPs.join(',');

    config.geoBlocking.blockedCountries = blockedCountries;
    config.geoBlocking.allowedCountries = allowedCountries;
    config.geoBlocking.allowedIPs = allowedIPs;

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_CONFIG_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: {
        blockedCountries,
        allowedCountries,
        allowedIPs,
      },
    });

    return respondSuccess(res, {
      message: 'Geo-blocking configuration updated successfully',
      blockedCountries,
      allowedCountries,
      allowedIPs,
      note: 'Static config changes are in-memory only. Runtime database rules remain unchanged.',
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /reload-db
 * Reload the MaxMind database without restarting the API.
 */
router.post('/reload-db', requireApiKey, hydrateUserFromApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    await reloadGeoIpDatabase();

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_DB_RELOAD',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: {
        dbPath: config.geoBlocking.maxmindDbPath,
      },
    });

    return respondSuccess(res, {
      message: 'MaxMind database reloaded successfully',
      dbPath: config.geoBlocking.maxmindDbPath,
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
