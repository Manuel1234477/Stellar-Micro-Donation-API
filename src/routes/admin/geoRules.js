'use strict';

/**
 * Geo-rules Admin Routes
 *
 * RESPONSIBILITY: CRUD management of geo-blocking rules at runtime
 * OWNER: Security Team
 * DEPENDENCIES: GeoRuleService, geoBlock middleware, RBAC, AuditLogService
 *
 * The single route module for geo-blocking (#1778). Replaces the former
 * src/routes/admin/geoBlocking.js.
 *
 * Endpoints:
 *   GET    /admin/geo-rules
 *   POST   /admin/geo-rules                       { countryCode, action, description? }
 *   PATCH  /admin/geo-rules/:id
 *   DELETE /admin/geo-rules/:id
 *   POST   /admin/geo-rules/test
 *   GET    /admin/geo-rules/active                 effective config + DB rules
 *   DELETE /admin/geo-rules/block/:countryCode
 *   DELETE /admin/geo-rules/allow/:countryCode
 *   GET    /admin/geo-rules/config                 static config + MaxMind DB status
 *   PUT    /admin/geo-rules/config
 *   POST   /admin/geo-rules/reload-db
 *
 * Deprecated (deprecatedRouter, mounted at /admin/geo-blocking, sunset 1 Jan 2027):
 *   GET    /admin/geo-blocking/rules               → GET  /admin/geo-rules/active
 *   POST   /admin/geo-blocking/block|allow         → POST /admin/geo-rules
 *   DELETE /admin/geo-blocking/block|allow/:cc     → DELETE /admin/geo-rules/block|allow/:cc
 *   GET    /admin/geo-blocking                     → GET  /admin/geo-rules/config
 *   PUT    /admin/geo-blocking                     → PUT  /admin/geo-rules/config
 *   POST   /admin/geo-blocking/reload-db           → POST /admin/geo-rules/reload-db
 */

/**
 * @openapi
 * tags:
 *   - name: Admin Geo Rules
 *     description: Runtime geo-blocking rules (#1778 canonical module)
 *
 * /admin/geo-rules:
 *   get:
 *     tags: [Admin Geo Rules]
 *     summary: List geo rules
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Create a geo rule (action block|allow)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/{id}:
 *   patch:
 *     tags: [Admin Geo Rules]
 *     summary: Update a geo rule
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 *   delete:
 *     tags: [Admin Geo Rules]
 *     summary: Delete a geo rule by id
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/test:
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Test whether an IP would be blocked
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/active:
 *   get:
 *     tags: [Admin Geo Rules]
 *     summary: List effective (config + database) geo rules
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/block/{countryCode}:
 *   delete:
 *     tags: [Admin Geo Rules]
 *     summary: Remove a country from the blocklist
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: countryCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/allow/{countryCode}:
 *   delete:
 *     tags: [Admin Geo Rules]
 *     summary: Remove a country from the allowlist
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: countryCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/config:
 *   get:
 *     tags: [Admin Geo Rules]
 *     summary: Get static geo-blocking config and MaxMind DB status
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 *   put:
 *     tags: [Admin Geo Rules]
 *     summary: Update static geo-blocking config (in-memory)
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-rules/reload-db:
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Reload the MaxMind GeoIP database
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking:
 *   get:
 *     tags: [Admin Geo Rules]
 *     summary: Get geo-blocking config
 *     deprecated: true
 *     description: Deprecated alias of GET /admin/geo-rules/config. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 *   put:
 *     tags: [Admin Geo Rules]
 *     summary: Update geo-blocking config
 *     deprecated: true
 *     description: Deprecated alias of PUT /admin/geo-rules/config. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/rules:
 *   get:
 *     tags: [Admin Geo Rules]
 *     summary: List effective geo rules
 *     deprecated: true
 *     description: Deprecated alias of GET /admin/geo-rules/active. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/block:
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Block a country
 *     deprecated: true
 *     description: Deprecated alias of POST /admin/geo-rules. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/block/{countryCode}:
 *   delete:
 *     tags: [Admin Geo Rules]
 *     summary: Unblock a country
 *     deprecated: true
 *     description: Deprecated alias of DELETE /admin/geo-rules/block/{countryCode}. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: countryCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/allow:
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Allow a country
 *     deprecated: true
 *     description: Deprecated alias of POST /admin/geo-rules. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/allow/{countryCode}:
 *   delete:
 *     tags: [Admin Geo Rules]
 *     summary: Remove an allowed country
 *     deprecated: true
 *     description: Deprecated alias of DELETE /admin/geo-rules/allow/{countryCode}. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: countryCode
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 * /admin/geo-blocking/reload-db:
 *   post:
 *     tags: [Admin Geo Rules]
 *     summary: Reload the MaxMind GeoIP database
 *     deprecated: true
 *     description: Deprecated alias of POST /admin/geo-rules/reload-db. Sunset 1 Jan 2027; responses carry Deprecation, Sunset and Link headers.
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Success
 *       401:
 *         description: Missing or invalid API key
 *       403:
 *         description: Admin role required
 */

