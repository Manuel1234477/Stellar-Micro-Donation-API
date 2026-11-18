/**
 * Inflation Routes - Wallet inflation destination management
 *
 * RESPONSIBILITY: HTTP request handling for inflation destination operations on Stellar accounts
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, StellarService
 *
 * Endpoints for setting and retrieving inflation destinations on Stellar accounts.
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

const walletService = new WalletService();

const walletIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

/**
 * Update inflation destination handler (shared for PATCH and PUT).
 */
const updateInflationDestinationHandler = asyncHandler(async (req, res, next) => {
  try {
    const destinationPublicKey = req.body.destinationPublicKey || req.body.destination;
    const { signedXDR } = req.body;

    if (!destinationPublicKey || !signedXDR) {
      return res.status(400).json({ success: false, error: 'Missing required fields: destinationPublicKey, signedXDR' });
    }

    // Validate destination public key format (G...)
    if (!/^G[A-Z2-7]{55}$/.test(destinationPublicKey)) {
      return res.status(400).json({ success: false, error: 'Invalid Stellar public key for inflation destination' });
    }

    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    // Only the account owner can set inflation destination
    if (!req.user || String(wallet.ownerId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: 'Only the account owner may set the inflation destination' });
    }

    const stellarSvc = getStellarService();
    let result;
    try {
      result = await stellarSvc.submitSignedTransaction(signedXDR);
    } catch (err) {
      if (err && err.name === 'ValidationError') return next(err);
      return res.status(502).json({ success: false, error: 'Stellar network error while setting inflation destination' });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'INFLATION_DESTINATION_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/inflation-destination`,
      details: { walletId: req.params.id, inflationDestination: destinationPublicKey, txHash: result.hash },
    });

    return res.json({ success: true, data: { inflationDestination: destinationPublicKey, hash: result.hash, ledger: result.ledger } });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id/inflation-destination
 * Set the inflation destination for a wallet's Stellar account.
 * Body: { destinationPublicKey: string, signedXDR: string }
 */
router.patch('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), updateInflationDestinationHandler);

/**
 * PUT /wallets/:id/inflation-destination
 * Idiomatic alias for PATCH.
 * Body: { destinationPublicKey: string, signedXDR: string }
 */
router.put('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), updateInflationDestinationHandler);

/**
 * GET /wallets/:id/inflation-destination
 * Returns the current inflation destination set on the wallet's Stellar account.
 */
router.get('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    const stellarSvc = getStellarService();
    const inflationDest = await stellarSvc.getInflationDestination(wallet.address || wallet.publicKey).catch(() => null);
    return res.json({ success: true, data: { inflationDestination: inflationDest || null } });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
