/**
 * Corporate Matching Routes (#1550, #1553, #1778)
 *
 * RESPONSIBILITY: The single route module for corporate matching. Exports one
 *   router per audience so each mount point stays the same:
 *
 *   module.exports              (member router) mounted at /api/v1
 *     GET    /corporate-matching/programs
 *     POST   /corporate-matching/:id/enroll
 *     DELETE /corporate-matching/:id/enroll/:employeeWalletId
 *     GET    /corporate-matching/:id/my-matches
 *
 *   module.exports.adminRouter  mounted at /admin/corporate-matching
 *     (program CRUD, enrolled employees, activity + export)
 *
 *   module.exports.v2Router     mounted at /api/v2/corporate-matching
 *     (admin list/get in the v2 envelope)
 *
 * Replaces the former routes/admin/corporateMatching.js and
 * routes/v2/corporateMatching.js. Admin and v2 endpoints share the same
 * requireApiKey + requireAdmin() guard.
 *
 * Donation matching programs (sponsor-wallet matching, MatchingProgramService)
 * are a separate feature with their own tables and stay in
 * routes/admin/matchingPrograms.js.
 */

const express = require('express');
const router = express.Router();
const CorporateMatchingService = require('../services/CorporateMatchingService');
const requireApiKey = require('../middleware/apiKey');
const { requireAdmin } = require('../middleware/rbac');
const { validateSchema } = require('../middleware/schemaValidation');
const log = require('../utils/log');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

/**
 * GET /corporate-matching/programs
 * List active corporate matching programs available for enrollment.
 */
router.get('/corporate-matching/programs', requireApiKey, asyncHandler(async (req, res) => {
  const programs = await CorporateMatchingService.getAll({ status: 'active' });
  res.json({ success: true, data: programs });
}));

/**
 * POST /corporate-matching/:id/enroll
 * Enroll an employee in a corporate matching program.
 * Body: { employeeWalletId }
 */
router.post('/corporate-matching/:id/enroll', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res) => {
  const programId = parseInt(req.params.id, 10);
  const employeeWalletId = parseInt(req.body.employeeWalletId, 10);

  if (isNaN(programId) || isNaN(employeeWalletId)) {
    return res.status(400).json({ success: false, error: 'programId and employeeWalletId must be integers' });
  }

  const enrollment = await CorporateMatchingService.enrollEmployee(programId, employeeWalletId);
  res.status(201).json({ success: true, data: enrollment });
}));

/**
 * DELETE /corporate-matching/:id/enroll/:employeeWalletId
 * Remove an employee's enrollment from a program.
 */
router.delete('/corporate-matching/:id/enroll/:employeeWalletId', requireApiKey, asyncHandler(async (req, res) => {
  const programId = parseInt(req.params.id, 10);
  const employeeWalletId = parseInt(req.params.employeeWalletId, 10);

  if (isNaN(programId) || isNaN(employeeWalletId)) {
    return res.status(400).json({ success: false, error: 'programId and employeeWalletId must be integers' });
  }

  await CorporateMatchingService.unenrollEmployee(programId, employeeWalletId);
  res.json({ success: true, data: { programId, employeeWalletId, unenrolled: true } });
}));

/**
 * GET /corporate-matching/:id/my-matches
 * An employee's own matched donations for a given program.
 * Query: employeeWalletId (required — the caller's users.id)
 */
router.get('/corporate-matching/:id/my-matches', requireApiKey, asyncHandler(async (req, res) => {
  const programId = parseInt(req.params.id, 10);
  const employeeWalletId = parseInt(req.query.employeeWalletId, 10);

  if (isNaN(programId) || isNaN(employeeWalletId)) {
    return res.status(400).json({ success: false, error: 'programId (param) and employeeWalletId (query) must be integers' });
  }

  const activity = await CorporateMatchingService.getMatchingActivity({ programId });
  const mine = activity.filter((row) => row.employee_wallet_id === employeeWalletId);
  res.json({ success: true, data: mine });
}));

// ─── Admin endpoints (/admin/corporate-matching) ─────────────────────────────
const adminRouter = express.Router();

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
adminRouter.post('/', requireApiKey, requireAdmin(), createCorporateMatchingSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
adminRouter.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
adminRouter.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
adminRouter.patch('/:id/status', requireApiKey, requireAdmin(), updateStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
adminRouter.get('/:id/employees', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
adminRouter.post('/:id/employees', requireApiKey, requireAdmin(), enrollEmployeeSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
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
adminRouter.get('/:id/activity', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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
adminRouter.get('/:id/activity/export', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
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


// ─── v2 envelope endpoints (/api/v2/corporate-matching) ──────────────────────
/**
 * /api/v2/corporate-matching - Standardized Envelope Endpoints (#1553)
 *
 * Same corporate matching programs as the admin v1 endpoints (#1550),
 * reshaped into the v2 { data, meta } / { data } envelope.
 *
 * @openapi
 * tags:
 *   - name: V2 Corporate Matching
 *     description: /api/v2 corporate matching program endpoints (admin-only), using the standardized envelope (Issue #1553)
 *
 * /api/v2/corporate-matching:
 *   get:
 *     tags: [V2 Corporate Matching]
 *     summary: List corporate matching programs (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, exhausted] }
 *       - in: query
 *         name: sponsor_id
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Matching programs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 meta: { $ref: '#/components/schemas/V2ListMeta' }
 *
 * /api/v2/corporate-matching/{id}:
 *   get:
 *     tags: [V2 Corporate Matching]
 *     summary: Get a single corporate matching program (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The matching program.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: object }
 *       404:
 *         $ref: '#/components/responses/V2Error'
 */
const v2Router = express.Router();

/**
 * GET /api/v2/corporate-matching
 * List response: { data: [...], meta: { total, page, pageSize, cursor } }
 */
v2Router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const { status, sponsor_id } = req.query;
  const filters = {};
  if (status) filters.status = status;
  if (sponsor_id) filters.sponsor_id = parseInt(sponsor_id, 10);

  const programs = await CorporateMatchingService.getAll(filters);
  res.v2List(programs, { total: programs.length, page: 1, pageSize: programs.length || null, cursor: null });
}));

/**
 * GET /api/v2/corporate-matching/:id
 * Single-resource response: { data: {...} }
 */
v2Router.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const program = await CorporateMatchingService.getById(parseInt(req.params.id, 10));
  res.v2Data(program);
}));


module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.v2Router = v2Router;