const express = require('express');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const GeoRuleService = require('../../services/GeoRuleService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const { geoBlockMiddleware } = require('../../middleware/geoBlock');
const { validateSchema } = require('../../middleware/schemaValidation');
const asyncHandler = require('../../utils/asyncHandler');
const fs = require('fs');
const config = require('../../config');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { reloadGeoIpDatabase } = require('../../middleware/geoBlock');
const { deprecated } = require('../../middleware/deprecation');

const updateGeoRuleSchema = validateSchema({
  body: {
    fields: {
      active: { type: 'boolean', required: false },
      description: { type: 'string', required: false, nullable: true },
    }
  }
});

const router = express.Router();

function getActorId(req) {
  return req.user?.id?.toString() || req.apiKey?.id?.toString() || null;
}

function respondSuccess(res, payload, status = 200) {
  return res.status(status).json({ success: true, data: payload });
}

function respondError(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// One auth chain for every geo endpoint, canonical and deprecated alike.
const auth = [requireApiKey, hydrateUserFromApiKey, requireAdmin()];

/**
 * GET /admin/geo-rules
 * List all geo-blocking rules.
 */
router.get('/', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const rules = await GeoRuleService.loadRules({ forceRefresh: true });
    const shaped = rules.map((r) => ({
      id: r.id,
      countryCode: r.countryCode,
      action: r.ruleType,
      active: r.active,
      createdAt: r.createdAt,
      description: r.description || null,
    }));
    return respondSuccess(res, shaped);
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/geo-rules
 * Create a new geo-blocking rule.
 * Body: { countryCode: string, action: "block"|"allow", description?: string }
 */
router.post('/', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const { countryCode, action, description } = req.body || {};

    if (!countryCode || !GeoRuleService.isValidCountryCode(GeoRuleService.normalizeCountryCode(countryCode))) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'countryCode must be a valid ISO 3166-1 alpha-2 code');
    }

    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['block', 'allow'].includes(normalizedAction)) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'action must be "block" or "allow"');
    }

    try {
      const rule = await GeoRuleService.addRule(
        normalizedAction,
        countryCode,
        getActorId(req),
        description || null
      );

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.CONFIGURATION,
        action: 'GEO_RULE_CREATED',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: getActorId(req),
        requestId: req.id || null,
        ipAddress: req.ip || null,
        resource: req.originalUrl || req.path,
        details: { ruleId: rule.id, countryCode: rule.countryCode, action: rule.ruleType },
      });

      log.info('GEO_RULES', 'Geo rule created', { id: rule.id, countryCode: rule.countryCode, action: rule.ruleType });

      return respondSuccess(res, {
        id: rule.id,
        countryCode: rule.countryCode,
        action: rule.ruleType,
        active: rule.active,
        createdAt: rule.createdAt,
        description: rule.description || null,
      }, 201);
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('Duplicate'))) {
        return respondError(res, 409, 'DUPLICATE_GEO_RULE', `A ${normalizedAction} rule for ${GeoRuleService.normalizeCountryCode(countryCode)} already exists`);
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}));

/**
 * PATCH /admin/geo-rules/:id
 * Update a geo rule (toggle active, change description).
 * Body: { active?: boolean, description?: string }
 */
