/**
 * Donation Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for donation operations
 * OWNER: Backend Team
 * DEPENDENCIES: DonationService, middleware (auth, validation, rate limiting)
 * 
 * Thin controllers that orchestrate service calls for donation creation, verification,
 * and status management. All business logic delegated to DonationService.
 */

/**
 * @openapi
 * tags:
 *   - name: Donations
 *     description: Create and manage donations on the Stellar network
 *
 * /donations:
 *   post:
 *     tags: [Donations]
 *     summary: Create a new donation
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [senderSecret, recipientPublicKey, amount]
 *             properties:
 *               senderSecret:
 *                 type: string
 *                 description: Stellar secret key of the sender
 *               recipientPublicKey:
 *                 type: string
 *                 description: Stellar public key of the recipient
 *               amount:
 *                 type: number
 *                 description: Amount in XLM
 *               memo:
 *                 type: string
 *                 description: Optional transaction memo
 *     responses:
 *       201:
 *         description: Donation created successfully
 *         headers:
 *           X-Request-ID:
 *             $ref: '#/components/headers/XRequestID'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *   get:
 *     tags: [Donations]
 *     summary: List all donations
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Maximum number of results
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *         description: Pagination cursor
 *     responses:
 *       200:
 *         description: List of donations
 *       401:
 *         description: Unauthorized
 *
 * /donations/{id}:
 *   get:
 *     tags: [Donations]
 *     summary: Get a specific donation
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Donation details
 *       404:
 *         description: Donation not found
 *
 * /donations/{id}/status:
 *   patch:
 *     tags: [Donations]
 *     summary: Update donation status
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *                 enum: [pending, completed, failed]
 *     responses:
 *       200:
 *         description: Status updated
 *       404:
 *         description: Donation not found
 *
 * /donations/verify:
 *   post:
 *     tags: [Donations]
 *     summary: Verify a transaction on the blockchain
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transactionHash]
 *             properties:
 *               transactionHash:
 *                 type: string
 *     responses:
 *       200:
 *         description: Verification result
 *
 * /donations/limits:
 *   get:
 *     tags: [Donations]
 *     summary: Get donation amount limits
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Donation limits
 *
 * /donations/recent:
 *   get:
 *     tags: [Donations]
 *     summary: Get recent donations
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: Recent donations
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { requireIdempotency, conditionalIdempotency, storeIdempotencyResponse } = require('../middleware/idempotency');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { donationRateLimiter, verificationRateLimiter, batchRateLimiter } = require('../middleware/rateLimiter');
const perKeyRateLimit = require('../middleware/perKeyRateLimit');
const { validateRequiredFields, validateFloat, validateInteger } = require('../utils/validationHelpers');
const { validateSchema } = require('../middleware/schemaValidation');
const { validateDateRange } = require('../middleware/validation');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { parseAssetInput } = require('../utils/stellarAsset');

const asyncHandler = require('../utils/asyncHandler');
const { getStellarService } = require('../config/stellar');
const config = require('../config');
const DonationService = require('../services/DonationService');
const StatsService = require('../services/StatsService');
const { calculateCostBreakdown } = require('../utils/costBreakdown');
const LimitService = require('../services/LimitService');

const Transaction = require('./models/transaction');
const donationValidator = require('../utils/donationValidator');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');

const statsByTagQuerySchema = validateSchema({
  query: {
    fields: {
      startDate: { type: 'dateString', required: true },
      endDate: { type: 'dateString', required: true },
    },
  },
});
const donationEvents = require('../events/donationEvents');
const { isValidStellarPublicKey } = require('../utils/validators');

const donationService = new DonationService(getStellarService());

const donationIdParamSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

const updateDonationStatusSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  },
  body: {
    fields: {
      status: { type: 'string', required: true, enum: ['pending', 'submitted', 'confirmed', 'failed'] }
    }
  }
});

const sendDonationSchema = validateSchema({
  body: {
    fields: {
      senderId: { type: 'string', required: true, trim: true, minLength: 1 },
      receiverId: { type: 'string', required: true, trim: true, minLength: 1 },
      amount: { type: 'number', required: true },
      memo: { type: 'string', required: false, maxLength: 28, nullable: true },
      campaign_id: { type: 'string', required: false, nullable: true }
    }
  }
});

/**
 * POST /donations/send
 * Send XLM from one wallet to another and record it
 * Requires idempotency key to prevent duplicate transactions
 * Rate limited: 10 requests per minute per IP
 */
router.post('/send', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, requireIdempotency, sendDonationSchema, async (req, res, next) => {
  try {
    const { senderId, receiverId, amount, memo, campaign_id } = req.body;

    log.debug('DONATION_ROUTE', 'Processing donation request', {
      requestId: req.id,
      senderId,
      receiverId,
      amount,
      hasMemo: !!memo
    });

    // Validation
    const requiredValidation = validateRequiredFields(
      { senderId, receiverId, amount },
      ['senderId', 'receiverId', 'amount']
    );

    if (!requiredValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${requiredValidation.missing.join(', ')}`
      });
    }

    if (typeof senderId === 'object' || typeof receiverId === 'object') {
      return res.status(400).json({
        success: false,
        error: 'Malformed request: senderId and receiverId must be valid IDs'
      });
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`
      });
    }

    // Guard: reject donations to expired campaigns
    if (campaign_id) {
      const Database = require('../utils/database');
      const campaign = await Database.get(
        `SELECT id, end_date, status FROM campaigns WHERE id = ? AND deleted_at IS NULL`,
        [campaign_id]
      );
      if (!campaign) {
        return res.status(404).json({ success: false, error: 'Campaign not found' });
      }
      const isExpired =
        campaign.status === 'expired' ||
        (campaign.end_date && new Date(campaign.end_date) < new Date());
      if (isExpired) {
        return res.status(422).json({
          success: false,
          error: 'Campaign has ended',
          campaignId: campaign.id,
          endedAt: campaign.end_date
        });
      }
    }

    // Delegate to service
    const result = await donationService.sendCustodialDonation({
      senderId,
      receiverId,
      amount: amountValidation.value,
      memo,
      campaign_id,
      idempotencyKey: req.idempotency.key,
      requestId: req.id,
      apiKeyId: req.apiKey ? req.apiKey.id : null,
      apiKeyRole: req.apiKey ? req.apiKey.role : (req.user?.role || 'user')
    });

    // Inject remaining limit headers if available
    if (result.remainingLimits) {
      const { dailyRemaining, monthlyRemaining } = result.remainingLimits;
      if (dailyRemaining !== null) res.setHeader('X-Donation-Daily-Remaining', dailyRemaining);
      if (monthlyRemaining !== null) res.setHeader('X-Donation-Monthly-Remaining', monthlyRemaining);
    }

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    const response = {
      success: true,
      data: {
        ...result,
        transactionHash: result.stellarTxId || null,
      },
    };

    await storeIdempotencyResponse(req, response);
    res.status(201).json(response);
  } catch (error) {
    log.error('DONATION_ROUTE', 'Failed to send donation', {
      requestId: req.id,
      error: error.message,
      stack: error.stack
    });

    // Handle duplicate donation gracefully
    if (error.name === 'DuplicateError') {
      return res.status(409).json({
        success: false,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    // Pass business logic and other structured errors to the global error handler
    if (error.statusCode) {
      return next(error);
    }

    res.status(500).json({
      success: false,
      error: 'Failed to send donation',
      message: error.message
    });
  }
});

/**
 * POST /donations/batch
 * Create up to 100 donations in a single request.
 * Donations with the same donor are grouped into multi-operation Stellar transactions.
 * Rate limited: 10 batch requests per minute per IP.
 */
router.post('/batch', payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), batchRateLimiter, requireApiKey, async (req, res, next) => {
  try {
    const { donations } = req.body;

    if (!Array.isArray(donations) || donations.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'donations must be a non-empty array' }
      });
    }

    if (donations.length > 100) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'donations array must not exceed 100 items' }
      });
    }

    // Basic per-item validation
    for (let i = 0; i < donations.length; i++) {
      const d = donations[i];
      if (!d.amount || !d.recipient) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `donations[${i}]: amount and recipient are required` }
        });
      }
    }

    const results = await donationService.processBatch(donations);

    const succeeded = results.filter(r => r.success).length;
    const failed = results.length - succeeded;

    res.status(207).json({
      success: true,
      summary: { total: results.length, succeeded, failed },
      results
    });
  } catch (error) {
    next(error);
  }
});

