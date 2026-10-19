/**
 * Donations Sub-Router — Per-Donation Actions
 *
 * Handles all endpoints that operate on a specific donation by ID:
 *   GET    /donations/:id/receipt           — generate PDF receipt
 *   POST   /donations/:id/receipt/email     — email PDF receipt
 *   POST   /donations/:id/memo/decrypt      — decrypt encrypted memo
 *   GET    /donations/:id/certificate       — NFT certificate details
 *   GET    /donations/:id/certificate/ipfs  — IPFS certificate pinning
 *   GET    /donations/:id/impact            — real-world impact metrics
 *   PATCH  /donations/:id/status            — update donation status
 *   POST   /donations/:id/approve           — record a multi-sig signer approval
 *   POST   /donations/:id/refund            — initiate refund
 *   GET    /donations/:id/tags              — list tags
 *   POST   /donations/:id/tags              — add tags
 *   DELETE /donations/:id/tags/:tag        — remove a tag
 */

'use strict';

const express = require('express');
const router = express.Router();

const requireApiKey = require('../../middleware/apiKey');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const log = require('../../utils/log');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const { getStellarService } = require('../../config/stellar');
const DonationService = require('../../services/DonationService');
const Transaction = require('../../models/transaction');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');
const { validateTag } = require('../../constants/tags');
const { pinCertificate, GATEWAY_URL } = require('../../utils/ipfs');
const Database = require('../../utils/database');

const {
  donationIdParamSchema,
  updateDonationStatusSchema,
  applyNotePrivacy,
  LIFECYCLE_STAGES,
} = require('./helpers');

const donationService = new DonationService(getStellarService());