router.patch('/:id', ...auth, updateGeoRuleSchema, asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
    }

    const updates = {};
    if (typeof req.body?.active === 'boolean') {
      updates.active = req.body.active;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
      updates.description = req.body.description;
    }

    const updated = await GeoRuleService.updateById(id, updates);
    if (!updated) {
      return respondError(res, 404, 'NOT_FOUND', `Geo rule ${id} not found`);
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_RULE_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: { ruleId: id, updates },
    });

    log.info('GEO_RULES', 'Geo rule updated', { id, updates });

    return respondSuccess(res, {
      id: updated.id,
      countryCode: updated.countryCode,
      action: updated.ruleType,
      active: updated.active,
      createdAt: updated.createdAt,
      description: updated.description || null,
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * DELETE /admin/geo-rules/:id
 * Remove a geo rule by ID.
 */
router.delete('/:id', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'id must be a positive integer');
    }

    const changes = await GeoRuleService.removeById(id);
    if (!changes) {
      return respondError(res, 404, 'NOT_FOUND', `Geo rule ${id} not found`);
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'GEO_RULE_DELETED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: getActorId(req),
      requestId: req.id || null,
      ipAddress: req.ip || null,
      resource: req.originalUrl || req.path,
      details: { ruleId: id },
    });

    log.info('GEO_RULES', 'Geo rule deleted', { id });

    return respondSuccess(res, { id, removed: true });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/geo-rules/test
 * Test whether an IP address would be blocked under current rules.
 * Body: { ip: string }
 * Returns: { allowed: boolean, country: string|null, countryName: string|null, matchedRule: Object|null, defaultAction: string }
 */
router.post('/test', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'ip is required');
    }

    // Validate IP format (basic check). Fixed {3} repetition — linear, not ReDoS-prone.
    // eslint-disable-next-line security/detect-unsafe-regex
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (!ipRegex.test(ip)) {
      return respondError(res, 400, 'INVALID_IP_FORMAT', 'ip must be a valid IPv4 address');
    }

    // Check if it's a private/reserved IP
    if (isPrivateIP(ip)) {
      return respondSuccess(res, {
        allowed: true,
        country: null,
        countryName: null,
        matchedRule: null,
        defaultAction: 'allow'
      });
    }

    const databaseRules = await GeoRuleService.loadRules();
    const ruleState = geoBlockMiddleware.buildRuleState(databaseRules);
    const countryCode = geoBlockMiddleware.getCountryCode(ip);
    const decision = geoBlockMiddleware.shouldBlock(ip, ruleState);

    // Get country name from country code
    const countryName = countryCode ? getCountryName(countryCode) : null;

    // Determine matched rule details
    let matchedRule = null;
    if (decision.matchedRule) {
      const rule = databaseRules.find(r => r.countryCode === decision.matchedRule.countryCode && r.ruleType === decision.matchedRule.type);
      if (rule) {
        matchedRule = {
          id: rule.id,
          action: rule.ruleType,
          description: rule.description || null
        };
      }
    }

    return respondSuccess(res, {
      allowed: !decision.block,
      country: countryCode,
      countryName,
      matchedRule,
      defaultAction: 'allow'
    });
  } catch (err) {
    next(err);
  }
}));


// ─── Country rules, static config and GeoIP DB (moved from admin/geoBlocking.js, #1778) ──

/**
 * Send a successful JSON response with or without the response formatter helper.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {Object} payload - Response payload.
 * @param {number} [status=200] - HTTP status code.
 * @returns {import('express').Response} Response object.
 */
function respondLegacySuccess(res, payload, status = 200) {
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

        return respondLegacySuccess(res, rule, 201);
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

      return respondLegacySuccess(res, {
        countryCode,
        ruleType,
        removed: true,
      });
    } catch (error) {
      next(error);
    }
  };
}

/** GET /admin/geo-rules/active — config-backed + database-backed rules in effect. */
const listActiveRulesHandler = asyncHandler(async (req, res, next) => {
  try {
    const rules = await GeoRuleService.listActiveRules();
    return respondLegacySuccess(res, rules);
  } catch (error) {
    next(error);
  }
});