const createDonationSchema = validateSchema({
  body: {
    fields: {
      amount: { 
        type: 'number', 
        required: true,
        min: config.donations.minAmount,
        max: config.donations.maxAmount,
        validate: (value) => {
          if (!Number.isFinite(value)) return 'Amount must be a finite number';
          if (value <= 0) return 'Amount must be greater than zero';
          return true;
        }
      },
      recipient: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        validate: (value) => {
          // Allow federation addresses (e.g. alice*example.com) to pass through
          if (typeof value === 'string' && value.includes('*')) return true;
          return isValidStellarPublicKey(value)
            ? true
            : 'address must be a valid Stellar public key (56-character Ed25519 public key starting with G)';
        },
      },
      currency: { type: 'string', required: false, nullable: true },
      donor: { type: 'string', required: false, nullable: true },
      memo: { type: 'string', required: false, maxLength: 28, nullable: true },
      memoType: { type: 'string', required: false, nullable: true },
      notes: { type: 'string', required: false, nullable: true },
      tags: { type: 'array', required: false, nullable: true },
      sourceAsset: { type: 'string', required: false, nullable: true },
      sourceAmount: { 
        type: 'number', 
        required: false, 
        nullable: true,
        min: config.donations.minAmount,
        max: config.donations.maxAmount,
        validate: (value) => {
          if (value === null || value === undefined) return true;
          if (!Number.isFinite(value)) return 'Source amount must be a finite number';
          if (value <= 0) return 'Source amount must be greater than zero';
          return true;
        }
      }
    }
  }
});

/**
 * POST /donations
 * Create a non-custodial donation record
 */
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, perKeyRateLimit, requireApiKey, requireIdempotency, createDonationSchema, async (req, res, next) => {
  try {
<<<<<<< fix/donation-created-webhook
    const { amount, currency, donor, recipient, memo, memoType, notes, tags, encryptMemo, anonymous, sourceAsset, sourceAmount } = req.body;
=======
    const { amount, currency, donor, recipient, memo, memoType, notes, tags, sourceAsset, sourceAmount } = req.body;
>>>>>>> main

    // Basic validation
    if (!amount || !recipient) {
      throw new ValidationError('Missing required fields: amount, recipient', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    if (typeof recipient !== 'string' || (donor && typeof donor !== 'string')) {
      return res.status(400).json({
        error: 'Malformed request: donor and recipient must be strings'
      });
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        error: `Invalid amount: ${amountValidation.error}`
      });
    }

    let sourceAmountValidation = null;
    let normalizedSourceAsset = null;
    if (sourceAsset || sourceAmount) {
      normalizedSourceAsset = parseAssetInput(sourceAsset, 'sourceAsset');
      sourceAmountValidation = validateFloat(sourceAmount);
      if (!sourceAmountValidation.valid) {
        return res.status(400).json({
          error: `Invalid sourceAmount: ${sourceAmountValidation.error}`
        });
      }
    }

    // Validate memo type + value combination
    if (memo || memoType) {
      const memoValidator = require('../utils/memoValidator');
      const memoValidation = memoValidator.validateWithType(memo || '', memoType || 'text');
      if (!memoValidation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: memoValidation.code, message: memoValidation.error }
        });
      }
    }

    // Resolve federation address if needed (e.g. alice*example.com → GABC...)
    let resolvedRecipient = recipient;
    if (federation.isFederationAddress(recipient)) {
      resolvedRecipient = await federation.resolveRecipient(recipient);
    }

    // Optionally encrypt memo using recipient's Stellar public key (ECDH)
    let memoEnvelope = null;
    let encryptionMetadata = null;
    if (encryptMemo && memo) {
      try {
        const memoEncryption = require('../utils/memoEncryption');
        memoEnvelope = memoEncryption.encryptMemo(memo, resolvedRecipient);
        encryptionMetadata = {
          encrypted: true,
          algorithm: memoEnvelope.alg,
          nonce: memoEnvelope.iv,
        };
      } catch (encErr) {
        return res.status(400).json({
          success: false,
          error: { code: 'MEMO_ENCRYPTION_FAILED', message: encErr.message }
        });
      }
    }

    // Delegate to service
    const transaction = await donationService.createDonationRecord({
      amount: amountValidation.value,
      currency: currency || 'XLM',
      donor,
      recipient: resolvedRecipient,
      memo,
      sourceAsset: normalizedSourceAsset,
      sourceAmount: sourceAmountValidation ? sourceAmountValidation.value : undefined,
      memoType: memoType || 'text',
      notes,
      tags,
      memoEnvelope,
      encryptionMetadata,
      idempotencyKey: req.idempotency.key,
      apiKeyId: req.apiKey ? req.apiKey.id : null,
      apiKeyRole: req.apiKey ? req.apiKey.role : (req.user?.role || 'user'),
      anonymous: anonymous === true,
      correlationId: req.id,
    });

    // Estimate fee for informational purposes (non-blocking)
    let feeEstimate = null;
    try {
      feeEstimate = await stellarService.estimateFee(1);
    } catch (_err) {
      // Fee estimation is best-effort; don't fail the request
    }

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    const response = {
      success: true,
      data: {
        verified: true,
        transactionHash: transaction.stellarTxId || transaction.id,
        ...(encryptionMetadata && { encryptionMetadata }),
        ...(feeEstimate && {
          estimatedFee: feeEstimate.feeStroops,
          estimatedFeeXLM: feeEstimate.feeXLM,
          ...(feeEstimate.surgeProtection && {
            feeWarning: 'Network fees are elevated (surge pricing active).'
          }),
        }),
      }
    };

    await storeIdempotencyResponse(req, response);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/verify-anonymous
 * Allow a donor to prove their anonymous donation using their wallet address.
 *
 * Query parameters:
 *   @param {string}  amount              - Donation amount in XLM (required, > 0)
 *   @param {string}  [sender]            - Sender public key (optional, for future balance checks)
 *   @param {number}  [surgeFeeMultiplier=1]    - Surge fee multiplier (>= 1)
 *   @param {number}  [xlmUsdRate=0]      - Current XLM/USD rate for USD equivalents
 *
 * Platform fee is read from PLATFORM_FEE_PERCENT env variable (default 0).
 *
 * @access donations:read
 */
