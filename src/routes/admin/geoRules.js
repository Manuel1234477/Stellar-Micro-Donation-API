'use strict';

/**
 * Geo-rules Admin Routes
 *
 * RESPONSIBILITY: CRUD management of geo-blocking rules at runtime
 * OWNER: Security Team
 * DEPENDENCIES: GeoRuleService, geoBlock middleware, RBAC, AuditLogService
 *
 * Endpoints:
 *   GET    /admin/geo-rules
 *   POST   /admin/geo-rules
 *   PATCH  /admin/geo-rules/:id
 *   DELETE /admin/geo-rules/:id
 *   POST   /admin/geo-rules/test
 */

const express = require('express');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const GeoRuleService = require('../../services/GeoRuleService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const { geoBlockMiddleware } = require('../../middleware/geoBlock');

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

const auth = [requireApiKey, requireAdmin()];

/**
 * GET /admin/geo-rules
 * List all geo-blocking rules.
 */
router.get('/', ...auth, async (req, res, next) => {
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
});

/**
 * POST /admin/geo-rules
 * Create a new geo-blocking rule.
 * Body: { countryCode: string, action: "block"|"allow", description?: string }
 */
router.post('/', ...auth, async (req, res, next) => {
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
});

/**
 * PATCH /admin/geo-rules/:id
 * Update a geo rule (toggle active, change description).
 * Body: { active?: boolean, description?: string }
 */
router.patch('/:id', ...auth, async (req, res, next) => {
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
});

/**
 * DELETE /admin/geo-rules/:id
 * Remove a geo rule by ID.
 */
router.delete('/:id', ...auth, async (req, res, next) => {
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
});

/**
 * POST /admin/geo-rules/test
 * Test whether an IP address would be blocked under current rules.
 * Body: { ip: string }
 */
router.post('/test', ...auth, async (req, res, next) => {
  try {
    const ip = String(req.body?.ip || '').trim();
    if (!ip) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'ip is required');
    }

    const databaseRules = await GeoRuleService.loadRules();
    const ruleState = geoBlockMiddleware.buildRuleState(databaseRules);
    const country = geoBlockMiddleware.getCountryCode(ip) || null;
    const decision = geoBlockMiddleware.shouldBlock(ip, ruleState);

    return respondSuccess(res, {
      allowed: !decision.block,
      matchedRule: decision.matchedRule || null,
      country,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