/** GET /admin/geo-rules/config — static geo-blocking configuration and DB status. */
const getConfigHandler = asyncHandler(async (req, res, next) => {
  try {
    const rules = await GeoRuleService.listActiveRules();
    return respondLegacySuccess(res, {
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
});

/** PUT /admin/geo-rules/config — update in-memory static configuration. */
const putConfigHandler = asyncHandler(async (req, res, next) => {
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

    return respondLegacySuccess(res, {
      message: 'Geo-blocking configuration updated successfully',
      blockedCountries,
      allowedCountries,
      allowedIPs,
      note: 'Static config changes are in-memory only. Runtime database rules remain unchanged.',
    });
  } catch (error) {
    next(error);
  }
});

/** POST /admin/geo-rules/reload-db — reload the MaxMind database. */
const reloadDbHandler = asyncHandler(async (req, res, next) => {
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

    return respondLegacySuccess(res, {
      message: 'MaxMind database reloaded successfully',
      dbPath: config.geoBlocking.maxmindDbPath,
    });
  } catch (error) {
    next(error);
  }
});

const blockByCountryHandler = deleteRuleHandler(GeoRuleService.GEO_RULE_TYPES.BLOCK);
const allowByCountryHandler = deleteRuleHandler(GeoRuleService.GEO_RULE_TYPES.ALLOW);

const adminAuth = auth;

/**
 * GET /admin/geo-rules/active
 */
router.get('/active', ...adminAuth, listActiveRulesHandler);

/**
 * GET /admin/geo-rules/config
 * PUT /admin/geo-rules/config
 */
router.get('/config', ...adminAuth, getConfigHandler);
router.put('/config', ...adminAuth, payloadSizeLimiter(ENDPOINT_LIMITS.admin), putConfigHandler);

/**
 * POST /admin/geo-rules/reload-db
 */
router.post('/reload-db', ...adminAuth, payloadSizeLimiter(ENDPOINT_LIMITS.admin), reloadDbHandler);

/**
 * DELETE /admin/geo-rules/block/:countryCode
 * DELETE /admin/geo-rules/allow/:countryCode
 * Remove a rule by country instead of by id.
 */
router.delete('/block/:countryCode', ...adminAuth, blockByCountryHandler);
router.delete('/allow/:countryCode', ...adminAuth, allowByCountryHandler);

// ─── Deprecated /admin/geo-blocking paths (sunset 1 Jan 2027) ───────────────
// Same handlers and response shapes as before; each response carries
// Deprecation / Sunset / Link headers pointing at the canonical route.
const deprecatedRouter = express.Router();
const cc = (req) => encodeURIComponent(req.params.countryCode);

deprecatedRouter.get('/rules', ...adminAuth, deprecated('/admin/geo-rules/active'), listActiveRulesHandler);
deprecatedRouter.post('/block', ...adminAuth, deprecated('/admin/geo-rules'), createRuleHandler(GeoRuleService.GEO_RULE_TYPES.BLOCK));
deprecatedRouter.delete('/block/:countryCode', ...adminAuth, deprecated((req) => `/admin/geo-rules/block/${cc(req)}`), blockByCountryHandler);
deprecatedRouter.post('/allow', ...adminAuth, deprecated('/admin/geo-rules'), createRuleHandler(GeoRuleService.GEO_RULE_TYPES.ALLOW));
deprecatedRouter.delete('/allow/:countryCode', ...adminAuth, deprecated((req) => `/admin/geo-rules/allow/${cc(req)}`), allowByCountryHandler);
deprecatedRouter.get('/', ...adminAuth, deprecated('/admin/geo-rules/config'), getConfigHandler);
deprecatedRouter.put('/', ...adminAuth, deprecated('/admin/geo-rules/config'), payloadSizeLimiter(ENDPOINT_LIMITS.admin), putConfigHandler);
deprecatedRouter.post('/reload-db', ...adminAuth, deprecated('/admin/geo-rules/reload-db'), payloadSizeLimiter(ENDPOINT_LIMITS.admin), reloadDbHandler);

/**
 * Check if IP is private/reserved (RFC 1918)
 * @param {string} ip - IP address
 * @returns {boolean}
 */
function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => p < 0 || p > 255)) {
    return false;
  }

  const [a, b] = parts;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (a === 169 && b === 254) return true;

  return false;
}

/**
 * Get country name from ISO country code
 * @param {string} countryCode - ISO 3166-1 alpha-2 code
 * @returns {string|null}
 */
