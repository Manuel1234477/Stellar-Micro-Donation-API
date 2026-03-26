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

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { requireIdempotency, storeIdempotencyResponse } = require('../middleware/idempotency');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { donationRateLimiter, verificationRateLimiter, batchRateLimiter } = require('../middleware/rateLimiter');
const { validateRequiredFields, validateFloat, validateInteger } = require('../utils/validationHelpers');
const { validateSchema } = require('../middleware/schemaValidation');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { parseAssetInput } = require('../utils/stellarAsset');

const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const Transaction = require('./models/transaction');
const { LIFECYCLE_STAGES } = require('../middleware/requestLifecycle');
const federation = require('../utils/federation');
const stellarService = getStellarService();
const donationService = new DonationService(stellarService);
const safeBatchRateLimiter = typeof batchRateLimiter === 'function'
  ? batchRateLimiter
  : (_req, _res, next) => next();

// Helper to enforce note privacy
function applyNotePrivacy(req, tx) {
  if (!tx) return tx;
  const isOwner = req.apiKey && tx.apiKeyId === req.apiKey.id;
  const isAdmin = req.apiKey && req.apiKey.role === 'admin';
  
  if (!isOwner && !isAdmin && tx.notes !== undefined) {
    // eslint-disable-next-line no-unused-vars
    const { notes, ...rest } = tx;
    return rest;
    const sanitized = { ...tx };
    delete sanitized.notes;
    return sanitized;
  }
  return tx;
}

const verifyDonationSchema = validateSchema({
  body: {
    fields: {
      transactionHash: {
        type: 'string',
        required: true,
        trim: true,
      },
    },
  },
});

const sendDonationSchema = validateSchema({
  body: {
    fields: {
      senderId: { type: 'integer', required: true, min: 1 },
      receiverId: { type: 'integer', required: true, min: 1 },
      amount: { type: 'number', required: true, min: 0.0000001 },
      memo: { type: 'string', required: false, maxLength: 255, nullable: true },
      campaign_id: { type: 'integer', required: false, min: 1, nullable: true },
    },
  },
});

const createDonationSchema = validateSchema({
  body: {
    fields: {
      amount: { type: 'numberString', required: true, min: 0.0000001 },
      currency: {
        type: 'string',
        required: false,
        maxLength: 10,
        nullable: true,
      },
      donor: {
        type: 'string',
        required: false,
        maxLength: 255,
        nullable: true,
      },
      recipient: {
        type: 'string',
        required: true,
        maxLength: 255,
      },
      memo: {
        type: 'string',
        required: false,
        maxLength: 255,
        nullable: true,
      },
      sourceAsset: {
        types: ['string', 'object'],
        required: false,
        nullable: true,
      },
      sourceAmount: {
        type: 'numberString',
        required: false,
      },
      memoType: {
        type: 'string',
        required: false,
        nullable: true,
        enum: ['text', 'hash', 'id', 'return'],
      },
      encryptMemo: {
        type: 'boolean',
        required: false,
        nullable: true,
      },
      notes: {
        type: 'string',
        required: false,
        maxLength: 1000,
        nullable: true,
      },
      tags: {
        type: 'array',
        required: false,
        nullable: true,
      },
      anonymous: {
        type: 'boolean',
        required: false,
        nullable: true,
      },
    },
    validate: (body) => {
      if ((body.sourceAsset && !body.sourceAmount) || (!body.sourceAsset && body.sourceAmount)) {
        return 'sourceAsset and sourceAmount must be provided together';
      }

      return null;
    },
  },
});

const pathEstimateSchema = validateSchema({
  query: {
    fields: {
      sourceAsset: {
        type: 'string',
        required: true,
      },
      sourceAmount: {
        type: 'numberString',
        required: false,
      },
      destAsset: {
        type: 'string',
        required: false,
      },
      destAmount: {
        type: 'numberString',
        required: false,
      },
    },
    validate: (query) => {
      if (!query.sourceAmount && !query.destAmount) {
        return 'Either sourceAmount or destAmount is required';
      }

      return null;
    },
  },
});

const donationIdParamSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 },
    },
  },
});

