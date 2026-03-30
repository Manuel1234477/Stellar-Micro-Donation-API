/**
 * Corporate Matching Admin Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP mapping for admin management of corporate donation matching programs
 * OWNER: Backend Team
 * DEPENDENCIES: CorporateMatchingService, middleware (auth, validation, RBAC)
 */

const express = require('express');
const router = express.Router();
const CorporateMatchingService = require('../../services/CorporateMatchingService');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const { validateSchema } = require('../../middleware/schemaValidation');
const log = require('../../utils/log');

const createCorporateMatchingSchema = validateSchema({
  body: {
    fields: {
      sponsor_id: { type: 'integer', required: true, min: 1 },
      match_ratio: { type: 'number', required: true, min: 0.01, max: 10 },
      per_employee_limit: { type: 'number', required: true, min: 0.0000001 },
      total_limit: { type: 'number', required: true, min: 0.0000001 }
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
 * POST /admin/corporate-matching
 * Create a new corporate matching program.
 */
router.post('/', requireApiKey, requireAdmin(), createCorporateMatchingSchema, async (req, res, next) => {
  try {
    const { sponsor_id, match_ratio, per_employee_limit, total_limit } = req.body;

    const program = await CorporateMatchingService.create({
      sponsor_id,
      match_ratio,
      per_employee_limit,
      total_limit
    });

    res.status(201).json({
      success: true,
      data: program
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to create corporate matching program', { error: error.message });
    next(error);
  }
});

/**
 * GET /admin/corporate-matching
 * Get all corporate matching programs.
 */
router.get('/', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const { status, sponsor_id } = req.query;
    const filters = {};
    if (status) filters.status = status;
    if (sponsor_id) filters.sponsor_id = parseInt(sponsor_id);

    const programs = await CorporateMatchingService.getAll(filters);

    res.json({
      success: true,
      data: programs
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to get corporate matching programs', { error: error.message });
    next(error);
  }
});

/**
 * GET /admin/corporate-matching/:id
 * Get a specific corporate matching program.
 */
router.get('/:id', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const program = await CorporateMatchingService.getById(parseInt(id));

    res.json({
      success: true,
      data: program
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to get corporate matching program', { error: error.message });
    next(error);
  }
});

/**
 * PATCH /admin/corporate-matching/:id/status
 * Update the status of a corporate matching program.
 */
router.patch('/:id/status', requireApiKey, requireAdmin(), updateStatusSchema, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const program = await CorporateMatchingService.updateStatus(parseInt(id), status);

    res.json({
      success: true,
      data: program
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to update corporate matching program status', { error: error.message });
    next(error);
  }
});

/**
 * GET /admin/corporate-matching/:id/employees
 * Get enrolled employees for a corporate matching program.
 */
router.get('/:id/employees', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const { id } = req.params;
    const employees = await CorporateMatchingService.getEnrolledEmployees(parseInt(id));

    res.json({
      success: true,
      data: employees
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to get enrolled employees', { error: error.message });
    next(error);
  }
});

module.exports = router;