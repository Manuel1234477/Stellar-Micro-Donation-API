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
 * with a 60-second in-memory cache. Changes take effect within one cache TTL.
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

  const trimmed = origin.trim();
  const isWildcard = trimmed.startsWith('*.');
  const isUrl = /^https?:\/\/.+/.test(trimmed);
  if (!isWildcard && !isUrl) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'origin must be a valid URL (https://example.com) or wildcard pattern (*.example.com)',
      },
    });
  }

  try {
    const result = await Database.run(
      'INSERT INTO cors_rules (origin, active, description) VALUES (?, 1, ?)',
      [trimmed, description || null]
    );

    invalidateCache();

    const row = await Database.get(
      'SELECT id, origin, active, description, createdAt FROM cors_rules WHERE id = ?',
      [result.id]
    );
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
  res.json({ success: true, data: updated });
}));

/**
 * DELETE /admin/cors/rules/:id
 * Remove a CORS rule.
 */
router.delete('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  await ensureTable();

  const { id } = req.params;
  const existing = await Database.get('SELECT id FROM cors_rules WHERE id = ?', [id]);
  if (!existing) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'CORS rule not found' },
    });
  }

  await Database.run('DELETE FROM cors_rules WHERE id = ?', [id]);
  invalidateCache();

  res.json({ success: true, message: 'CORS rule removed' });
}));

module.exports = router;