const recentDonationsQuerySchema = validateSchema({
  query: {
    fields: {
      limit: {
        type: 'integerString',
        required: false,
        validate: (value) => {
          const parsed = Number(value);
          return parsed >= 1 && parsed <= 100
            ? true
            : 'limit must be an integer between 1 and 100';
        },
      },
    },
  },
});

const updateDonationStatusSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 },
    },
  },
  body: {
    fields: {
      status: {
        type: 'string',
        required: true,
        enum: [...Object.values(TRANSACTION_STATES), 'completed', 'cancelled'],
      },
      stellarTxId: {
        type: 'string',
        required: false,
        maxLength: 128,
        nullable: true,
      },
      ledger: {
        type: 'integer',
        required: false,
        min: 1,
        nullable: true,
      },
      notes: {
        type: 'string',
        required: false,
        maxLength: 1000,
        nullable: true,
      },
      tags: {
        type: 'array',
        required: false,
        nullable: true,
      },
    },
  },
});

/**
 * POST /donations/verify
 * Verify a donation transaction by hash
 * Rate limited: 30 requests per minute per IP
 */
router.post('/verify', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_VERIFY), verifyDonationSchema, async (req, res) => {
  try {
    const { transactionHash } = req.body;
    const verification = await donationService.verifyTransaction(transactionHash);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.status(200).json({
      success: true,
      data: verification
    });
  } catch (error) {
    const status = error.status || error.statusCode || 500;
    const code = error.code || error.errorCode || 'VERIFICATION_FAILED';
    const message = error.message || 'Failed to verify transaction';

    res.status(status).json({
      success: false,
      error: {
        code,
        message
      }
    });
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
      data: result
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
router.post('/batch', payloadSizeLimiter(ENDPOINT_LIMITS.batchDonation), safeBatchRateLimiter, requireApiKey, async (req, res, next) => {
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

/**
 * POST /donations
 * Create a non-custodial donation record
 */
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, requireApiKey, requireIdempotency, createDonationSchema, async (req, res, next) => {
  try {
    const { amount, currency, donor, recipient, memo, memoType, notes, tags, encryptMemo } = req.body;
    const { amount, currency, donor, recipient, memo, memoType, notes, tags, anonymous } = req.body;
    const { amount, currency, donor, recipient, memo, memoType, notes, tags, sourceAsset, sourceAmount } = req.body;

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
 *   - donationId    {string} - The ID of the anonymous donation
 *   - walletAddress {string} - The donor's wallet address to verify
 *
 * Returns { verified: boolean, donationId, pseudonymousId, amount, recipient, timestamp }
 */
router.get('/verify-anonymous', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const { donationId, walletAddress } = req.query;

    if (!donationId || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'donationId and walletAddress query parameters are required',
        },
      });
    }

    const result = donationService.verifyAnonymousDonation(donationId, walletAddress);

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/fee-estimate
 * Returns the current estimated transaction fee from the Stellar network.
 * Query params:
 *   - operations: number of operations (default: 1)
 */
router.get('/fee-estimate', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const operationCount = Math.max(1, parseInt(req.query.operations, 10) || 1);
    const estimate = await stellarService.estimateFee(operationCount);

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: {
        estimatedFee: estimate.feeStroops,
        estimatedFeeXLM: estimate.feeXLM,
        baseFee: estimate.baseFee,
        operationCount,
        surgeProtection: estimate.surgeProtection,
        surgeMultiplier: estimate.surgeMultiplier,
        ...(estimate.surgeProtection && {
          warning: 'Network fees are elevated (surge pricing active). Fees are significantly above baseline.'
        }),
      }
    });
  } catch (error) {
    next(error);
  }
});