router.get('/cost-breakdown', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { amount, surgeFeeMultiplier, xlmUsdRate } = req.query;

    if (!amount) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_AMOUNT', receivedValue: amount }])
      );
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`,
      });
    }

    // Read platform fee from env (default 0, max 100)
    const platformFeePercent = Math.min(
      Math.max(parseFloat(process.env.PLATFORM_FEE_PERCENT || '0') || 0, 0),
      100
    );

    const surgeMultiplier = surgeFeeMultiplier
      ? Math.max(parseFloat(surgeFeeMultiplier) || 1, 1)
      : 1;

    const usdRate = xlmUsdRate ? parseFloat(xlmUsdRate) || 0 : 0;

    const breakdown = calculateCostBreakdown({
      amount: amountValidation.value,
      surgeFeeMultiplier: surgeMultiplier,
      platformFeePercent,
      xlmUsdRate: usdRate,
    });

    return res.json({ success: true, data: breakdown });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/:id/receipt
 * Generate and return a PDF receipt for a confirmed donation.
 */
router.get('/:id/receipt', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../services/ReceiptService');
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

/**
 * POST /donations/:id/receipt/email
 * Send a PDF receipt to the provided email address.
 * Body: { email: string }
 */
router.post('/:id/receipt/email', requireApiKey, donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const ReceiptService = require('../services/ReceiptService');
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

/**
 * GET /donations/:id/memo/decrypt
 * Decrypt an encrypted memo for a specific donation.
 *
 * Only the recipient (holder of the Stellar private key) can decrypt the memo.
 * The caller must supply their Stellar secret key as a query parameter.
 *
 * Query params:
 *   - recipientSecret {string} Stellar S... secret key of the recipient
 *
 * Security note: In production, memo decryption should be performed client-side
 * so that private keys never leave the user's device. This endpoint is provided
 * for server-side integrations and testing only.
 */
router.get('/:id/memo/decrypt', requireApiKey, donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recipientSecret } = req.query;

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

    const MemoEncryptionService = require('../services/MemoEncryptionService');
    const decrypted = await MemoEncryptionService.decrypt(transaction.memo, recipientSecret);
    return res.json({ success: true, data: { memo: decrypted } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id/certificate
 * Return the NFT donation certificate details for a specific donation.
 * Returns 404 if the donation is not found or has no minted certificate.
 */
router.get('/:id/certificate', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = Transaction.getById(req.params.id);

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'SAME_SENDER_RECIPIENT', receivedValue: recipient }])
      );
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

/**
 * POST /donations
 * Create a new donation.
 * Requires Idempotency-Key header (UUID v4) to prevent duplicate donations from network retries.
 */
// In-memory per-donor serialization lock to prevent TOCTOU on daily limit checks (#806).
// Acceptable for single-instance deployments; replace with a distributed lock for multi-instance.
const _donorLocks = new Map();
async function withDonorLock(donorId, fn) {
  const prev = _donorLocks.get(donorId) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  _donorLocks.set(donorId, next);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    if (_donorLocks.get(donorId) === next) _donorLocks.delete(donorId);
  }
}

router.post('/', donationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_CREATE), conditionalIdempotency, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { senderId, receiverId, amount, memo } = req.body;

    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderId, receiverId, amount'
      });
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({ success: false, error: `Invalid amount: ${amountValidation.error}` });
    }

    // Validate memo byte length per Stellar MEMO_TEXT spec (max 28 bytes)
    if (memo !== undefined && memo !== null && memo !== '') {
      const MemoValidator = require('../utils/memoValidator');
      const memoValidation = MemoValidator.validate(memo);
      if (!memoValidation.valid) {
        return res.status(400).json({ success: false, error: 'Memo text must be 28 bytes or less' });
      }
    }

    // #806: enforce maxDailyPerDonor limit with per-donor serialization to prevent TOCTOU
    const config = require('../config');
    const globalDailyMax = config.donations.maxDailyPerDonor;

    // Compute rate-limit header values (best-effort; 0 = unlimited)
    let dailyLimit = null;
    let dailyUsed = 0;
    if (globalDailyMax > 0) {
      dailyUsed = await LimitService.getDailyTotal(senderId);
      dailyLimit = globalDailyMax;
    }

    // Set X-RateLimit-* headers on every POST /donations response
    const resetsAt = new Date();
    resetsAt.setUTCHours(24, 0, 0, 0); // midnight UTC next day
    if (dailyLimit !== null) {
      res.set('X-RateLimit-Limit', String(dailyLimit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, dailyLimit - dailyUsed)));
      res.set('X-RateLimit-Reset', String(Math.floor(resetsAt.getTime() / 1000)));
    }

    // Enforce the limit inside a per-donor lock to prevent concurrent bypass
    if (globalDailyMax > 0) {
      try {
        await withDonorLock(String(senderId), () =>
          LimitService.checkLimits(senderId, amountValidation.value)
        );
      } catch (limitErr) {
        if (limitErr && limitErr.details && limitErr.details.limit !== undefined) {
          const { limit, used, remaining } = limitErr.details;
          return res.status(429).json({
            error: 'Daily donation limit exceeded',
            limit,
            used,
            remaining: remaining !== undefined ? remaining : Math.max(0, limit - used),
            resetsAt: resetsAt.toISOString(),
          });
        }
        return next(limitErr);
      }
    }

    const result = await donationService.sendCustodialDonation({
      senderId,
      receiverId,
      amount: amountValidation.value,
      memo: memo || null,
      idempotencyKey: req.idempotency && req.idempotency.key,
      requestId: req.id,
    });

    const response = {
      success: true,
      data: {
        ...result,
        transactionHash: result.stellarTxId || null,
      },
    };
    await storeIdempotencyResponse(req, response);

    return res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}));

function formatBatchDonationError(index, code, message) {
  return {
    success: false,
    index,
    error: {
      code,
      message,
    },
  };
}

function formatBatchDonationSuccess(index, data) {
  return {
    success: true,
    index,
    data,
  };
}

router.post('/batch', requireApiKey, batchRateLimiter, checkPermission(PERMISSIONS.DONATIONS_CREATE), payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), asyncHandler(async (req, res, next) => {
  try {
    const donations = req.body;

    if (!Array.isArray(donations)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAYLOAD',
          message: 'Request body must be an array of donation objects'
        }
      });
    }

    if (donations.length === 0 || donations.length > 100) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BATCH_SIZE',
          message: 'Batch must contain between 1 and 100 donation objects'
        }
      });
    }

    const results = [];

    for (let index = 0; index < donations.length; index += 1) {
      const donation = donations[index];

      if (!donation || typeof donation !== 'object' || Array.isArray(donation)) {
        results.push(formatBatchDonationError(index, 'INVALID_DONATION', 'Each batch item must be an object')); 
        continue;
      }

      const missingFields = [];
      if (donation.senderId === undefined || donation.senderId === null) missingFields.push('senderId');
      if (donation.receiverId === undefined || donation.receiverId === null) missingFields.push('receiverId');
      if (donation.amount === undefined || donation.amount === null) missingFields.push('amount');

      if (missingFields.length > 0) {
        results.push(formatBatchDonationError(index, 'MISSING_FIELDS', `Missing required fields: ${missingFields.join(', ')}`));
        continue;
      }

      const senderIdValidation = validateInteger(donation.senderId, { min: 1 });
      if (!senderIdValidation.valid) {
        results.push(formatBatchDonationError(index, 'INVALID_SENDER_ID', `Invalid senderId: ${senderIdValidation.error}`));
        continue;
      }

      const receiverIdValidation = validateInteger(donation.receiverId, { min: 1 });
      if (!receiverIdValidation.valid) {
        results.push(formatBatchDonationError(index, 'INVALID_RECEIVER_ID', `Invalid receiverId: ${receiverIdValidation.error}`));
        continue;
      }

      const amountValidation = validateFloat(donation.amount);
      if (!amountValidation.valid) {
        results.push(formatBatchDonationError(index, 'INVALID_AMOUNT', `Invalid amount: ${amountValidation.error}`));
        continue;
      }

      if (donation.memo !== undefined && donation.memo !== null && donation.memo !== '') {
        if (typeof donation.memo !== 'string') {
          results.push(formatBatchDonationError(index, 'INVALID_MEMO', 'Memo must be a string')); 
          continue;
        }
        const MemoValidator = require('../utils/memoValidator');
        const memoValidation = MemoValidator.validate(donation.memo);
        if (!memoValidation.valid) {
          results.push(formatBatchDonationError(index, 'INVALID_MEMO', 'Memo text must be 28 bytes or less'));
          continue;
        }
      }

      try {
        const result = await donationService.sendCustodialDonation({
          senderId: senderIdValidation.value,
          receiverId: receiverIdValidation.value,
          amount: amountValidation.value,
          memo: donation.memo || null,
          notes: donation.notes || null,
          tags: donation.tags || null,
          apiKeyId: req.apiKey?.id,
          requestId: req.id,
        });
        results.push(formatBatchDonationSuccess(index, result));
      } catch (error) {
        const code = error.code || 'DONATION_FAILED';
        const message = error.message || 'Donation processing failed';
        results.push(formatBatchDonationError(index, code, message));
      }
    }

    return res.status(207).json({
      success: true,
      results,
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/bulk
 * Batch donation creation with 207 Multi-Status response.
 * - Up to 50 items per request
 * - Concurrent processing (BULK_DONATION_CONCURRENCY, default 5)
 * - Per-item validation; failures don't block other items
 * - Rate limiting counts each item against the per-key quota
 * - Per-item idempotency keys via item.idempotencyKey
 * - Requires donations:write permission
 */
router.post('/bulk', checkPermission(PERMISSIONS.DONATIONS_CREATE), payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), asyncHandler(async (req, res, next) => {
  try {
    const { donations } = req.body || {};

    if (!Array.isArray(donations)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PAYLOAD', message: "'donations' must be an array" } });
    }
    if (donations.length === 0 || donations.length > 50) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_BATCH_SIZE', message: 'Batch must contain 1–50 items' } });
    }

    // Rate-limit: consume one quota unit per item
    const apiKeyId = req.apiKey?.id || req.ip;
    const quotaKey = `bulk_donation_quota:${apiKeyId}`;
    const windowMs = 60_000;
    const maxPerWindow = 50;
    const now = Date.now();
    const windowStart = now - windowMs;
    if (!router._bulkQuota) router._bulkQuota = new Map();
    const timestamps = (router._bulkQuota.get(quotaKey) || []).filter(t => t > windowStart);
    if (timestamps.length + donations.length > maxPerWindow) {
      return res.status(429).json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Bulk donation quota exceeded (50 items/min)' } });
    }
    for (let i = 0; i < donations.length; i++) timestamps.push(now);
    router._bulkQuota.set(quotaKey, timestamps);

    const CONCURRENCY = parseInt(process.env.BULK_DONATION_CONCURRENCY || '5', 10);
    const IdempotencyService = require('../services/IdempotencyService');
    const idempotencySvc = new IdempotencyService();

    // Process items in concurrent batches
    const results = new Array(donations.length);

    async function processItem(index) {
      const item = donations[index];

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        results[index] = { index, status: 'failed', error: { code: 'INVALID_ITEM', message: 'Each item must be an object' } };
        return;
      }

      // Per-item idempotency
      const itemKey = item.idempotencyKey;
      if (itemKey) {
        try {
          const cached = await idempotencySvc.get(itemKey);
          if (cached) {
            results[index] = { index, status: 'success', ...cached.response };
            return;
          }
        } catch (_) {}
      }

      // Validate
      const missing = [];
      if (item.senderId == null) missing.push('senderId');
      if (item.receiverId == null) missing.push('receiverId');
      if (item.amount == null) missing.push('amount');
      if (missing.length > 0) {
        results[index] = { index, status: 'failed', error: { code: 'MISSING_FIELDS', message: `Missing: ${missing.join(', ')}` } };
        return;
      }

      const senderVal = validateInteger(item.senderId, { min: 1 });
      if (!senderVal.valid) { results[index] = { index, status: 'failed', error: { code: 'INVALID_SENDER_ID', message: senderVal.error } }; return; }

      const receiverVal = validateInteger(item.receiverId, { min: 1 });
      if (!receiverVal.valid) { results[index] = { index, status: 'failed', error: { code: 'INVALID_RECEIVER_ID', message: receiverVal.error } }; return; }

      const amountVal = validateFloat(item.amount);
      if (!amountVal.valid) { results[index] = { index, status: 'failed', error: { code: 'INVALID_AMOUNT', message: amountVal.error } }; return; }

      try {
        const result = await donationService.sendCustodialDonation({
          senderId: senderVal.value,
          receiverId: receiverVal.value,
          amount: amountVal.value,
          memo: item.memo || null,
          notes: item.notes || null,
          tags: item.tags || null,
          apiKeyId: req.apiKey?.id,
          requestId: req.id,
        });
        const itemResult = { index, status: 'success', donationId: result.id, transactionHash: result.transactionHash };
        results[index] = itemResult;
        if (itemKey) {
          idempotencySvc.store(itemKey, null, itemResult).catch(() => {});
        }
      } catch (err) {
        results[index] = { index, status: 'failed', error: { code: err.code || 'DONATION_FAILED', message: err.message || 'Donation failed' } };
      }
    }

    // Run with concurrency limit
    for (let i = 0; i < donations.length; i += CONCURRENCY) {
      const chunk = [];
      for (let j = i; j < Math.min(i + CONCURRENCY, donations.length); j++) {
        chunk.push(processItem(j));
      }
      await Promise.all(chunk);
    }

    return res.status(207).json({ results });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations
 * List all donations with cursor-based pagination.
 * Query params:
 *   - limit: integer (default 20, max 100)
 *   - cursor: opaque string for pagination
 *   - sort: one of id:asc, id:desc, timestamp:asc, timestamp:desc, amount:asc, amount:desc
 *   - status: comma-separated status values (pending, submitted, confirmed, failed)
 *   - from: start date filter
 *   - to: end date filter
 *   - minAmount: minimum donation amount
 *   - maxAmount: maximum donation amount
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    // #798: validate ?sort param
    const VALID_SORT = ['id:asc', 'id:desc', 'timestamp:asc', 'timestamp:desc', 'amount:asc', 'amount:desc'];
    const sort = req.query.sort;
    if (sort !== undefined && !VALID_SORT.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SORT',
          message: `Invalid sort value. Valid options: ${VALID_SORT.join(', ')}`,
        },
      });
    }

    const pagination = parseCursorPaginationQuery(req.query);
    const [sortBy, order] = sort ? sort.split(':') : ['timestamp', 'desc'];

    // #766: parse filter params from query string
    const { status, from, to, minAmount, maxAmount } = req.query;

    // Support comma-separated status values (e.g. ?status=pending,submitted)
    let statusFilter;
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    const filters = {
      sortBy,
      order,
      ...(statusFilter !== undefined && { status: statusFilter }),
      ...(from && { startDate: from }),
      ...(to && { endDate: to }),
      ...(minAmount !== undefined && { minAmount }),
      ...(maxAmount !== undefined && { maxAmount }),
    };

    const result = donationService.getPaginatedDonations(pagination, filters);
    res.setHeader('X-Total-Count', String(result.totalCount));

    // Return standard pagination response format
    res.json({
      success: true,
      data: result.data,
      pagination: {
        nextCursor: result.meta.next_cursor,
        hasMore: result.meta.next_cursor !== null,
        total: result.totalCount,
      },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/pending (#795)
 * List donations currently in 'pending' state with stuck-transaction detection.
 *
 * Authorization:
 *   - Regular users: see only their own pending donations (matched by donor field)
 *   - Admin users: see all pending donations + summary object
 *
 * Query params:
 *   - stuckThresholdSeconds {integer} override stuck threshold (default 600)
 */
const STUCK_THRESHOLD_SECONDS = 600; // 10 minutes

router.get('/pending', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const stuckThreshold = parseInt(req.query.stuckThresholdSeconds, 10) || STUCK_THRESHOLD_SECONDS;
    const now = Date.now();

    let pending = Transaction.getByStatus('pending');

    // Non-admin users see only their own pending donations
    if (!isAdmin) {
      const userKey = req.user && (req.user.publicKey || req.user.id);
      if (userKey) {
        pending = pending.filter(tx => tx.donor === userKey);
      } else {
        pending = [];
      }
    }

    const enriched = pending.map(tx => {
      const submittedAt = tx.statusUpdatedAt || tx.timestamp;
      const pendingDurationSeconds = submittedAt
        ? Math.floor((now - new Date(submittedAt).getTime()) / 1000)
        : 0;
      const isStuck = pendingDurationSeconds >= stuckThreshold;

      const humanDuration = (() => {
        const s = pendingDurationSeconds;
        if (s < 60) return `${s} seconds`;
        if (s < 3600) return `${Math.floor(s / 60)} minutes`;
        return `${Math.floor(s / 3600)} hours`;
      })();

      return {
        id: tx.id,
        amount: tx.amount,
        donorPublicKey: tx.donor || null,
        recipientPublicKey: tx.recipient || null,
        stellarTxHash: tx.stellarTxId || null,
        submittedAt: submittedAt || null,
        pendingDurationSeconds,
        pendingDurationHuman: humanDuration,
        retryCount: tx.feeBumpCount || 0,
        isStuck,
        stuckThresholdSeconds: stuckThreshold,
      };
    });

    const response = { data: enriched };

    if (isAdmin) {
      const stuckCount = enriched.filter(tx => tx.isStuck).length;
      const oldestPendingSeconds = enriched.length > 0
        ? Math.max(...enriched.map(tx => tx.pendingDurationSeconds))
        : 0;
      response.summary = {
        total: enriched.length,
        stuckCount,
        oldestPendingSeconds,
      };
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/by-campaign/:campaignId
 * Returns paginated donations linked to a campaign.
 * Must be registered before /:id to prevent Express matching the path as an id.
 *
 * Query params:
 *   - status  {string}  filter by donation status (pending|submitted|confirmed|failed)
 *   - limit   {integer} page size (default 20, max 100)
 *   - cursor  {integer} last seen donation id for cursor-based pagination
 */
router.get('/by-campaign/:campaignId', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { status, cursor } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    // Verify campaign exists
    const Database = require('../utils/database');
    const campaign = await Database.get(
      'SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL',
      [campaignId]
    );
    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found' },
      });
    }

    // Build query
    const params = [campaignId];
    let where = 'WHERE t.campaign_id = ?';

    if (status) {
      where += ' AND t.status = ?';
      params.push(status);
    }

    if (cursor) {
      where += ' AND t.id > ?';
      params.push(parseInt(cursor, 10));
    }

    // Total count (without cursor)
    const countParams = [campaignId];
    let countWhere = 'WHERE t.campaign_id = ?';
    if (status) {
      countWhere += ' AND t.status = ?';
      countParams.push(status);
    }
    const countRow = await Database.get(
      `SELECT COUNT(*) as total FROM transactions t ${countWhere}`,
      countParams
    );

    const rows = await Database.query(
      `SELECT t.id, t.amount, t.status, t.stellar_tx_id as transactionHash,
              t.timestamp, t.anonymous,
              sender.publicKey as donorPublicKey,
              t.tags
       FROM transactions t
       LEFT JOIN users sender ON t.senderId = sender.id
       ${where}
       ORDER BY t.id ASC
       LIMIT ?`,
      [...params, limit]
    );

    const data = rows.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donorPublicKey: tx.anonymous ? null : tx.donorPublicKey,
      timestamp: tx.timestamp,
      status: tx.status,
      transactionHash: tx.transactionHash,
      tags: tx.tags ? JSON.parse(tx.tags) : [],
    }));

    const nextCursor = rows.length === limit && rows.length > 0
      ? rows[rows.length - 1].id
      : null;

    res.json({
      success: true,
      data,
      count: data.length,
      total: countRow.total,
      pagination: { limit, nextCursor },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/recent
 * Get recent donations, ordered by creation date descending.
 * Must be registered before /:id to prevent Express matching "recent" as an id.
 *
 * Query params:
 *   - limit {integer} max results to return (default 10, max configurable via RECENT_DONATIONS_MAX_LIMIT, default 100)
 */
const Cache = require('../utils/cache');
const RECENT_MAX_LIMIT = parseInt(process.env.RECENT_DONATIONS_MAX_LIMIT || '100', 10);
const RECENT_CACHE_TTL_MS = parseInt(process.env.RECENT_DONATIONS_CACHE_TTL_SECONDS || '5', 10) * 1000;

// Invalidate recent donations cache when a new donation is created
donationEvents.on(donationEvents.EVENTS.CREATED, () => {
  Cache.clearPrefix('donations:recent:');
});

router.get('/recent', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;

    let limit = 10;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(rawLimit).trim() !== String(Math.floor(parsed))) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_LIMIT', message: 'limit must be a positive integer' },
        });
      }
      limit = Math.min(parsed, RECENT_MAX_LIMIT);
    }

    const cacheKey = `donations:recent:${limit}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    const Database = require('../utils/database');
    const [rows, countRow] = await Promise.all([
      Database.query('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?', [limit]),
      Database.get('SELECT COUNT(*) AS total FROM transactions'),
    ]);

    res.setHeader('X-Total-Count', String(countRow ? countRow.total : rows.length));
    const body = { success: true, data: rows, count: rows.length };
    Cache.set(cacheKey, body, RECENT_CACHE_TTL_MS);
    res.setHeader('X-Cache', 'MISS');
    res.json(body);
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /donations/verify
 * Verify a transaction on the Stellar blockchain.
 *
 * Requires both transactionHash and donationId.
 * The endpoint validates that the submitted hash matches the donation record
 * and that the on-chain amount, sender, and recipient are consistent.
 *
 * Non-admin callers must also supply walletAddress to prove ownership.
 */
