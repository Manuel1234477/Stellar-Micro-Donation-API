/**
 * Matching Programs Admin Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP mapping for admin management of donation matching programs
 * OWNER: Backend Team
 * DEPENDENCIES: MatchingProgramService, middleware (auth, validation, RBAC)
 */

const express = require('express');
const router = express.Router();
const MatchingProgramService = require('../../services/MatchingProgramService');
const Database = require('../../utils/database');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const { validateSchema } = require('../../middleware/schemaValidation');
const log = require('../../utils/log');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

const createMatchingProgramSchema = validateSchema({
  body: {
    fields: {
      sponsor_wallet_id: { type: 'string', required: true, maxLength: 56 },
      match_ratio: { type: 'number', required: true, min: 0.01, max: 10 },
      max_match_amount: { type: 'number', required: true, min: 0.0000001 },
      campaign_id: { type: 'integer', required: false, min: 1, nullable: true }
    }
  }
});

const updateStatusSchema = validateSchema({
  body: {
    fields: {
      status: { type: 'string', required: true, enum: ['active', 'paused', 'exhausted'] }
    }
  }
});

const updateProgramSchema = validateSchema({
  body: {
    fields: {
      match_ratio: { type: 'number', required: false, min: 0.01, max: 10 },
      max_match_amount: { type: 'number', required: false, min: 0.0000001 },
      end_date: { type: 'string', required: false, nullable: true }
    }
  }
});

/**
 * POST /admin/matching-programs
 * Create a new donation matching program.
 */
router.post('/', requireApiKey, requireAdmin(), createMatchingProgramSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { sponsor_wallet_id, match_ratio, max_match_amount, campaign_id } = req.body;

    const program = await MatchingProgramService.create({
      sponsor_wallet_id,
      match_ratio,
      max_match_amount,
      campaign_id: campaign_id || null
    });

    res.status(201).json({ success: true, data: program });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/matching-programs
 * List all matching programs with optional filters.
 * Query params: status, campaign_id
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.campaign_id) filters.campaign_id = parseInt(req.query.campaign_id, 10);

    const programs = await MatchingProgramService.getAll(filters);
    res.json({ success: true, count: programs.length, data: programs });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/matching-programs/:id
 * Get a specific matching program.
 */
router.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const program = await MatchingProgramService.getById(parseInt(req.params.id, 10));
    res.json({ success: true, data: program });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/matching-programs/:id/utilization
 * Get utilization stats for a matching program.
 */
router.get('/:id/utilization', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const stats = await MatchingProgramService.getUtilization(parseInt(req.params.id, 10));
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /admin/matching-programs/:id/status
 * Update matching program status (active, paused, exhausted).
 */
router.patch('/:id/status', requireApiKey, requireAdmin(), updateStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const program = await MatchingProgramService.updateStatus(
      parseInt(req.params.id, 10),
      req.body.status
    );
    res.json({ success: true, data: program });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /admin/matching-programs/:id
 * Update matching program details (match_ratio, max_match_amount, end_date).
 */
router.patch('/:id', requireApiKey, requireAdmin(), updateProgramSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { match_ratio, max_match_amount, end_date } = req.body;

    // Verify program exists
    const program = await MatchingProgramService.getById(id);

    // Build update query
    const updates = [];
    const params = [];

    if (match_ratio !== undefined) {
      updates.push('match_ratio = ?');
      params.push(match_ratio);
    }
    if (max_match_amount !== undefined) {
      updates.push('max_match_amount = ?');
      params.push(max_match_amount);
    }
    if (end_date !== undefined) {
      updates.push('end_date = ?');
      params.push(end_date);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields to update' } });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    await Database.run(
      `UPDATE matching_programs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    const updated = await MatchingProgramService.getById(id);

    log.info('MATCHING_PROGRAM', 'Updated matching program', {
      id,
      match_ratio,
      max_match_amount,
      end_date
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /admin/matching-programs/:id
 * Deactivate a matching program (sets status to 'inactive').
 */
router.delete('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);

    // Verify program exists
    await MatchingProgramService.getById(id);

    // Set status to inactive
    await Database.run(
      `UPDATE matching_programs SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [id]
    );

    log.info('MATCHING_PROGRAM', 'Deactivated matching program', { id });

    res.json({ success: true, message: 'Matching program deactivated' });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