const listDonationsQuerySchema = validateSchema({
  query: {
    allowUnknown: true,
    fields: {
      startDate:  { type: 'string',  required: false, nullable: true },
      endDate:    { type: 'string',  required: false, nullable: true },
      minAmount:  { type: 'string',  required: false, nullable: true },
      maxAmount:  { type: 'string',  required: false, nullable: true },
      status:     { type: 'string',  required: false, nullable: true, enum: ['pending', 'submitted', 'confirmed', 'failed'] },
      donor:      { type: 'string',  required: false, nullable: true, maxLength: 255 },
      recipient:  { type: 'string',  required: false, nullable: true, maxLength: 255 },
      memo:       { type: 'string',  required: false, nullable: true, maxLength: 255 },
      sortBy:     { type: 'string',  required: false, nullable: true, enum: ['timestamp', 'amount', 'status'] },
      order:      { type: 'string',  required: false, nullable: true, enum: ['asc', 'desc'] },
    },
  },
});

/**
 * GET /donations
 * Get all donations with optional filtering and search.
 *
 * Query parameters:
 *   - startDate {string}  ISO date; include donations on or after this date
 *   - endDate   {string}  ISO date; include donations on or before this date
 *   - minAmount {number}  Minimum donation amount (inclusive)
 *   - maxAmount {number}  Maximum donation amount (inclusive)
 *   - status    {string}  Exact status: pending | submitted | confirmed | failed
 *   - donor     {string}  Case-insensitive substring match on donor
 *   - recipient {string}  Case-insensitive substring match on recipient
 *   - memo      {string}  Case-insensitive full-text search on memo
 *   - sortBy    {string}  Sort field: timestamp (default) | amount | status
 *   - order     {string}  Sort order: desc (default) | asc
 *   - cursor, limit, direction  Cursor pagination (see pagination docs)
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), listDonationsQuerySchema, (req, res, next) => {
  try {
    const { tag } = req.query;
    const pagination = parseCursorPaginationQuery(req.query);
    const result = donationService.getPaginatedDonations(pagination, { tag });
    
    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.setHeader('X-Total-Count', String(result.totalCount));
    
    const protectedData = result.data.map(tx => applyNotePrivacy(req, tx));

    res.json({
      success: true,
      data: protectedData,
      count: protectedData.length,
      meta: result.meta
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/path-estimate
 * Estimate the best Stellar path payment route for a donation.
 */
router.get('/path-estimate', requireApiKey, pathEstimateSchema, async (req, res, next) => {
  try {
    const sourceAmount = req.query.sourceAmount ? validateFloat(req.query.sourceAmount) : null;
    const destAmount = req.query.destAmount ? validateFloat(req.query.destAmount) : null;

    if (sourceAmount && !sourceAmount.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid sourceAmount: ${sourceAmount.error}`
      });
    }

    if (destAmount && !destAmount.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid destAmount: ${destAmount.error}`
      });
    }

    const estimate = await donationService.estimateDonationPath({
      sourceAsset: req.query.sourceAsset,
      sourceAmount: sourceAmount ? sourceAmount.value : undefined,
      destAsset: req.query.destAsset,
      destAmount: destAmount ? destAmount.value : undefined,
    });

    res.status(200).json({
      success: true,
      data: estimate,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/limits
 * Get current donation amount limits
 */
router.get('/limits', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const limits = donationService.getDonationLimits();
    
    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }
    
    res.json({
      success: true,
      data: limits
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/recent
 * Get recent donations (read-only, no sensitive data)
 * Query params:
 *   - limit: number of recent donations to return (default: 10, max: 100)
 */
router.get('/recent', checkPermission(PERMISSIONS.DONATIONS_READ), recentDonationsQuerySchema, (req, res, next) => {
  try {
    const limitValidation = validateInteger(req.query.limit, {
      min: 1,
      max: 100,
      default: 10
    });

    if (!limitValidation.valid) {
      throw new ValidationError(
        `Invalid limit parameter: ${limitValidation.error}`,
        null,
        ERROR_CODES.INVALID_LIMIT
      );
    }

    const transactions = donationService.getRecentDonations(limitValidation.value);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: transactions,
      count: transactions.length,
      limit: limitValidation.value
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/:id/receipt
 * Generate and return a PDF receipt for a confirmed donation.
 */
router.get('/:id/receipt', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, async (req, res, next) => {
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
});

/**
 * POST /donations/:id/receipt/email
 * Send a PDF receipt to the provided email address.
 * Body: { email: string }
 */
router.post('/:id/receipt/email', requireApiKey, donationIdParamSchema, async (req, res, next) => {
  try {
    const ReceiptService = require('../services/ReceiptService');
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, error: { message: 'email is required' } });
    }

    const transaction = donationService.getDonationById(req.params.id);
    const result = await ReceiptService.sendEmail({ transaction, toEmail: email });

    res.json({ success: true, data: { messageId: result.messageId } });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ success: false, error: { message: error.message } });
    }
    next(error);
  }
});

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
router.get('/:id/memo/decrypt', requireApiKey, donationIdParamSchema, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { recipientSecret } = req.query;

    if (!recipientSecret) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'recipientSecret query parameter is required' }
      });
    }

    const transaction = Transaction.getById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: `Donation ${id} not found` }
      });
    }

    if (!transaction.memoEnvelope) {
      return res.status(422).json({
        success: false,
        error: { code: 'MEMO_NOT_ENCRYPTED', message: 'This donation does not have an encrypted memo' }
      });
    }

    const memoEncryption = require('../utils/memoEncryption');
    let plaintext;
    try {
      plaintext = memoEncryption.decryptMemo(transaction.memoEnvelope, recipientSecret);
    } catch (decErr) {
      return res.status(403).json({
        success: false,
        error: { code: 'DECRYPTION_FAILED', message: 'Unable to decrypt memo: invalid key or tampered data' }
      });
    }

    res.json({
      success: true,
      data: {
        donationId: id,
        memo: plaintext,
        algorithm: transaction.encryptionMetadata?.algorithm || 'ECDH-X25519-AES256GCM',
      }
    });
  } catch (error) {
    next(error);
  }
});

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

    res.json({
      success: true,
      data: applyNotePrivacy(req, transaction)
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', checkPermission(PERMISSIONS.DONATIONS_UPDATE), updateDonationStatusSchema, async (req, res, next) => {
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
});

