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
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

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
router.post('/', requireApiKey, requireAdmin(), createCorporateMatchingSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
}));

/**
 * GET /admin/corporate-matching
 * Get all corporate matching programs.
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
}));

/**
 * GET /admin/corporate-matching/:id
 * Get a specific corporate matching program.
 */
router.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
}));

/**
 * PATCH /admin/corporate-matching/:id/status
 * Update the status of a corporate matching program.
 */
router.patch('/:id/status', requireApiKey, requireAdmin(), updateStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
}));

/**
 * GET /admin/corporate-matching/:id/employees
 * Get enrolled employees for a corporate matching program.
 */
router.get('/:id/employees', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
}));

const enrollEmployeeSchema = validateSchema({
  body: {
    fields: {
      employeeWalletId: { type: 'integer', required: true, min: 1 }
    }
  }
});

/**
 * POST /admin/corporate-matching/:id/employees
 * Enroll an employee in a corporate matching program.
 */
router.post('/:id/employees', requireApiKey, requireAdmin(), enrollEmployeeSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { employeeWalletId } = req.body;

    const enrollment = await CorporateMatchingService.enrollEmployee(parseInt(id), employeeWalletId);

    res.status(201).json({
      success: true,
      data: enrollment
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to enroll employee', { error: error.message });
    next(error);
  }
}));

/**
 * GET /admin/corporate-matching/:id/activity
 * View matching activity (created matches) for a program, for program administrators.
 * Query params: from, to (ISO date strings)
 */
router.get('/:id/activity', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    await CorporateMatchingService.getById(parseInt(id)); // 404 if program doesn't exist
    const activity = await CorporateMatchingService.getMatchingActivity({ programId: parseInt(id), from, to });
    const utilization = await CorporateMatchingService.getUtilization(parseInt(id));

    res.json({
      success: true,
      data: { program: utilization, activity }
    });
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to get matching activity', { error: error.message });
    next(error);
  }
}));

/**
 * GET /admin/corporate-matching/:id/activity/export
 * Export matching activity for a program as CSV.
 * Query params: from, to (ISO date strings)
 */
router.get('/:id/activity/export', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { from, to } = req.query;

    await CorporateMatchingService.getById(parseInt(id)); // 404 if program doesn't exist
    const activity = await CorporateMatchingService.getMatchingActivity({ programId: parseInt(id), from, to });

    const header = 'id,corporate_matching_id,original_donation_id,matched_donation_id,employee_wallet_id,matched_amount,year,status,stellar_tx_hash,created_at';
    const escape = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = activity.map((row) => [
      row.id, row.corporate_matching_id, row.original_donation_id, row.matched_donation_id,
      row.employee_wallet_id, row.matched_amount, row.year, row.status, row.stellar_tx_hash, row.created_at
    ].map(escape).join(','));
    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="corporate-matching-${id}-activity.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    log.error('CORPORATE_MATCHING_ADMIN', 'Failed to export matching activity', { error: error.message });
    next(error);
  }
}));

module.exports = router;