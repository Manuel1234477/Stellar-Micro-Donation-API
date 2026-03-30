/**
 * Claimable Balances Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for claimable balance operations
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, middleware (auth, validation, RBAC)
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/auth');
const { getStellarService } = require('../utils/serviceLocator');

/**
 * @openapi
 * tags:
 *   - name: ClaimableBalances
 *     description: Create and manage Stellar claimable balances
 */

// POST /claimable-balances
router.post(
  '/',
  requireAuth,
  requirePermission('donations:write'),
  async (req, res, next) => {
    try {
      const { sourceSecret, asset, amount, claimants } = req.body;
      if (!sourceSecret || !amount || !Array.isArray(claimants) || claimants.length === 0) {
        return res.status(400).json({ error: 'Missing required fields' });
      }
      const stellarService = getStellarService();
      const result = await stellarService.createClaimableBalance(sourceSecret, asset, amount, claimants);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }
);

// POST /claimable-balances/:id/claim
router.post(
  '/:id/claim',
  requireAuth,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { claimantSecret } = req.body;
      if (!claimantSecret) {
        return res.status(400).json({ error: 'Missing claimantSecret' });
      }
      const stellarService = getStellarService();
      const result = await stellarService.claimBalance(claimantSecret, id);
      res.status(200).json(result);
    } catch (err) {
      if (err.code === 'PERMISSION_DENIED') {
        return res.status(403).json({ error: 'Not an authorized claimant' });
      }
      next(err);
    }
  }
);

// GET /claimable-balances
router.get(
  '/',
  requireAuth,
  async (req, res, next) => {
    try {
      const stellarService = getStellarService();
      const wallet = req.user.wallet;
      if (!wallet || !wallet.publicKey) {
        return res.status(400).json({ error: 'No wallet found for user' });
      }
      // This assumes a listClaimableBalances(publicKey) method exists or is stubbed
      if (typeof stellarService.listClaimableBalances !== 'function') {
        return res.status(501).json({ error: 'Listing claimable balances not implemented' });
      }
      const balances = await stellarService.listClaimableBalances(wallet.publicKey);
      res.status(200).json(balances);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