router.post('/verify', verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { transactionHash, donationId, walletAddress } = req.body;

    if (!transactionHash) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'transactionHash is required' },
      });
    }

    if (!donationId) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'donationId is required' },
      });
    }

    let result;
    try {
      result = await donationService.verifyTransaction(transactionHash, donationId);
    } catch (verifyError) {
      // Surface VERIFICATION_FAILED errors as HTTP 422
      if (verifyError.code === 'VERIFICATION_FAILED' || verifyError.errorCode === 'VERIFICATION_FAILED') {
        return res.status(422).json({
          success: false,
          error: {
            code: 'VERIFICATION_FAILED',
            message: verifyError.message,
          },
        });
      }
      throw verifyError;
    }

    // Admins can verify any transaction; non-admins must own it
    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin) {
      if (!walletAddress) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELD', message: 'walletAddress is required' },
        });
      }
      const tx = result.transaction;
      const isOwner = tx && (tx.source === walletAddress || tx.destination === walletAddress);
      if (!isOwner) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You are not authorized to verify this transaction' },
        });
      }
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id/status
 * Server-Sent Events (SSE) endpoint for real-time donation status updates.
 * Opens a long-lived HTTP connection and pushes status_update events as the
 * donation progresses through its lifecycle (pending → processing → completed/failed).
 *
 * Authentication: Requires API key
 * Authorization: Users may only stream their own donations; admins may stream any donation
 * Auto-close: Connection closes when donation reaches terminal state (completed/failed)
 * Timeout: Connection closes after 5 minutes regardless of state
 * Keepalive: Sends comment every 15 seconds to prevent proxy timeouts
 * Reconnection: Instructs clients to reconnect after 3 seconds if connection drops
 */
