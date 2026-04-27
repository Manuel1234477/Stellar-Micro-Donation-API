/**
 * Fees Routes - Student Fee Installment Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for student fee creation,
 *                 installment payment recording, and balance queries.
 * OWNER: Backend Team
 * DEPENDENCIES: FeeService, rbac middleware
 */

const express = require('express');
const router = express.Router();
const FeeService = require('../services/FeeService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { requireAdmin } = require('../middleware/rbac');

/**
 * POST /fees
 * Create a new fee record for a student (admin only).
 * Body: { studentId, description, totalAmount }
 */
router.post('/', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { studentId, description, totalAmount } = req.body;
    const fee = await FeeService.createFee(studentId, description, Number(totalAmount));
    res.status(201).json({ success: true, data: fee });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /fees/:id/payments
 * Record an installment payment toward a fee.
 * Body: { amount, note? }
 */
router.post('/:id/payments', payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const feeId = parseInt(req.params.id, 10);
    if (isNaN(feeId) || feeId < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid fee ID' },
      });
    }

    const { amount, note } = req.body;
    const fee = await FeeService.recordPayment(feeId, Number(amount), note);
    res.status(200).json({ success: true, data: fee });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /fees/student/:studentId
 * List all fees for a student.
 * NOTE: must be registered before /:id to avoid route conflict
 */
router.get('/student/:studentId', asyncHandler(async (req, res, next) => {
  try {
    const fees = await FeeService.getFeesForStudent(req.params.studentId);
    res.json({ success: true, data: fees, count: fees.length });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /fees/:id
 * Get a fee record with payment history and balance summary.
 */
router.get('/:id', asyncHandler(async (req, res, next) => {
  try {
    const feeId = parseInt(req.params.id, 10);
    if (isNaN(feeId) || feeId < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid fee ID' },
      });
    }

    const fee = await FeeService.getFee(feeId);
    res.json({ success: true, data: fee });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