function getCountryName(countryCode) {
  const countryNames = {
    'US': 'United States',
    'GB': 'United Kingdom',
    'CA': 'Canada',
    'AU': 'Australia',
    'DE': 'Germany',
    'FR': 'France',
    'JP': 'Japan',
    'CN': 'China',
    'IN': 'India',
    'BR': 'Brazil',
    'RU': 'Russia',
    'MX': 'Mexico',
    'IT': 'Italy',
    'ES': 'Spain',
    'KR': 'South Korea',
    'NL': 'Netherlands',
    'SE': 'Sweden',
    'CH': 'Switzerland',
    'NO': 'Norway',
    'DK': 'Denmark',
    'FI': 'Finland',
    'PL': 'Poland',
    'TR': 'Turkey',
    'SG': 'Singapore',
    'HK': 'Hong Kong',
    'NZ': 'New Zealand',
    'ZA': 'South Africa',
    'AE': 'United Arab Emirates',
    'SA': 'Saudi Arabia',
    'IL': 'Israel',
    'TH': 'Thailand',
    'MY': 'Malaysia',
    'ID': 'Indonesia',
    'PH': 'Philippines',
    'VN': 'Vietnam',
    'NG': 'Nigeria',
    'EG': 'Egypt',
    'KE': 'Kenya',
    'AR': 'Argentina',
    'CL': 'Chile',
    'CO': 'Colombia',
    'PE': 'Peru',
    'UA': 'Ukraine',
    'CZ': 'Czech Republic',
    'GR': 'Greece',
    'PT': 'Portugal',
    'BE': 'Belgium',
    'AT': 'Austria',
    'IE': 'Ireland',
    'HU': 'Hungary',
    'RO': 'Romania',
    'BG': 'Bulgaria',
    'HR': 'Croatia',
    'SI': 'Slovenia',
    'SK': 'Slovakia',
    'LT': 'Lithuania',
    'LV': 'Latvia',
    'EE': 'Estonia',
    'IS': 'Iceland',
    'LU': 'Luxembourg',
    'MT': 'Malta',
    'CY': 'Cyprus',
    'GE': 'Georgia',
    'KZ': 'Kazakhstan',
    'UZ': 'Uzbekistan',
    'TM': 'Turkmenistan',
    'KG': 'Kyrgyzstan',
    'TJ': 'Tajikistan',
    'AF': 'Afghanistan',
    'PK': 'Pakistan',
    'BD': 'Bangladesh',
    'LK': 'Sri Lanka',
    'NP': 'Nepal',
    'BT': 'Bhutan',
    'MM': 'Myanmar',
    'LA': 'Laos',
    'KH': 'Cambodia',
    'TW': 'Taiwan',
    'MO': 'Macau',
    'JO': 'Jordan',
    'LB': 'Lebanon',
    'SY': 'Syria',
    'IQ': 'Iraq',
    'IR': 'Iran',
    'OM': 'Oman',
    'QA': 'Qatar',
    'BH': 'Bahrain',
    'KW': 'Kuwait',
    'YE': 'Yemen',
    'PS': 'Palestine',
    'LY': 'Libya',
    'TN': 'Tunisia',
    'DZ': 'Algeria',
    'MA': 'Morocco',
    'SD': 'Sudan',
    'ET': 'Ethiopia',
    'SO': 'Somalia',
    'DJ': 'Djibouti',
    'ER': 'Eritrea',
    'UG': 'Uganda',
    'TZ': 'Tanzania',
    'RW': 'Rwanda',
    'BW': 'Botswana',
    'NA': 'Namibia',
    'ZM': 'Zambia',
    'ZW': 'Zimbabwe',
    'MW': 'Malawi',
    'MZ': 'Mozambique',
    'AO': 'Angola',
    'CG': 'Congo',
    'CD': 'Democratic Republic of the Congo',
    'GA': 'Gabon',
    'CM': 'Cameroon',
    'GH': 'Ghana',
    'CI': 'Ivory Coast',
    'SN': 'Senegal',
    'ML': 'Mali',
    'BF': 'Burkina Faso',
    'NE': 'Niger',
    'TD': 'Chad',
    'CF': 'Central African Republic',
    'BJ': 'Benin',
    'TG': 'Togo',
    'LR': 'Liberia',
    'SL': 'Sierra Leone',
    'GM': 'Gambia',
    'GW': 'Guinea-Bissau',
    'GN': 'Guinea',
    'MR': 'Mauritania',
    'CV': 'Cape Verde',
    'SC': 'Seychelles',
    'MU': 'Mauritius',
    'MG': 'Madagascar',
    'KM': 'Comoros',
    'FJ': 'Fiji',
    'PG': 'Papua New Guinea',
    'SB': 'Solomon Islands',
    'VU': 'Vanuatu',
    'WS': 'Samoa',
    'KI': 'Kiribati',
    'TO': 'Tonga',
    'PW': 'Palau',
    'MH': 'Marshall Islands',
    'FM': 'Micronesia',
    'NR': 'Nauru',
    'TV': 'Tuvalu',
  };
  return countryNames[countryCode] || null;
}

module.exports = router;
module.exports.deprecatedRouter = deprecatedRouter;
