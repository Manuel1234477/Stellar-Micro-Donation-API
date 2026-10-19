/**
 * Merge Routes - Wallet account merging operations
 *
 * RESPONSIBILITY: HTTP request handling for Stellar account merge operations
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database
 *
 * Endpoints for checking merge eligibility and merging wallet accounts into destination accounts.
 */

const express = require('express');
const router = express.Router();
const StellarSdk = require('../../services/stellar/sdk.js');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { validateSchema } = require('../../middleware/schemaValidation');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const Database = require('../../utils/database');
const log = require('../../utils/log');

const { getStellarService } = require('../../config/stellar');

const walletIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

/**
 * @openapi
 * /wallets/{id}/merge/eligibility:
 *   get:
 *     summary: Check wallet merge eligibility
 *     description: >
 *       Returns whether a wallet account is eligible for merging, along with all
 *       blocking conditions (open offers, non-zero trustlines, data entries, or an
 *       already-merged wallet).
 *     tags:
 *       - Wallets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet (user) identifier
 *     responses:
 *       200:
 *         description: Eligibility result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     walletId:
 *                       type: string
 *                     publicKey:
 *                       type: string
 *                     eligible:
 *                       type: boolean
 *                     blockers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           type:
 *                             type: string
 *                           detail:
 *                             type: string
 *       404:
 *         description: Wallet not found
 *       409:
 *         description: Wallet has already been merged
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - missing wallets:read permission
 *
 * GET /wallets/:id/merge/eligibility
 * Check whether a wallet account is eligible for merging.
 * Returns all blocking conditions (open offers, non-zero trustlines, data entries).
 */
router.get('/:id/merge/eligibility', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const wallet = await Database.get(
      'SELECT id, publicKey, mergedAt FROM users WHERE id = ?',
      [req.params.id]
    );

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (wallet.mergedAt) {
      return res.status(409).json({
        success: false,
        error: 'Wallet has already been merged and closed',
        data: { eligible: false, blockers: [{ type: 'already_merged', detail: 'Wallet was merged on ' + wallet.mergedAt }] }
      });
    }

    const stellarSvc = getStellarService();
    const result = await stellarSvc.validateMergeEligibility(wallet.publicKey);

    res.json({
      success: true,
      data: {
        walletId: wallet.id,
        publicKey: wallet.publicKey,
        eligible: result.eligible,
        blockers: result.blockers,
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * /wallets/{id}/merge:
 *   post:
 *     summary: Merge a wallet into a destination account
 *     description: >
 *       Transfers all XLM from the source wallet to the destination, closes the
 *       source account on the Stellar network, and soft-deletes the wallet record.
 *       Requires explicit confirmation via `confirm: true`.
 *     tags:
 *       - Wallets
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Wallet (user) identifier of the source account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - destinationPublicKey
 *               - sourceSecret
 *               - confirm
 *             properties:
 *               destinationPublicKey:
 *                 type: string
 *                 description: Stellar public key of the receiving account
 *               sourceSecret:
 *                 type: string
 *                 description: Secret key of the wallet being merged
 *               confirm:
 *                 type: boolean
 *                 enum: [true]
 *                 description: Must be exactly true to proceed
 *     responses:
 *       200:
 *         description: Account merged successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     sourceWalletId:
 *                       type: string
 *                     sourcePublicKey:
 *                       type: string
 *                     destinationPublicKey:
 *                       type: string
 *                     mergedAmount:
 *                       type: string
 *                     transactionHash:
 *                       type: string
 *                     ledger:
 *                       type: integer
 *                     mergedAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Missing fields, missing confirmation, invalid secret, or same source/destination
 *       403:
 *         description: Forbidden - sourceSecret does not belong to the wallet, or missing wallets:delete permission
 *       404:
 *         description: Wallet not found
 *       409:
 *         description: Wallet has already been merged
 *       401:
 *         description: Unauthorized
 *
 * POST /wallets/:id/merge
 * Merge a wallet into a destination account.
 *
 * Transfers all XLM from the source wallet to the destination, closes the
 * source account on the Stellar network, and soft-deletes the wallet record.
 *
 * @requires wallets:delete permission
 * @body {string}  destinationPublicKey - Stellar public key of the receiving account
 * @body {string}  sourceSecret         - Secret key of the wallet being merged
 * @body {boolean} confirm              - Must be exactly `true` to proceed
 */
router.post('/:id/merge', checkPermission(PERMISSIONS.WALLETS_DELETE), payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const { destinationPublicKey, sourceSecret, confirm } = req.body;

    // ── Confirmation gate ────────────────────────────────────────────────────
    if (confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Account merge requires explicit confirmation. Set confirm: true to proceed.',
      });
    }

    // ── Required fields ──────────────────────────────────────────────────────
    if (!destinationPublicKey || !sourceSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: destinationPublicKey, sourceSecret',
      });
    }

    // ── Lookup source wallet ─────────────────────────────────────────────────
    const sourceWallet = await Database.get(
      'SELECT id, publicKey, mergedAt FROM users WHERE id = ?',
      [req.params.id]
    );

    if (!sourceWallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (sourceWallet.mergedAt) {
      return res.status(409).json({
        success: false,
        error: 'Wallet has already been merged and closed',
      });
    }

    if (sourceWallet.publicKey === destinationPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Source and destination wallets cannot be the same',
      });
    }

    // ── Keypair ownership verification ─────────────────────────────────────────
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      if (sourceKeypair.publicKey() !== sourceWallet.publicKey) {
        return res.status(403).json({
          success: false,
          error: 'sourceSecret does not belong to the target wallet being merged',
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sourceSecret key format',
      });
    }

    // ── Execute merge on Stellar ─────────────────────────────────────────────
    const stellarService = getStellarService();
    const mergeResult = await stellarService.mergeAccount(sourceSecret, destinationPublicKey);

    // ── Soft-delete source wallet ────────────────────────────────────────────
    const now = new Date().toISOString();
    await Database.run(
      'UPDATE users SET mergedAt = ?, mergedInto = ? WHERE id = ?',
      [now, destinationPublicKey, sourceWallet.id]
    );

    // ── Write audit log ──────────────────────────────────────────────────────
    await Database.run(
      `INSERT INTO wallet_merge_audit
         (sourceWalletId, sourcePublicKey, destinationPublicKey, mergedAmount,
          transactionHash, ledger, performedBy, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceWallet.id,
        sourceWallet.publicKey,
        destinationPublicKey,
        mergeResult.mergedAmount,
        mergeResult.hash,
        mergeResult.ledger,
        req.user ? req.user.id : 'unknown',
        now,
      ]
    );

    log.info('WALLET_ROUTE', 'Wallet merged', {
      sourceId: sourceWallet.id,
      sourcePublicKey: sourceWallet.publicKey,
      destinationPublicKey,
      hash: mergeResult.hash,
    });

    return res.json({
      success: true,
      message: 'Account merged successfully. Source account has been closed.',
      data: {
        sourceWalletId: sourceWallet.id,
        sourcePublicKey: sourceWallet.publicKey,
        destinationPublicKey,
        mergedAmount: mergeResult.mergedAmount,
        transactionHash: mergeResult.hash,
        ledger: mergeResult.ledger,
        mergedAt: now,
      },
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