router.get('/:id/status', requireApiKey, donationIdParamSchema, asyncHandler(async (req, res, next) => {
  const donationId = req.params.id;

  try {
    // Fetch donation to verify it exists and check authorization
    const donation = donationService.getDonationById(donationId);

    // Authorization: users can only stream their own donations, admins can stream any
    const isAdmin = req.apiKey?.role === 'admin';
    const userOwns = donation.senderId === req.apiKey?.id || donation.receiverId === req.apiKey?.id;
    if (!isAdmin && !userOwns) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to stream this donation' },
      });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    // Send retry directive (3 seconds)
    res.write('retry: 3000\n\n');

    // Send initial status_update event
    const sendStatusUpdate = (status, txHash, ledger) => {
      const event = {
        donationId: donation.id,
        status,
        timestamp: new Date().toISOString(),
      };
      if (txHash) event.txHash = txHash;
      if (ledger) event.ledger = ledger;
      res.write(`event: status_update\ndata: ${JSON.stringify(event)}\n\n`);
    };

    sendStatusUpdate(donation.status, donation.stellar_tx_id, donation.ledger);

    // If already in terminal state, close immediately
    if (donation.status === 'confirmed' || donation.status === 'failed') {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: donation.status })}\n\n`);
      res.end();
      return;
    }

    // Keepalive interval (15 seconds)
    const keepaliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    // 5-minute timeout
    const timeoutMs = 5 * 60 * 1000;
    const timeoutTimer = setTimeout(() => {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'timeout', finalStatus: donation.status })}\n\n`);
      res.end();
    }, timeoutMs);

    // Listen for donation status updates
    const statusUpdateHandler = (payload) => {
      if (payload.donationId === donation.id) {
        sendStatusUpdate(payload.status, payload.txHash, payload.ledger);

        // Close connection on terminal state (confirmed = completed in this system)
        if (payload.status === 'confirmed' || payload.status === 'failed') {
          res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: payload.status })}\n\n`);
          res.end();
        }
      }
    };

    donationEvents.on('donation.submitted', statusUpdateHandler);
    donationEvents.on('donation.confirmed', statusUpdateHandler);
    donationEvents.on('donation.failed', statusUpdateHandler);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(keepaliveInterval);
      clearTimeout(timeoutTimer);
      donationEvents.off('donation.submitted', statusUpdateHandler);
      donationEvents.off('donation.confirmed', statusUpdateHandler);
      donationEvents.off('donation.failed', statusUpdateHandler);
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/export
 * Stream donations as CSV or JSON. Requires admin role.
 * Supports filters: format, startDate, endDate, status, senderPublicKey, recipientPublicKey
 * Issue #919
 */
router.get('/export', requireApiKey, checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const { format = 'csv', startDate, endDate, status, senderPublicKey, recipientPublicKey } = req.query;

  if (!['csv', 'json'].includes(format)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_FORMAT', message: 'format must be csv or json' } });
  }

  const db = require('../utils/database');
  const BATCH_SIZE = 1000;
  const CSV_HEADERS = ['id', 'amount', 'senderPublicKey', 'recipientPublicKey', 'memo', 'status', 'timestamp', 'transactionHash'];

  let query = `
    SELECT t.id, t.amount,
           sender.publicKey AS senderPublicKey,
           receiver.publicKey AS recipientPublicKey,
           t.memo, t.status, t.timestamp, t.stellar_tx_id AS transactionHash
    FROM transactions t
    LEFT JOIN users sender ON t.senderId = sender.id
    LEFT JOIN users receiver ON t.receiverId = receiver.id
    WHERE 1=1
  `;
  const params = [];
  if (startDate)          { query += ' AND t.timestamp >= ?'; params.push(startDate); }
  if (endDate)            { query += ' AND t.timestamp <= ?'; params.push(endDate); }
  if (status)             { query += ' AND t.status = ?'; params.push(status); }
  if (senderPublicKey)    { query += ' AND sender.publicKey = ?'; params.push(senderPublicKey); }
  if (recipientPublicKey) { query += ' AND receiver.publicKey = ?'; params.push(recipientPublicKey); }
  query += ' ORDER BY t.timestamp DESC';

  function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return (s.includes('"') || s.includes(',') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="donations-${ts}.csv"`);
    res.write(CSV_HEADERS.join(',') + '\n');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.write('[');
  }

  let offset = 0;
  let firstRow = true;

  for (;;) {
    const rows = await db.all(query + ` LIMIT ${BATCH_SIZE} OFFSET ${offset}`, params);
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      if (format === 'csv') {
        res.write(CSV_HEADERS.map(h => csvEscape(row[h])).join(',') + '\n');
      } else {
        res.write((firstRow ? '' : ',') + JSON.stringify(row));
        firstRow = false;
      }
    }
    if (rows.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  if (format === 'json') res.write(']');
  res.end();
}));

