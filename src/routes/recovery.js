/**
 * Recovery Routes - Social Recovery Endpoints
 *
 * RESPONSIBILITY: HTTP handlers for guardian-based account recovery
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
const { getStellarService } = require('../config/stellar');
const { ValidationError, NotFoundError } = require('../utils/errors');

const recoveryService = new SocialRecoveryService(getStellarService());

/**
 * POST /wallets/:id/recovery/guardians
 * Set guardians for a wallet.
 */
router.post(
  '/wallets/:id/recovery/guardians',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_WRITE),
  async (req, res, next) => {
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
  }
);

/**
 * GET /wallets/:id/recovery/guardians
 * List guardians for a wallet.
 */
router.get(
  '/wallets/:id/recovery/guardians',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_READ),
  async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const guardians = await recoveryService.getGuardians(walletId);
      return res.status(200).json({ success: true, data: { guardians } });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /wallets/:id/recovery/initiate
 * Initiate a recovery request with a 48-hour time-lock.
 */
router.post(
  '/wallets/:id/recovery/initiate',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_WRITE),
  async (req, res, next) => {
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
  }
);

/**
 * POST /wallets/:id/recovery/approve
 * Submit a guardian approval for a recovery request.
 * Auto-executes when threshold is met and time-lock has passed.
 */
router.post(
  '/wallets/:id/recovery/approve',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_WRITE),
  async (req, res, next) => {
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
  }
);

/**
 * GET /wallets/:id/recovery/:requestId
 * Get the status of a recovery request.
 */
router.get(
  '/wallets/:id/recovery/:requestId',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_READ),
  async (req, res, next) => {
    try {
      const walletId = parseInt(req.params.id, 10);
      const recoveryRequestId = parseInt(req.params.requestId, 10);
      const result = await recoveryService.getRecoveryRequest(walletId, recoveryRequestId);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
