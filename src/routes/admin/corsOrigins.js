/**
 * Admin CORS Origins Routes
 *
 * RESPONSIBILITY: Runtime management of the CORS per-origin allowlist
 * OWNER: Security Team
 * DEPENDENCIES: Database, rbac middleware, cors cache invalidation
 *
 * Endpoints:
 *   GET    /admin/cors/origins       – list all allowed origins
 *   POST   /admin/cors/origins       – add an allowed origin
 *   DELETE /admin/cors/origins/:id   – remove an allowed origin
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
 * GET /admin/cors/origins
 * List all allowed origins in the database allowlist.
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const rows = await Database.query(
      'SELECT id, origin, allowCredentials, createdAt, createdBy FROM cors_origins ORDER BY id ASC',
      []
    );
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/cors/origins
 * Add an allowed origin to the database allowlist.
 *
 * @body {string} origin            - Origin URL or wildcard pattern (e.g. https://example.com or *.example.com)
 * @body {boolean} [allowCredentials=true] - Whether to allow credentials for this origin
 */
router.post('/', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { origin, allowCredentials = true } = req.body;

    if (!origin || typeof origin !== 'string' || !origin.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'origin is required' },
      });
    }

    const trimmed = origin.trim();

    // Basic format validation: must be a URL or wildcard pattern
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

    const createdBy = req.user ? String(req.user.id) : null;

    try {
      const result = await Database.run(
        `INSERT INTO cors_origins (origin, allowCredentials, createdBy) VALUES (?, ?, ?)`,
        [trimmed, allowCredentials ? 1 : 0, createdBy]
      );

      invalidateCache();

      const row = await Database.get(
        'SELECT id, origin, allowCredentials, createdAt, createdBy FROM cors_origins WHERE id = ?',
        [result.id]
      );
      return res.status(201).json({ success: true, data: row });
    } catch (err) {
      if (err.message && (err.message.includes('UNIQUE') || err.message.includes('Duplicate') || err.message.includes('already been processed'))) {
        return res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_ORIGIN', message: 'Origin already exists in allowlist' },
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
}));

/**
 * DELETE /admin/cors/origins/:id
 * Remove an allowed origin from the database allowlist.
 */
router.delete('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await Database.get('SELECT id FROM cors_origins WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Origin not found' },
      });
    }

    await Database.run('DELETE FROM cors_origins WHERE id = ?', [id]);
    invalidateCache();

    res.json({ success: true, message: 'Origin removed from allowlist' });
  } catch (err) {
    next(err);
  }
}));

module.exports = router;