/**
 * POST /donations/:id/refund
 * Initiate a refund for a confirmed donation
 * Requires admin or refund permission
 */
router.post('/:id/refund', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_UPDATE), donationIdParamSchema, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    log.debug('DONATION_ROUTE', 'Processing refund request', {
      requestId: req.id,
      donationId: id,
      reason
    });

    // Validate donation ID
    if (!id || isNaN(parseInt(id, 10))) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid donation ID'
        }
      });
    }

    // Process refund
    const refundResult = await donationService.refundDonation(id, {
      reason: reason || null,
      requestId: req.id
    });

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.status(201).json({
      success: true,
      data: refundResult
    });
  } catch (error) {
    log.error('DONATION_ROUTE', 'Failed to process refund', {
      requestId: req.id,
      error: error.message,
      stack: error.stack
    });

    next(error);
  }
});

// ─── Claimable Balance Endpoints ─────────────────────────────────────────────

const createClaimableSchema = validateSchema({
  body: {
    fields: {
      sourceSecret: { type: 'string', required: true },
      amount: { type: 'numberString', required: true, min: 0.0000001 },
      claimants: { type: 'array', required: true },
      predicate: { type: 'object', required: false, nullable: true },
    },
  },
});

/**
 * POST /donations/claimable
 * Create a claimable balance (XLM held until claimed by an eligible account).
 * Supports time-based predicates (notBefore / notAfter as Unix ms timestamps).
 */
router.post(
  '/claimable',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  createClaimableSchema,
  async (req, res, next) => {
    try {
      const { sourceSecret, amount, claimants, predicate } = req.body;

      if (!Array.isArray(claimants) || claimants.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'claimants must be a non-empty array' },
        });
      }

      const result = await stellarService.createClaimableBalance({
        sourceSecret,
        amount,
        claimants,
        predicate: predicate || null,
      });

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
  }
);

/**
 * POST /donations/claimable/:id/claim
 * Claim a claimable balance by its ID.
 */
router.post(
  '/claimable/:id/claim',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { claimantSecret } = req.body;

      if (!claimantSecret) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'claimantSecret is required' },
        });
      }

      const result = await stellarService.claimBalance({
        balanceId: id,
        claimantSecret,
      });

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
