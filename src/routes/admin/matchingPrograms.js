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
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const { validateSchema } = require('../../middleware/schemaValidation');
const log = require('../../utils/log');

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

/**
 * POST /admin/matching-programs
 * Create a new donation matching program.
 */
router.post('/', requireApiKey, requireAdmin(), createMatchingProgramSchema, async (req, res, next) => {
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
});

/**
 * GET /admin/matching-programs
 * List all matching programs with optional filters.
 * Query params: status, campaign_id
 */
router.get('/', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.campaign_id) filters.campaign_id = parseInt(req.query.campaign_id, 10);

    const programs = await MatchingProgramService.getAll(filters);
    res.json({ success: true, count: programs.length, data: programs });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/matching-programs/:id
 * Get a specific matching program.
 */
router.get('/:id', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const program = await MatchingProgramService.getById(parseInt(req.params.id, 10));
    res.json({ success: true, data: program });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/matching-programs/:id/utilization
 * Get utilization stats for a matching program.
 */
router.get('/:id/utilization', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const stats = await MatchingProgramService.getUtilization(parseInt(req.params.id, 10));
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /admin/matching-programs/:id/status
 * Update matching program status (active, paused, exhausted).
 */
router.patch('/:id/status', requireApiKey, requireAdmin(), updateStatusSchema, async (req, res, next) => {
  try {
    const program = await MatchingProgramService.updateStatus(
      parseInt(req.params.id, 10),
      req.body.status
    );
    res.json({ success: true, data: program });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
