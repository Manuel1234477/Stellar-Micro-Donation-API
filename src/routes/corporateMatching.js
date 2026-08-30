/**
 * Corporate Matching Routes - Donor/Employee-Facing Endpoints (#1550)
 *
 * RESPONSIBILITY: Discovery of active corporate matching programs, employee
 *   self-enrollment, and lookup of an employee's own matched donations.
 *   Admin CRUD for programs (create/list/update-status/enrolled-employees)
 *   and the admin activity/export endpoints live in routes/admin/corporateMatching.js,
 *   which is auto-guarded by requireApiKey + requireAdmin() at the /admin mount point.
 */

const express = require('express');
const router = express.Router();
const CorporateMatchingService = require('../services/CorporateMatchingService');
const requireApiKey = require('../middleware/apiKey');
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

module.exports = router;
