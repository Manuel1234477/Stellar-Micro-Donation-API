/**
 * Admin CORS Rules Routes
 *
 * RESPONSIBILITY: Runtime management of the CORS allowlist via cors_rules table
 * OWNER: Security Team
 *
 * Endpoints:
 *   GET    /admin/cors/rules        – list all CORS rules
 *   POST   /admin/cors/rules        – add a new allowed origin
 *   PATCH  /admin/cors/rules/:id    – toggle active status
 *   DELETE /admin/cors/rules/:id    – remove a rule
 *
 * The CORS middleware reloads active rules from the database on each request
 * with a 60-second in-memory cache. Writes invalidate that cache so changes
 * take effect immediately.
 *
 * Requires admin role.
 */

'use strict';

const express = require('express');
const router = express.Router();
const Database = require('../../utils/database');
const requireApiKey = require('../../middleware/apiKey');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { requireAdmin } = require('../../middleware/rbac');
const { invalidateCache } = require('../../middleware/cors');
const AuditLogService = require('../../services/AuditLogService');

/**
 * Ensure the cors_rules table exists.
 * Called lazily on first request so startup is not blocked.
 */
async function ensureTable() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS cors_rules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      origin      TEXT    NOT NULL UNIQUE,
      active      INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, []);
}

/**
 * Validate an origin strictly: scheme + host, optional port, no path/query/fragment.
 * Returns the normalized origin string, or null when invalid.
 */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.username || parsed.password) return null;

  return parsed.origin;
}

/**
 * GET /admin/cors/rules
 * List all CORS rules.
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  await ensureTable();
  const rows = await Database.query(
    'SELECT id, origin, active, description, createdAt FROM cors_rules ORDER BY id ASC',
    []
  );
  res.json({ success: true, data: rows, count: rows.length });
}));

/**
 * POST /admin/cors/rules
 * Add a new allowed origin.
 * Body: { "origin": "https://example.com", "description": "Partner frontend" }
 */
router.post('/', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res) => {
  await ensureTable();

  const { origin, description } = req.body;

  if (!origin || typeof origin !== 'string' || !origin.trim()) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'origin is required' },
    });
  }

  const normalized = normalizeOrigin(origin);
  if (!normalized) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'origin must be a valid URL with scheme and host (https://example.com), optional port, and no path',
      },
    });
  }

  try {
    const result = await Database.run(
      'INSERT INTO cors_rules (origin, active, description) VALUES (?, 1, ?)',
      [normalized, description || null]
    );

    invalidateCache();

    const row = await Database.get(
      'SELECT id, origin, active, description, createdAt FROM cors_rules WHERE id = ?',
      [result.id]
    );

    await AuditLogService.log({
      action: 'cors_rule.created',
      actorId: req.user && req.user.id,
      targetType: 'cors_rule',
      targetId: row.id,
      metadata: { origin: row.origin, description: row.description },
    });

    return res.status(201).json({ success: true, data: row });
  } catch (err) {
    if (err.message && (err.message.includes('UNIQUE') || err.message.includes('Duplicate'))) {
      return res.status(409).json({
        success: false,
        error: { code: 'DUPLICATE_ORIGIN', message: 'Origin already exists in CORS rules' },
      });
    }
    throw err;
  }
}));

/**
 * PATCH /admin/cors/rules/:id
 * Toggle the active status of a CORS rule.
 */
router.patch('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  await ensureTable();

  const { id } = req.params;
  const existing = await Database.get(
    'SELECT id, origin, active, description, createdAt FROM cors_rules WHERE id = ?',
    [id]
  );
  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'CORS rule not found' },
    });
  }

  const newActive = existing.active ? 0 : 1;
  await Database.run('UPDATE cors_rules SET active = ? WHERE id = ?', [newActive, id]);
  invalidateCache();

  const updated = await Database.get(
    'SELECT id, origin, active, description, createdAt FROM cors_rules WHERE id = ?',
    [id]
  );

  await AuditLogService.log({
    action: 'cors_rule.updated',
    actorId: req.user && req.user.id,
    targetType: 'cors_rule',
    targetId: updated.id,
    metadata: { origin: updated.origin, active: updated.active },
  });

  res.json({ success: true, data: updated });
}));

/**
 * DELETE /admin/cors/rules/:id
 * Remove a CORS rule.
 */
router.delete('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  await ensureTable();

  const { id } = req.params;
  const existing = await Database.get('SELECT id, origin FROM cors_rules WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'CORS rule not found' },
    });
  }

  await Database.run('DELETE FROM cors_rules WHERE id = ?', [id]);
  invalidateCache();

  await AuditLogService.log({
    action: 'cors_rule.deleted',
    actorId: req.user && req.user.id,
    targetType: 'cors_rule',
    targetId: existing.id,
    metadata: { origin: existing.origin },
  });

  res.json({ success: true, message: 'CORS rule removed' });
}));

module.exports = router;
