/**
 * Corporate Matching Routes
 * Endpoints for employer allowlist management and the match claim workflow.
 */

const express = require('express');
const router = express.Router();
const CorporateMatchingService = require('../services/CorporateMatchingService');
const MockStellarService = require('../services/MockStellarService');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

// Shared service instance (can be replaced in tests)
const stellarService = new MockStellarService();
const matchingService = new CorporateMatchingService(stellarService);

// ─── Admin: Employer Allowlist ────────────────────────────────────────────────

/**
 * POST /admin/corporate-matching/employers
 * Add an employer to the allowlist with match ratio and annual cap.
 */
router.post('/admin/corporate-matching/employers', (req, res) => {
  try {
    const { employerId, name, matchRatio, annualCap } = req.body;
    const employer = matchingService.addEmployer(employerId, name, Number(matchRatio), Number(annualCap));
    res.status(201).json({ success: true, data: employer });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /admin/corporate-matching/employers
 * List all employers in the allowlist.
 */
router.get('/admin/corporate-matching/employers', (req, res) => {
  res.json({ success: true, data: matchingService.listEmployers() });
});

// ─── Donor: Submit Claim ──────────────────────────────────────────────────────

/**
 * POST /corporate-matching/claim
 * Donor submits a match request referencing their employer.
 */
router.post('/corporate-matching/claim', (req, res) => {
  try {
    const { donorId, employerId, donationAmount } = req.body;
    const claim = matchingService.submitClaim(donorId, employerId, Number(donationAmount));
    res.status(201).json({ success: true, data: claim });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─── Admin: Claims Management ─────────────────────────────────────────────────

/**
 * GET /admin/corporate-matching/claims
 * List pending (or all) claims.
 */
router.get('/admin/corporate-matching/claims', (req, res) => {
  const { status } = req.query;
  res.json({ success: true, data: matchingService.listClaims(status) });
});

/**
 * POST /admin/corporate-matching/claims/:id/approve
 * Approve a claim and trigger the on-chain matching donation.
 * Body: { sourcePublicKey, donorPublicKey }
 */
router.post('/admin/corporate-matching/claims/:id/approve', payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res) => {
  try {
    const { sourcePublicKey, donorPublicKey } = req.body;
    const claim = await matchingService.approveClaim(req.params.id, sourcePublicKey, donorPublicKey);
    res.json({ success: true, data: claim });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
}));

/**
 * POST /admin/corporate-matching/claims/:id/reject
 * Reject a claim.
 * Body: { reason? }
 */
router.post('/admin/corporate-matching/claims/:id/reject', (req, res) => {
  try {
    const claim = matchingService.rejectClaim(req.params.id, req.body.reason);
    res.json({ success: true, data: claim });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
});

module.exports = { router, matchingService };