/**
 * GET /donations/search
 * Search donations with full-text and field filtering
 * 
 * Query params:
 *   - q: memo text search (case-insensitive LIKE)
 *   - minAmount: minimum donation amount
 *   - maxAmount: maximum donation amount
 *   - startDate: start date (ISO 8601)
 *   - endDate: end date (ISO 8601)
 *   - status: donation status filter
 *   - senderPublicKey: filter by sender public key
 *   - recipientPublicKey: filter by recipient public key
 *   - limit: max results (default 50, max 100)
 *   - cursor: pagination cursor
 */
router.get('/search', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const Database = require('../utils/database');
    const { q, minAmount, maxAmount, startDate, endDate, status, senderPublicKey, recipientPublicKey, limit = 50, cursor } = req.query;

    // Validate numeric parameters
    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 100);
    if (parsedLimit < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_LIMIT', message: 'limit must be >= 1' }
      });
    }

    const parsedMinAmount = minAmount !== undefined ? parseFloat(minAmount) : undefined;
    const parsedMaxAmount = maxAmount !== undefined ? parseFloat(maxAmount) : undefined;

    if (minAmount !== undefined && isNaN(parsedMinAmount)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_MIN_AMOUNT', message: 'minAmount must be a valid number' }
      });
    }

    if (maxAmount !== undefined && isNaN(parsedMaxAmount)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_MAX_AMOUNT', message: 'maxAmount must be a valid number' }
      });
    }

    // Build WHERE clause
    const conditions = [];
    const params = [];

    if (q) {
      conditions.push('memo LIKE ?');
      params.push(`%${q}%`);
    }

    if (parsedMinAmount !== undefined) {
      conditions.push('amount >= ?');
      params.push(parsedMinAmount);
    }

    if (parsedMaxAmount !== undefined) {
      conditions.push('amount <= ?');
      params.push(parsedMaxAmount);
    }

    if (startDate) {
      conditions.push('timestamp >= ?');
      params.push(startDate);
    }

    if (endDate) {
      conditions.push('timestamp <= ?');
      params.push(endDate);
    }

    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }

    if (senderPublicKey) {
      conditions.push('sender_public_key = ?');
      params.push(senderPublicKey);
    }

    if (recipientPublicKey) {
      conditions.push('recipient_public_key = ?');
      params.push(recipientPublicKey);
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    // Get total count
    const countResult = await Database.get(
      `SELECT COUNT(*) as total FROM transactions ${whereClause}`,
      params
    );
    const totalCount = countResult?.total || 0;

    // Get paginated results
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const rows = await Database.query(
      `SELECT * FROM transactions ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, parsedLimit + 1, offset]
    );

    const hasMore = rows.length > parsedLimit;
    const data = rows.slice(0, parsedLimit);
    const nextCursor = hasMore ? offset + parsedLimit : null;

    res.setHeader('X-Total-Count', String(totalCount));
    res.json({
      success: true,
      data,
      pagination: {
        cursor: offset,
        nextCursor,
        hasMore,
        limit: parsedLimit,
        total: totalCount
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = donationService.getDonationById(req.params.id);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    // ETag and conditional request support (#751)
    const lastModifiedDate = new Date(transaction.statusUpdatedAt || transaction.timestamp);
    const etag = `"${transaction.id}-${lastModifiedDate.getTime()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModifiedDate.toUTCString());
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    if (req.headers['if-modified-since']) {
      const ifModifiedSince = new Date(req.headers['if-modified-since']);
      if (!isNaN(ifModifiedSince.getTime()) && lastModifiedDate <= ifModifiedSince) {
        return res.status(304).end();
      }
    }

    // HTTP/2 server push + Link header for related resources
    const { pushDonationRelated } = require('../utils/pushHelper');
    pushDonationRelated(req, res, transaction);

    res.json({
      success: true,
      data: applyNotePrivacy(req, transaction)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/:id/timeline
 * Get the complete lifecycle timeline of a donation
 */
router.get('/:id/timeline', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const donationId = req.params.id;
    const Database = require('../utils/database');

    // Verify donation exists
    const donation = donationService.getDonationById(donationId);
    if (!donation) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Donation not found' }
      });
    }

    const timeline = [];

    // Event 1: Donation created
    timeline.push({
      timestamp: donation.timestamp,
      event: 'created',
      details: {
        amount: donation.amount,
        donor: donation.donor,
        recipient: donation.recipient,
        memo: donation.memo || null
      }
    });

    // Event 2: Status changes from audit logs
    try {
      const auditLogs = await Database.query(
        `SELECT * FROM audit_logs 
         WHERE resource LIKE ? AND action LIKE 'DONATION_%' 
         ORDER BY created_at ASC`,
        [`%${donationId}%`]
      );

      for (const log of auditLogs) {
        if (log.action === 'DONATION_SUBMITTED') {
          timeline.push({
            timestamp: log.created_at,
            event: 'submitted',
            details: log.details || {}
          });
        } else if (log.action === 'DONATION_CONFIRMED') {
          timeline.push({
            timestamp: log.created_at,
            event: 'confirmed',
            details: log.details || {}
          });
        } else if (log.action === 'DONATION_FAILED') {
          timeline.push({
            timestamp: log.created_at,
            event: 'failed',
            details: log.details || {}
          });
        } else if (log.action === 'DONATION_STATUS_CHANGED') {
          timeline.push({
            timestamp: log.created_at,
            event: 'status_changed',
            details: log.details || {}
          });
        }
      }
    } catch (err) {
      // Audit logs table may not exist, continue
    }

    // Event 3: Refunds
    try {
      const refunds = await Database.query(
        `SELECT * FROM refunds 
         WHERE donation_id = ? 
         ORDER BY created_at ASC`,
        [donationId]
      );

      for (const refund of refunds) {
        timeline.push({
          timestamp: refund.created_at,
          event: 'refunded',
          details: {
            refund_id: refund.id,
            amount: refund.amount,
            reason: refund.reason || null,
            status: refund.status || 'pending'
          }
        });
      }
    } catch (err) {
      // Refunds table may not exist, continue
    }

    // Event 4: Matching donations
    try {
      const matchingDonations = await Database.query(
        `SELECT md.*, mp.sponsor_wallet_id 
         FROM matching_donations md
         JOIN matching_programs mp ON md.matching_program_id = mp.id
         WHERE md.original_donation_id = ? 
         ORDER BY md.created_at ASC`,
        [donationId]
      );

      for (const match of matchingDonations) {
        timeline.push({
          timestamp: match.created_at,
          event: 'matched',
          details: {
            matching_program_id: match.matching_program_id,
            sponsor_wallet_id: match.sponsor_wallet_id,
            matched_amount: match.matched_amount
          }
        });
      }
    } catch (err) {
      // Matching donations table may not exist, continue
    }

    // Sort timeline by timestamp
    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: timeline
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', checkPermission(PERMISSIONS.DONATIONS_UPDATE), updateDonationStatusSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger, notes, tags } = req.body;

    if (!status) {
      throw new ValidationError('Missing required field: status', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;
    if (notes !== undefined) stellarData.notes = notes;
    if (tags !== undefined) stellarData.tags = tags;

    const updatedTransaction = donationService.updateDonationStatus(id, status, stellarData);

    // Mark processing complete
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

/**
 * POST /donations/:id/refund — #797
 * Initiate a refund for a completed donation.
 * Body: { reason, notes, idempotencyKey, recipientSecret }
 * - 404 if donation not found
 * - 409 if already refunded (idempotency key match returns 200 with existing record)
 * - 422 if not in completed/confirmed status or refund window expired
 */
router.post('/:id/refund', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), donationIdParamSchema, payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, notes, idempotencyKey, recipientSecret } = req.body;

    // Validate donation ID
    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'Invalid donation ID' }
      });
    }

    // Process refund — service throws NotFoundError(404), BusinessLogicError(422), DuplicateError(409)
    const refundResult = await donationService.refundDonation(id, {
      reason: reason || null,
      notes: notes || null,
      idempotencyKey: idempotencyKey || null,
      recipientSecret: recipientSecret || null,
      requestId: req.id,
    });

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    // Idempotent replay: service signals this was already processed
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