// ─── GET /donations/:id/receipt ───────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/receipt:
 *   get:
 *     tags: [Donations]
 *     summary: Download a PDF receipt for a donation
 *     description: Generates and returns a PDF receipt for a confirmed donation.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: PDF receipt
 *         content:
 *           application/pdf:
 *             schema:
 *               type: string
 *               format: binary
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.get('/:id/receipt', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../../services/ReceiptService');
    const transaction = donationService.getDonationById(req.params.id);

    const pdf = await ReceiptService.generatePDF(transaction);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${transaction.id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/:id/receipt/email ───────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/receipt/email:
 *   post:
 *     tags: [Donations]
 *     summary: Email a PDF receipt for a donation
 *     description: Sends a PDF receipt to the provided email address.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: X-Idempotency-Key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *     responses:
 *       200:
 *         description: Receipt sent
 *       400:
 *         description: Missing email or idempotency key
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.post('/:id/receipt/email', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../../services/ReceiptService');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: { message: 'email is required' } });
    }

    const idempotencyKey = req.get('X-Idempotency-Key');
    if (!idempotencyKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_IDEMPOTENCY_KEY', receivedValue: undefined }])
      );
    }

    const transaction = Transaction.getById(req.params.id);
    if (!transaction) {
      return res.status(404).json({ success: false, error: { message: 'Donation not found' } });
    }

    await ReceiptService.sendEmail(transaction, email);
    return res.json({ success: true, message: 'Receipt sent' });
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/:id/memo/decrypt ────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/memo/decrypt:
 *   post:
 *     tags: [Donations]
 *     summary: Decrypt an encrypted memo for a donation
 *     description: >
 *       Decrypts the encrypted memo attached to a donation. Security note: in
 *       production, memo decryption should be performed client-side so that
 *       private keys never leave the user's device. This endpoint is provided
 *       for server-side integrations and testing only.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [recipientSecret]
 *             properties:
 *               recipientSecret:
 *                 type: string
 *                 description: Stellar S... secret key of the recipient
 *     responses:
 *       200:
 *         description: Decrypted memo
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
 *                     memo:
 *                       type: string
 *       400:
 *         description: Missing recipientSecret
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.post('/:id/memo/decrypt', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recipientSecret } = req.body || {};

    const transaction = Transaction.getById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Donation ${id} not found` }
      });
    }

    if (!recipientSecret) {
      return res.status(400).json({ success: false, error: { message: 'recipientSecret is required' } });
    }

    const MemoEncryptionService = require('../../services/MemoEncryptionService');
    const decrypted = await MemoEncryptionService.decrypt(transaction.memo, recipientSecret);
    return res.json({ success: true, data: { memo: decrypted } });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/:id/certificate ──────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/certificate:
 *   get:
 *     tags: [Donations]
 *     summary: Get the NFT certificate details for a donation
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: NFT certificate details
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation or certificate not found
 */
router.get('/:id/certificate', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = Transaction.getById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Donation ${req.params.id} not found` },
      });
    }

    if (!transaction.nft_asset_code) {
      return res.status(404).json({
        success: false,
        error: { code: 'CERTIFICATE_NOT_FOUND', message: 'No NFT certificate has been minted for this donation' },
      });
    }

    if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

    res.json({
      success: true,
      data: {
        donationId: transaction.id,
        nftAssetCode: transaction.nft_asset_code,
        nftIssuer: transaction.nft_issuer,
        nftTxHash: transaction.nft_tx_hash,
        nftMintedAt: transaction.nft_minted_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /donations/:id/certificate/ipfs ─────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/certificate/ipfs:
 *   get:
 *     tags: [Donations]
 *     summary: Get the IPFS gateway URL for a donation's impact certificate
 *     description: Returns the IPFS gateway URL for a donation's impact certificate. Pins on demand if no CID is stored yet.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: IPFS certificate location
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
 *                     donationId:
 *                       type: integer
 *                     cid:
 *                       type: string
 *                     gateway:
 *                       type: string
 *                     pinned:
 *                       type: boolean
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.get('/:id/certificate/ipfs', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    const tx = await Database.get('SELECT * FROM transactions WHERE id = ?', [donationId]);
    if (!tx) {
      const { NotFoundError } = require('../../utils/errors');
      throw new NotFoundError(`Donation ${donationId} not found`);
    }

    let cid = tx.ipfs_cid;
    let pinned = !!cid;

    if (!cid) {
      const result = await pinCertificate({
        id: tx.id,
        senderPublicKey: tx.senderPublicKey || String(tx.senderId),
        receiverPublicKey: tx.receiverPublicKey || String(tx.receiverId),
        amount: tx.amount,
        memo: tx.memo,
        timestamp: tx.timestamp,
      });
      cid = result.cid;
      pinned = result.pinned;
      await Database.run('UPDATE transactions SET ipfs_cid = ? WHERE id = ?', [cid, donationId]);
    }

    return res.json({
      success: true,
      data: { donationId, cid, gateway: `${GATEWAY_URL}/${cid}`, pinned },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/:id/impact ────────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/impact:
 *   get:
 *     tags: [Donations]
 *     summary: Calculate the real-world impact of a donation
 *     description: Calculates the real-world impact of a donation based on its campaign's metrics.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Impact metrics for the donation
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.get('/:id/impact', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ImpactMetricService = require('../../services/ImpactMetricService');
    const transaction = donationService.getDonationById(req.params.id);

    if (!transaction.campaign_id) {
      return res.json({
        success: true,
        data: {
          donation_id: transaction.id,
          amount: transaction.amount,
          campaign_id: null,
          impact: [],
          message: 'No campaign associated with this donation',
        },
      });
    }

    const impact = await ImpactMetricService.calculateDonationImpact(
      parseFloat(transaction.amount),
      transaction.campaign_id
    );

    res.json({
      success: true,
      data: {
        donation_id: transaction.id,
        amount: transaction.amount,
        campaign_id: transaction.campaign_id,
        impact,
      },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── PATCH /donations/:id/status ──────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/status:
 *   patch:
 *     tags: [Donations]
 *     summary: Update a donation's status
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *               stellarTxId:
 *                 type: string
 *               ledger:
 *                 type: integer
 *               notes:
 *                 type: string
 *               tags:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated donation
 *       400:
 *         description: Missing required field status
 *       403:
 *         description: Caller lacks the donations:update permission
 *       404:
 *         description: Donation not found
 */
router.patch('/:id/status', checkPermission(PERMISSIONS.DONATIONS_UPDATE), updateDonationStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger, notes, tags } = req.body;

    const { ValidationError, ERROR_CODES } = require('../../utils/errors');
    if (!status) {
      throw new ValidationError('Missing required field: status', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;
    if (notes !== undefined) stellarData.notes = notes;
    if (tags !== undefined) stellarData.tags = tags;

    const updatedTransaction = donationService.updateDonationStatus(id, status, stellarData);

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: applyNotePrivacy(req, updatedTransaction)
    });
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/:id/approve ──────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/approve:
 *   post:
 *     tags: [Donations]
 *     summary: Record a multi-signer approval for a high-value donation (#1498)
 *     description: >
 *       Donations above the configured MULTISIG_THRESHOLD_XLM are created with
 *       status `awaiting_approval` instead of being submitted immediately.
 *       Each call records one signer's approval; once the required number of
 *       distinct signers have approved, the donation is submitted to Stellar
 *       automatically. Requires the `donations:approve` permission (granted to
 *       the `signer` and `admin` roles).
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signerKeyId]
 *             properties:
 *               signerKeyId:
 *                 type: string
 *                 description: Identifier of the approving signer (e.g. their Stellar public key)
 *     responses:
 *       200:
 *         description: Approval recorded (and donation submitted if fully approved)
 *       400:
 *         description: Validation error (missing signerKeyId, duplicate approval)
 *       403:
 *         description: Caller lacks the donations:approve permission
 *       404:
 *         description: Donation not found
 *       422:
 *         description: Donation is not currently awaiting approval, or the approval window has expired
 */
router.post('/:id/approve', checkPermission(PERMISSIONS.DONATIONS_APPROVE), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { signerKeyId } = req.body || {};

    const result = await donationService.approveDonation(id, {
      signerKeyId,
      requestId: req.id,
    });

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: {
        donationId: id,
        status: result.transaction.status,
        approvalsCount: result.approvalsCount,
        requiredApprovals: result.required,
        fullyApproved: result.fullyApproved,
        stellarTxId: result.transaction.stellarTxId || null,
      },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/:id/refund ───────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/refund:
 *   post:
 *     tags: [Donations]
 *     summary: Initiate a refund for a completed donation (#797)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *               notes:
 *                 type: string
 *               idempotencyKey:
 *                 type: string
 *               recipientSecret:
 *                 type: string
 *     responses:
 *       200:
 *         description: Refund already processed (idempotent replay)
 *       201:
 *         description: Refund initiated
 *       400:
 *         description: Invalid donation ID
 *       403:
 *         description: Caller lacks the donations:update permission
 *       404:
 *         description: Donation not found
 */
router.post('/:id/refund', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, notes, idempotencyKey, recipientSecret } = req.body;

    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid donation ID' }
      });
    }

    const refundResult = await donationService.refundDonation(id, {
      reason: reason || null,
      notes: notes || null,
      idempotencyKey: idempotencyKey || null,
      recipientSecret: recipientSecret || null,
      requestId: req.id,
    });

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    const statusCode = refundResult.alreadyProcessed ? 200 : 201;

    res.status(statusCode).json({
      success: true,
      data: {
        refundId: refundResult.refundId,
        donationId: parseInt(id, 10),
        originalAmount: refundResult.amount,
        refundedAmount: refundResult.refundedAmount || refundResult.amount,
        networkFeeDeducted: refundResult.networkFeeDeducted || 0,
        stellarTxHash: refundResult.reverseTxId || refundResult.transactionId || null,
        status: refundResult.status || 'completed',
        reason: refundResult.reason || reason || null,
        processedAt: refundResult.refundedAt || new Date().toISOString(),
      },
    });
  } catch (error) {
    log.error('DONATION_ROUTE', 'Failed to process refund', {
      requestId: req.id,
      error: error.message,
    });
    next(error);
  }
}));

// ─── GET /donations/:id/tags ──────────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/tags:
 *   get:
 *     tags: [Donations]
 *     summary: List tags for a donation
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current tags
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
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *       403:
 *         description: Caller lacks the donations:read permission
 *       404:
 *         description: Donation not found
 */
router.get('/:id/tags', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res) => {
  const tx = Transaction.getById(req.params.id);
  if (!tx) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Donation not found' } });
  return res.json({ success: true, data: { tags: tx.tags || [] } });
}));

// ─── POST /donations/:id/tags ─────────────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/tags:
 *   post:
 *     tags: [Donations]
 *     summary: Add tags to a donation
 *     description: Adds tags to a donation. Idempotent — duplicates are ignored.
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tags]
 *             properties:
 *               tags:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Updated tag list
 *       400:
 *         description: Invalid or empty tags
 *       403:
 *         description: Caller lacks the donations:update permission
 *       404:
 *         description: Donation not found
 */
router.post('/:id/tags', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), donationIdParamSchema, asyncHandler(async (req, res) => {
  const tx = Transaction.getById(req.params.id);
  if (!tx) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Donation not found' } });

  const { tags } = req.body || {};
  if (!Array.isArray(tags) || tags.length === 0) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: "'tags' must be a non-empty array" } });
  }

  for (const tag of tags) {
    const result = validateTag(tag);
    if (!result.valid) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_TAG', message: result.reason, tag } });
    }
  }

  const existing = new Set(tx.tags || []);
  for (const tag of tags) existing.add(tag);
  const updated = Array.from(existing);

  const transactions = Transaction.loadTransactions();
  const idx = transactions.findIndex(t => t.id === tx.id);
  if (idx !== -1) {
    transactions[idx].tags = updated;
    Transaction.saveTransactions(transactions);
  }
  tx.tags = updated;

  try {
    const TagService = require('../../services/TagService');
    await TagService.associateTags(tx.id, tags);
  } catch (_) { /* best-effort */ }

  return res.json({ success: true, data: { tags: updated } });
}));

// ─── DELETE /donations/:id/tags/:tag ──────────────────────────────────────────

/**
 * @openapi
 * /donations/{id}/tags/{tag}:
 *   delete:
 *     tags: [Donations]
 *     summary: Remove a tag from a donation
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: tag
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Updated tag list
 *       403:
 *         description: Caller lacks the donations:update permission
 *       404:
 *         description: Donation not found
 */
router.delete('/:id/tags/:tag', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), asyncHandler(async (req, res) => {
  const tx = Transaction.getById(req.params.id);
  if (!tx) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Donation not found' } });

  const { tag } = req.params;
  const updated = (tx.tags || []).filter(t => t !== tag);

  const transactions = Transaction.loadTransactions();
  const idx = transactions.findIndex(t => t.id === tx.id);
  if (idx !== -1) {
    transactions[idx].tags = updated;
    Transaction.saveTransactions(transactions);
  }
  tx.tags = updated;

  try {
    const TagService = require('../../services/TagService');
    await TagService.removeTagFromDonation(tx.id, tag);
  } catch (_) { /* best-effort */ }

  return res.json({ success: true, data: { tags: updated } });
}));

module.exports = router;
