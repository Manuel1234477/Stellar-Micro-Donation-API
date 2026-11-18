/**
 * Sponsorship Routes - Wallet sponsorship management
 *
 * RESPONSIBILITY: HTTP request handling for wallet sponsorship operations
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, StellarService
 *
 * Endpoints for sponsoring accounts, revoking sponsorship, and checking sponsorship status.
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { validateSchema } = require('../../middleware/schemaValidation');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const WalletService = require('../../services/WalletService');
const AuditLogService = require('../../services/AuditLogService');
const { getStellarService } = require('../../config/stellar');

const walletService = new WalletService(getStellarService());

const walletIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

/**
 * POST /wallets/:id/sponsor
 * Sponsor a new account's base reserve using the platform SPONSOR_SECRET.
 */
router.post('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const result = await walletService.sponsorAccount(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:id/sponsor
 * Return the current sponsorship status for a wallet.
 */
router.get('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const status = await walletService.getSponsorshipStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /wallets/:id/sponsor
 * Revoke sponsorship for a wallet. Returns 400 if the account cannot cover its own reserve.
 */
router.delete('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const { entryType } = req.query;
    const result = await walletService.revokeSponsorship(req.params.id, entryType);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /wallets/:id/revoke-sponsorship
 * Revoke platform sponsorship for a wallet.
 * Requires SPONSOR_SECRET to be configured in environment.
 */
router.post('/:id/revoke-sponsorship', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const result = await walletService.revokeSponsoredAccount(req.params.id);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SPONSORSHIP_REVOKED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/revoke-sponsorship`,
      details: { walletId: req.params.id }
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