// ─── Claimable Balance Endpoints ─────────────────────────────────────────────

const createClaimableSchema = validateSchema({
  body: {
    fields: {
      signedXDR: { type: 'string', required: true },
      amount: { type: 'numberString', required: true, min: 0.0000001 },
      claimants: { type: 'array', required: true },
      predicate: { type: 'object', required: false, nullable: true },
    },
  },
});

/**
 * POST /donations/claimable
 * Create a claimable balance (XLM held until claimed by an eligible account).
 * The transaction must be signed client-side and submitted as a pre-signed XDR envelope.
 */
router.post(
  '/claimable',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  createClaimableSchema,
  asyncHandler(async (req, res, next) => {
    try {
      const { signedXDR, amount, claimants, predicate } = req.body;

      if (!Array.isArray(claimants) || claimants.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'claimants must be a non-empty array' },
        });
      }

      const result = await stellarService.submitSignedTransaction(signedXDR);

      // Store claimable balance ID in transaction records
      Transaction.create({
        amount: parseFloat(amount),
        donor: claimants[0] && claimants[0].destination,
        recipient: claimants.map(c => c.destination).join(','),
        status: 'pending',
        stellarTxId: result.transactionId,
        stellarLedger: result.ledger,
        balanceId: result.balanceId,
        type: 'claimable',
      });

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  })
);

/**
 * POST /donations/claimable/:id/claim
 * Claim a claimable balance by its ID.
 * The claim transaction must be signed client-side and submitted as a pre-signed XDR envelope.
 */
router.post(
  '/claimable/:id/claim',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { signedXDR } = req.body;

      if (!signedXDR) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'signedXDR is required' },
        });
      }

      const result = await stellarService.submitSignedTransaction(signedXDR);

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  })
);

/**
 * GET /donations/:id/impact
 * Calculate the real-world impact of a specific donation based on its campaign's impact metrics.
 *
 * Returns an array of impact breakdowns per metric (e.g. "5 meals delivered").
 * Returns an empty impact array if the donation has no campaign_id or no metrics are defined.
 */
