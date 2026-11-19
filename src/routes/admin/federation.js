'use strict';

/**
 * Federation Records Admin Routes (issue #1938)
 *
 * RESPONSIBILITY: Runtime CRUD for SEP-0002 federation records
 * OWNER: Backend Team
 * DEPENDENCIES: FederationRecordService, RBAC, AuditLogService
 *
 * Endpoints (mounted at /admin/federation):
 *   GET    /admin/federation            ?limit=&offset=
 *   GET    /admin/federation/:name
 *   POST   /admin/federation            { name, account_id, memo_type?, memo? }
 *   PATCH  /admin/federation/:name      { account_id?, memo_type?, memo? }
 *   DELETE /admin/federation/:name
 *
 * Every change is written to the audit log. Invalid account ids or memos are
 * rejected with 400 before anything is stored.
 */

const express = require('express');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const FederationRecordService = require('../../services/FederationRecordService');
const AuditLogService = require('../../services/AuditLogService');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Same auth chain as the other admin modules: API key, then admin role.
const auth = [requireApiKey, hydrateUserFromApiKey, requireAdmin()];

function hydrateUserFromApiKey(req, res, next) {
  void res;
  if (!req.user && req.apiKey) {
    req.user = {
      id: req.apiKey.id?.toString() || 'federation-admin',
      role: req.apiKey.role || 'admin',
      name: req.apiKey.name || 'Federation admin',
      scopes: req.apiKey.scopes || [],
    };
  }
  next();
}

function getActorId(req) {
  return req.user?.id?.toString() || req.apiKey?.id?.toString() || null;
}

function respondError(res, status, code, message, details) {
  const body = { success: false, error: { code, message } };
  if (details) body.error.details = details;
  return res.status(status).json(body);
}

async function audit(req, action, name, details) {
  await AuditLogService.log({
    category: AuditLogService.CATEGORY.CONFIGURATION,
    action,
    severity: AuditLogService.SEVERITY.MEDIUM,
    result: 'SUCCESS',
    userId: getActorId(req),
    requestId: req.id || null,
    ipAddress: req.ip || null,
    resource: req.originalUrl || req.path,
    details: { federationName: name, ...details },
  }).catch(() => {});
}

function parsePaging(query) {
  let limit = DEFAULT_PAGE_SIZE;
  let offset = 0;
  if (query.limit !== undefined) {
    const parsed = parseInt(query.limit, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) {
      return { error: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}` };
    }
    limit = parsed;
  }
  if (query.offset !== undefined) {
    const parsed = parseInt(query.offset, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { error: 'offset must be a non-negative integer' };
    }
    offset = parsed;
  }
  return { limit, offset };
}

/**
 * GET /admin/federation
 */
router.get('/', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const page = parsePaging(req.query);
    if (page.error) return respondError(res, 400, 'VALIDATION_ERROR', page.error);
    const records = await FederationRecordService.list(page);
    return res.json({ success: true, data: records, pagination: { limit: page.limit, offset: page.offset } });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /admin/federation/:name
 */
router.get('/:name', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const record = await FederationRecordService.getByName(req.params.name);
    if (!record) return respondError(res, 404, 'NOT_FOUND', 'Federation record not found');
    return res.json({ success: true, data: record });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/federation
 */
router.post('/', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const checked = FederationRecordService.validateRecord(req.body || {});
    if (!checked.valid) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'Invalid federation record', checked.errors);
    }

    const result = await FederationRecordService.create(checked.value);
    if (result.conflict) {
      return respondError(res, 409, 'RESOURCE_CONFLICT', 'A federation record with this name already exists');
    }

    await audit(req, 'FEDERATION_RECORD_CREATED', checked.value.name, {
      account_id: checked.value.account_id,
      memo_type: checked.value.memo_type,
    });
    return res.status(201).json({ success: true, data: result.record });
  } catch (err) {
    next(err);
  }
}));

/**
 * PATCH /admin/federation/:name
 */
router.patch('/:name', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const allowed = ['account_id', 'memo_type', 'memo'];
    const body = req.body || {};
    const patch = {};
    for (const key of allowed) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (Object.keys(patch).length === 0) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'Provide at least one of: account_id, memo_type, memo');
    }

    const result = await FederationRecordService.update(req.params.name, patch);
    if (result.notFound) return respondError(res, 404, 'NOT_FOUND', 'Federation record not found');
    if (result.invalid) {
      return respondError(res, 400, 'VALIDATION_ERROR', 'Invalid federation record', result.invalid);
    }

    await audit(req, 'FEDERATION_RECORD_UPDATED', result.record.name, { changed: Object.keys(patch) });
    return res.json({ success: true, data: result.record });
  } catch (err) {
    next(err);
  }
}));

/**
 * DELETE /admin/federation/:name
 */
router.delete('/:name', ...auth, asyncHandler(async (req, res, next) => {
  try {
    const removed = await FederationRecordService.remove(req.params.name);
    if (!removed) return respondError(res, 404, 'NOT_FOUND', 'Federation record not found');
    await audit(req, 'FEDERATION_RECORD_DELETED', String(req.params.name).toLowerCase(), {});
    return res.json({ success: true, data: { name: String(req.params.name).toLowerCase(), deleted: true } });
  } catch (err) {
    next(err);
  }
}));

module.exports = router;
