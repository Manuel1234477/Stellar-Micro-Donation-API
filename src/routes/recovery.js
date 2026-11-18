/**
 * Recovery Routes - Social Recovery Endpoints (#1552)
 *
 * RESPONSIBILITY: HTTP handlers for guardian-based (M-of-N) account recovery
 * OWNER: Backend Team
 * DEPENDENCIES: SocialRecoveryService, auth middleware
 */

'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const SocialRecoveryService = require('../services/SocialRecoveryService');
const asyncHandler = require('../utils/asyncHandler');
const { getStellarService } = require('../config/stellar');

const recoveryService = new SocialRecoveryService(getStellarService());

/**
 * POST /wallets/:id/recovery/guardians
 * Set guardians for a wallet.
 * Body: { guardianPublicKeys: string[] | {publicKey, email}[], threshold: number }
 */
router.post(
  '/wallets/:id/recovery/guardians',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const { guardianPublicKeys, threshold } = req.body;

      if (!Array.isArray(guardianPublicKeys) || guardianPublicKeys.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'guardianPublicKeys must be a non-empty array' },
        });
      }

      const result = await recoveryService.setGuardians(walletId, guardianPublicKeys, threshold);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * GET /wallets/:id/recovery/guardians
 * List guardians for a wallet.
 */
router.get(
  '/wallets/:id/recovery/guardians',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_READ),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const guardians = await recoveryService.getGuardians(walletId);
      return res.status(200).json({ success: true, data: { guardians } });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * POST /wallets/:id/recovery/initiate
 * Initiate a recovery request with a new target signing key. Notifies every
 * registered guardian (webhook + email where on file) and starts a strict
 * 72-hour expiration window.
 * Body: { newPublicKey }
 */
router.post(
  '/wallets/:id/recovery/initiate',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const { newPublicKey } = req.body;

      if (!newPublicKey || typeof newPublicKey !== 'string') {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'newPublicKey is required' },
        });
      }

      const request = await recoveryService.initiateRecovery(walletId, newPublicKey);
      return res.status(201).json({ success: true, data: request });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * POST /wallets/:id/recovery/:requestId/approve
 * Submit a guardian approval for a pending recovery request.
 * Auto-executes the on-chain signer swap once the M-th approval lands,
 * provided the request hasn't crossed its 72-hour expiration window.
 * Body: { guardianPublicKey }
 */
router.post(
  '/wallets/:id/recovery/:requestId/approve',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const recoveryRequestId = parseInt(req.params.requestId, 10);
      const { guardianPublicKey } = req.body;

      if (!guardianPublicKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'guardianPublicKey is required' },
        });
      }

      const result = await recoveryService.approveRecovery(walletId, recoveryRequestId, guardianPublicKey);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * POST /wallets/:id/recovery/approve
 * @deprecated Prefer POST /wallets/:id/recovery/:requestId/approve.
 * Kept for backward compatibility — recoveryRequestId supplied in the body.
 * Body: { recoveryRequestId, guardianPublicKey }
 */
router.post(
  '/wallets/:id/recovery/approve',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const { recoveryRequestId, guardianPublicKey } = req.body;

      if (!recoveryRequestId || !guardianPublicKey) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'recoveryRequestId and guardianPublicKey are required' },
        });
      }

      const result = await recoveryService.approveRecovery(walletId, recoveryRequestId, guardianPublicKey);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * GET /wallets/:id/recovery/:requestId
 * Get the status of a recovery request.
 */
router.get(
  '/wallets/:id/recovery/:requestId',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_READ),
  asyncHandler(async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const recoveryRequestId = parseInt(req.params.requestId, 10);
      const result = await recoveryService.getRecoveryRequest(walletId, recoveryRequestId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  })
);

module.exports = router;
