/**
 * Liquidity Pool Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for Stellar AMM liquidity pool operations
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService/MockStellarService, middleware (auth, RBAC)
 */

/**
 * @openapi
 * tags:
 *   - name: LiquidityPools
 *     description: Stellar AMM liquidity pool deposit, withdrawal, and earnings
 *
 * /liquidity-pools/deposit:
 *   post:
 *     tags: [LiquidityPools]
 *     summary: Deposit assets into a Stellar liquidity pool
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret, assetA, assetB, maxAmountA, maxAmountB]
 *             properties:
 *               secret:
 *                 type: string
 *                 description: Source account secret key
 *               assetA:
 *                 type: object
 *                 description: First asset (e.g. {type:"native"} or {type:"credit_alphanum4",code:"USDC",issuer:"G..."})
 *               assetB:
 *                 type: object
 *                 description: Second asset
 *               maxAmountA:
 *                 type: string
 *                 description: Maximum amount of assetA to deposit
 *               maxAmountB:
 *                 type: string
 *                 description: Maximum amount of assetB to deposit
 *     responses:
 *       200:
 *         description: Deposit successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     poolId: { type: string }
 *                     sharesReceived: { type: string }
 *                     transactionId: { type: string }
 *                     ledger: { type: integer }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *
 * /liquidity-pools/withdraw:
 *   post:
 *     tags: [LiquidityPools]
 *     summary: Withdraw assets from a Stellar liquidity pool
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret, poolId, amount]
 *             properties:
 *               secret:
 *                 type: string
 *               poolId:
 *                 type: string
 *               amount:
 *                 type: string
 *                 description: Number of pool shares to redeem
 *     responses:
 *       200:
 *         description: Withdrawal successful
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *
 * /liquidity-pools/{id}/earnings:
 *   get:
 *     tags: [LiquidityPools]
 *     summary: Get earnings for a liquidity pool
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Pool ID
 *     responses:
 *       200:
 *         description: Pool earnings
 *       404:
 *         description: Pool not found
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { getStellarService } = require('../config/stellar');

/**
 * POST /liquidity-pools/deposit
 * Deposit assets into a Stellar AMM liquidity pool.
 */
router.post('/deposit', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_WRITE), payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res, next) => {
  try {
    const { secret, assetA, assetB, maxAmountA, maxAmountB } = req.body;

    if (!secret || !assetA || !assetB || !maxAmountA || !maxAmountB) {
      return res.status(400).json({
        success: false,
        error: { message: 'secret, assetA, assetB, maxAmountA, and maxAmountB are required' }
      });
    }

    const stellarService = getStellarService();
    const result = await stellarService.depositLiquidityPool(secret, assetA, assetB, maxAmountA, maxAmountB);

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /liquidity-pools/withdraw
 * Withdraw assets from a Stellar AMM liquidity pool.
 */
router.post('/withdraw', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_WRITE), payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res, next) => {
  try {
    const { secret, poolId, amount } = req.body;

    if (!secret || !poolId || !amount) {
      return res.status(400).json({
        success: false,
        error: { message: 'secret, poolId, and amount are required' }
      });
    }

    const stellarService = getStellarService();
    const result = await stellarService.withdrawLiquidityPool(secret, poolId, amount);

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /liquidity-pools/:id/earnings
 * Get earnings for a specific liquidity pool.
 */
router.get('/:id/earnings', requireApiKey, checkPermission(PERMISSIONS.STATS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const stellarService = getStellarService();
    const result = await stellarService.getLiquidityPoolEarnings(id);
    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
