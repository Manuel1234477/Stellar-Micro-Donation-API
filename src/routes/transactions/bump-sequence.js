/**
 * Bump Sequence Routes - Transaction Ordering Guarantees
 * 
 * RESPONSIBILITY: HTTP request handling for Stellar BumpSequenceOperation
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, middleware (auth, RBAC)
 * 
 * Issue #1586: Implements bump sequence operation support for transaction
 * ordering guarantees in concurrent environments and payment channel protocols.
 */

/**
 * @openapi
 * /transactions/bump-sequence:
 *   post:
 *     tags: [Transactions]
 *     summary: Bump sequence number for transaction ordering guarantees
 *     description: Advances an account's sequence number to a specific value for payment channel protocols and time-locked transactions
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [secret, bumpTo]
 *             properties:
 *               secret:
 *                 type: string
 *                 description: Account secret key (S...)
 *               bumpTo:
 *                 type: string
 *                 description: Target sequence number (must be greater than current)
 *     responses:
 *       200:
 *         description: Sequence bump successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     transactionId: { type: string }
 *                     ledger: { type: integer }
 *                     previousSequence: { type: string }
 *                     newSequence: { type: string }
 *       400:
 *         description: Validation error (e.g., bumpTo <= current sequence)
 *       401:
 *         description: Unauthorized
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../../middleware/apiKey');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { getStellarService } = require('../../config/stellar');
const asyncHandler = require('../../utils/asyncHandler');
const { ValidationError } = require('../../utils/errors');
const { SequenceManager } = require('../../services/SequenceManager');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

/**
 * POST /transactions/bump-sequence
 * Bump an account's sequence number to enable transaction ordering guarantees.
 * Requires admin or service-account permission.
 */
router.post('/', requireApiKey, checkPermission(PERMISSIONS.ADMIN), payloadSizeLimiter(ENDPOINT_LIMITS.default), asyncHandler(async (req, res, next) => {
  try {
    const { secret, bumpTo } = req.body;

    if (!secret || !bumpTo) {
      throw new ValidationError('secret and bumpTo are required');
    }

    const stellarService = getStellarService();
    const StellarSdk = require('../../services/stellar/sdk.js');
    const keypair = StellarSdk.Keypair.fromSecret(secret);
    const publicKey = keypair.publicKey();

    // Fetch current sequence from the network
    const currentSequence = await stellarService.getAccountSequence(publicKey);
    const currentBigInt = BigInt(currentSequence);
    const targetBigInt = BigInt(bumpTo);

    // Validate: target must be greater than current
    if (targetBigInt <= currentBigInt) {
      throw new ValidationError(
        `Target sequence (${bumpTo}) must be greater than current sequence (${currentSequence})`
      );
    }

    // Build and submit bump sequence operation
    const account = await stellarService.loadAccount(publicKey);
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: stellarService.baseFee,
      networkPassphrase: stellarService.networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.bumpSequence({
        bumpTo: bumpTo.toString(),
      }))
      .setTimeout(30)
      .build();

    transaction.sign(keypair);
    
    const result = await stellarService.submitTransaction(transaction);

    // Invalidate sequence cache for this account
    const sequenceManager = new SequenceManager();
    sequenceManager.cache.delete(publicKey);

    return res.json({
      success: true,
      data: {
        transactionId: result.hash,
        ledger: result.ledger,
        previousSequence: currentSequence,
        newSequence: bumpTo,
      },
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