router.get('/:id/impact', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const ImpactMetricService = require('../services/ImpactMetricService');
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

// ─── Cross-Asset Donations ────────────────────────────────────────────────────

const crossAssetSchema = validateSchema({
  body: {
    fields: {
      signedXDR: { type: 'string', required: true },
      sendAsset: { types: ['string', 'object'], required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { types: ['string', 'object'], required: true },
      slippageTolerance: { type: 'number', required: false },
      memo: { type: 'string', required: false, maxLength: 255, nullable: true },
    },
    validate: (body) => {
      if (body.sendAmount === undefined && body.destAmount === undefined) {
        return 'Either sendAmount or destAmount is required';
      }
      if (body.sendAmount !== undefined && body.destAmount !== undefined) {
        return 'Provide either sendAmount (strict-send) or destAmount (strict-receive), not both';
      }
      const tol = body.slippageTolerance;
      if (tol !== undefined && (typeof tol !== 'number' || tol < 0 || tol > 1)) {
        return 'slippageTolerance must be a number between 0 and 1';
      }
      return null;
    },
  },
});

const crossAssetPathsSchema = validateSchema({
  query: {
    fields: {
      sourcePublicKey: { type: 'string', required: true },
      destPublicKey: { type: 'string', required: true },
      destAsset: { type: 'string', required: true },
      destAmount: { type: 'numberString', required: true },
    },
  },
});

/**
 * POST /donations/cross-asset
 * Execute a cross-asset donation via Stellar DEX path payment.
 *
 * The transaction must be built and signed client-side, then submitted as a
 * pre-signed XDR envelope. Use GET /donations/cross-asset/paths to discover
 * available conversion paths before building the transaction.
 *
 * Body:
 *   - signedXDR {string} required — pre-signed transaction XDR envelope
 *   - sendAsset {string|object} required — "native" or {code, issuer}
 *   - sendAmount {string} — for strict-send
 *   - destPublicKey {string} required
 *   - destAsset {string|object} required
 *   - destAmount {string} — for strict-receive
 *   - slippageTolerance {number} optional, 0–1, default 0.01 (1%)
 *   - memo {string} optional
 */
router.post('/cross-asset', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, requireApiKey, requireIdempotency, crossAssetSchema, asyncHandler(async (req, res, next) => {
  try {
    const {
      signedXDR,
      destPublicKey,
    } = req.body;

    if (!signedXDR || !destPublicKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_REQUIRED_FIELDS', receivedValue: null }])
      );
    }

    const stellarService = getStellarService();

    const result = await stellarService.submitSignedTransaction(signedXDR);

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/cross-asset/paths
 * Preview available DEX conversion paths before committing to a cross-asset donation.
 *
 * Query params:
 *   - sourcePublicKey {string} required
 *   - destPublicKey {string} required
 *   - destAsset {string} required — "native" or JSON {code, issuer}
 *   - destAmount {string} required
 */
router.get('/cross-asset/paths', requireApiKey, crossAssetPathsSchema, asyncHandler(async (req, res, next) => {
  try {
    const { sourcePublicKey, destPublicKey, destAsset: rawDestAsset, destAmount } = req.query;

    const destAsset = parseAssetInput(rawDestAsset, 'destAsset');
    const paths = await stellarService.findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount);

    if (paths.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_PATH_FOUND', message: 'No conversion paths found for the specified assets and amount' },
      });
    }

    return res.status(200).json({ success: true, data: { paths } });
  } catch (error) {
    next(error);
  }
}));

// ─── IPFS Certificate ─────────────────────────────────────────────────────────

const { pinCertificate, GATEWAY_URL } = require('../utils/ipfs');
const Database = require('../utils/database');

/**
 * GET /donations/:id/certificate/ipfs
 * Returns the IPFS gateway URL for a donation's impact certificate.
 * If no CID is stored yet, pins the certificate on demand.
 */
router.get('/:id/certificate/ipfs', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    const tx = await Database.get('SELECT * FROM transactions WHERE id = ?', [donationId]);
    if (!tx) {
      const { NotFoundError } = require('../utils/errors');
      throw new NotFoundError(`Donation ${donationId} not found`);
    }

    let cid = tx.ipfs_cid;
    let pinned = !!cid;

    if (!cid) {
      // Pin on demand
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

/**
 * GET /donations/limits
 * Return the configured minimum and maximum donation amounts.
 * Response is cached for 1 hour (Cache-Control: public, max-age=3600).
 * ETag is derived from the config values so it changes when config changes.
 */
router.get('/limits', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res) => {
  const config = require('../config');
  const crypto = require('crypto');
  const { minAmount, maxAmount, maxDailyPerDonor } = config.donations;

  const limitsData = { minAmount, maxAmount, maxDailyPerDonor, currency: 'XLM' };
  const etag = `"${crypto.createHash('sha256').update(JSON.stringify(limitsData)).digest('hex').slice(0, 32)}"`;

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('ETag', etag);

  // Conditional GET support
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
    return res.status(304).end();
  }

  return res.json({ success: true, data: limitsData });
});

/**
 * GET /donations/stats/by-campaign
 * Aggregate donation statistics per campaign.
 * Supports date range filtering, sorting, and pagination.
 * Results are cached for 60 seconds.
 */
router.get('/stats/by-campaign', checkPermission(PERMISSIONS.STATS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { from, to, sort = 'totalRaised', order = 'desc', limit = 20, offset = 0 } = req.query;
    
    // Validate sort parameter
    const validSortFields = ['totalRaised', 'donorCount', 'donationCount'];
    if (!validSortFields.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SORT',
          message: `Invalid sort field. Valid options: ${validSortFields.join(', ')}`
        }
      });
    }
    
    // Validate order parameter
    const validOrders = ['asc', 'desc'];
    if (!validOrders.includes(order.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_ORDER',
          message: 'Order must be "asc" or "desc"'
        }
      });
    }
    
    // Parse and validate limit
    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);
    
    // Build query with optional date filtering
    let query = `
      SELECT
        c.id as campaignId,
        c.name as campaignName,
        COALESCE(SUM(t.amount), 0) as totalRaised,
        COUNT(DISTINCT t.senderId) as donorCount,
        COUNT(t.id) as donationCount,
        COALESCE(AVG(t.amount), 0) as averageDonation,
        c.goal_amount as goalAmount,
        CASE 
          WHEN c.goal_amount > 0 THEN ROUND((COALESCE(SUM(t.amount), 0) / c.goal_amount) * 100, 2)
          ELSE 0
        END as percentComplete,
        MIN(t.timestamp) as firstDonationAt,
        MAX(t.timestamp) as lastDonationAt
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
    `;
    
    const params = [];
    const conditions = [];
    
    // Add date range filtering
    if (from) {
      conditions.push('t.timestamp >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('t.timestamp <= ?');
      params.push(to);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ` GROUP BY c.id, c.name, c.goal_amount`;
    query += ` HAVING COUNT(t.id) > 0`; // Exclude campaigns with zero donations
    
    // Map sort field to column name
    const sortColumnMap = {
      'totalRaised': 'totalRaised',
      'donorCount': 'donorCount',
      'donationCount': 'donationCount'
    };
    
    query += ` ORDER BY ${sortColumnMap[sort]} ${order.toUpperCase()}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(parsedLimit, parsedOffset);
    
    const data = await Database.query(query, params);
    
    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT c.id) as total
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
    `;
    
    const countParams = [];
    const countConditions = [];
    
    if (from) {
      countConditions.push('t.timestamp >= ?');
      countParams.push(from);
    }
    if (to) {
      countConditions.push('t.timestamp <= ?');
      countParams.push(to);
    }
    
    if (countConditions.length > 0) {
      countQuery += ' WHERE ' + countConditions.join(' AND ');
    }
    
    countQuery += ` GROUP BY c.id HAVING COUNT(t.id) > 0`;
    
    const countResult = await Database.query(countQuery, countParams);
    const total = countResult.length;
    
    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=60');
    
    res.json({
      success: true,
      data,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /donations/stats/by-tag
 * Aggregate donation statistics per tag.
 * Query params: startDate, endDate (ISO format)
 */
router.get('/stats/by-tag', checkPermission(PERMISSIONS.STATS_READ), statsByTagQuerySchema, validateDateRange, asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const data = StatsService.getTagStats(start, end);

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      success: true,
      data,
      metadata: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalTags: data.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}));

// ─── Donation Tags (Issue #65) ────────────────────────────────────────────────

const { validateTag } = require('../constants/tags');

/**
 * GET /donations/:id/tags
 * Returns the current list of tags for a donation.
 * Requires donations:read permission.
 */
router.get('/:id/tags', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res) => {
  const tx = Transaction.getById(req.params.id);
  if (!tx) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Donation not found' } });
  return res.json({ success: true, data: { tags: tx.tags || [] } });
}));

/**
 * POST /donations/:id/tags
 * Add tags to a donation (idempotent — duplicates are ignored).
 * Body: { tags: string[] }
 * Requires donations:write (DONATIONS_UPDATE) permission.
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
  transactions[idx].tags = updated;
  Transaction.saveTransactions(transactions);

  return res.json({ success: true, data: { tags: updated } });
}));

/**
 * DELETE /donations/:id/tags/:tag
 * Remove a specific tag from a donation.
 * Requires donations:write (DONATIONS_UPDATE) permission.
 */
router.delete('/:id/tags/:tag', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), asyncHandler(async (req, res) => {
  const tx = Transaction.getById(req.params.id);
  if (!tx) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Donation not found' } });

  const { tag } = req.params;
  const updated = (tx.tags || []).filter(t => t !== tag);

  const transactions = Transaction.loadTransactions();
  const idx = transactions.findIndex(t => t.id === tx.id);
  transactions[idx].tags = updated;
  Transaction.saveTransactions(transactions);

  return res.json({ success: true, data: { tags: updated } });
}));

module.exports = router;

