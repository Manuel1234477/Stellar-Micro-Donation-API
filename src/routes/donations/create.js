/**
 * Donations Sub-Router — Create Operations
 *
 * Handles all donation creation endpoints:
 *   POST /donations/send          — custodial (senderId/receiverId)
 *   POST /donations/              — non-custodial or custodial unified
 *   POST /donations/batch         — simple batch (array body)
 *   POST /donations/batch         — RBAC-guarded batch (authenticated)
 *   POST /donations/bulk          — concurrent bulk with per-item idempotency
 *   POST /donations/cross-asset   — DEX path payment donation
 *   POST /donations/claimable     — create claimable balance
 *   POST /donations/claimable/:id/claim — claim a claimable balance
 */

'use strict';

const express = require('express');
const router = express.Router();

const requireApiKey = require('../../middleware/apiKey');
const { requireIdempotency, storeIdempotencyResponse } = require('../../middleware/idempotency');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { ValidationError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');
const { donationRateLimiter, batchRateLimiter } = require('../../middleware/rateLimiter');
const perKeyRateLimit = require('../../middleware/perKeyRateLimit');
const { validateFloat, validateXLMAmount, validateInteger } = require('../../utils/validationHelpers');
const { validateRequiredFields } = require('../../utils/validationHelpers');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const { parseAssetInput } = require('../../utils/stellarAsset');
const federation = require('../../utils/federation');
const asyncHandler = require('../../utils/asyncHandler');
const { getStellarService } = require('../../config/stellar');
const DonationService = require('../../services/DonationService');
const LimitService = require('../../services/LimitService');
const Transaction = require('../../models/transaction');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');

const {
  sendDonationSchema,
  createDonationSchema,
  crossAssetSchema,
  crossAssetPathsSchema,
  createClaimableSchema,
  withDonorLock,
  formatBatchDonationError,
  formatBatchDonationSuccess,
  LIFECYCLE_STAGES,
} = require('./helpers');

const donationService = new DonationService(getStellarService());
const stellarService = getStellarService();

// ─── POST /donations/send ─────────────────────────────────────────────────────

/**
 * POST /donations/send
 * Send XLM from one wallet to another and record it.
 * Requires idempotency key to prevent duplicate transactions.
 * Rate limited: 10 requests per minute per IP.
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

    const amountValidation = validateXLMAmount(amount);
    if (!amountValidation.valid) {
      return res.status(422).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`
      });
    }

    // Guard: reject donations to expired campaigns
    if (campaign_id) {
      const Database = require('../../utils/database');
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

    const result = await donationService.sendCustodialDonation({
      senderId,
      receiverId,
      amount: amountValidation.xlm,
      memo,
      campaign_id,
      idempotencyKey: req.idempotency.key,
      requestId: req.id,
      apiKeyId: req.apiKey ? req.apiKey.id : null,
      apiKeyRole: req.apiKey ? req.apiKey.role : (req.user?.role || 'user')
    });

    if (result.remainingLimits) {
      const { dailyRemaining, monthlyRemaining } = result.remainingLimits;
      if (dailyRemaining !== null) res.setHeader('X-Donation-Daily-Remaining', dailyRemaining);
      if (monthlyRemaining !== null) res.setHeader('X-Donation-Monthly-Remaining', monthlyRemaining);
    }

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

    if (error.name === 'DuplicateError') {
      return res.status(409).json({
        success: false,
        error: { code: error.code, message: error.message }
      });
    }

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

// ─── Custodial donation helper (used by POST /) ───────────────────────────────

async function processCustodialDonation(req, res, next) {
  try {
    const { senderId, receiverId, amount, memo } = req.body;

    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderId, receiverId, amount'
      });
    }

    const amountValidation = validateXLMAmount(amount);
    if (!amountValidation.valid) {
      return res.status(422).json({ success: false, error: `Invalid amount: ${amountValidation.error}` });
    }

    if (memo !== undefined && memo !== null && memo !== '') {
      const MemoValidator = require('../../utils/memoValidator');
      const memoValidation = MemoValidator.validate(memo);
      if (!memoValidation.valid) {
        return res.status(400).json({ success: false, error: 'Memo text must be 28 bytes or less' });
      }
    }

    const config = require('../../config');
    const globalDailyMax = config.donations.maxDailyPerDonor;

    let dailyLimit = null;
    let dailyUsed = 0;
    if (globalDailyMax > 0) {
      dailyUsed = await LimitService.getDailyTotal(senderId);
      dailyLimit = globalDailyMax;
    }

    const resetsAt = new Date();
    resetsAt.setUTCHours(24, 0, 0, 0);
    if (dailyLimit !== null) {
      res.set('X-RateLimit-Limit', String(dailyLimit));
      res.set('X-RateLimit-Remaining', String(Math.max(0, dailyLimit - dailyUsed)));
      res.set('X-RateLimit-Reset', String(Math.floor(resetsAt.getTime() / 1000)));
    }

    if (globalDailyMax > 0) {
      try {
        await withDonorLock(String(senderId), () =>
          LimitService.checkLimits(senderId, amountValidation.xlm)
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
      amount: amountValidation.xlm,
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
}

// ─── POST /donations/ ─────────────────────────────────────────────────────────

/**
 * POST /donations
 * Create a non-custodial donation record, or route to the custodial flow when
 * both senderId and receiverId are present.
 * Requires Idempotency-Key header (UUID v4) to prevent duplicate donations.
 */
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, perKeyRateLimit, requireApiKey, requireIdempotency, createDonationSchema, async (req, res, next) => {
  try {
    if (req.body.senderId != null && req.body.receiverId != null) {
      return await processCustodialDonation(req, res, next);
    }

    const { amount, currency, donor, recipient, memo, memoType, notes, tags, encryptMemo, anonymous, sourceAsset, sourceAmount } = req.body;

    if (!amount || !recipient) {
      throw new ValidationError('Missing required fields: amount, recipient', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    if (typeof recipient !== 'string' || (donor && typeof donor !== 'string')) {
      return res.status(400).json({
        error: 'Malformed request: donor and recipient must be strings'
      });
    }

    const amountValidation = validateXLMAmount(amount);
    if (!amountValidation.valid) {
      return res.status(422).json({
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

    if (memo || memoType) {
      const memoValidator = require('../../utils/memoValidator');
      const memoValidation = memoValidator.validateWithType(memo || '', memoType || 'text');
      if (!memoValidation.valid) {
        return res.status(400).json({
          success: false,
          error: { code: memoValidation.code, message: memoValidation.error }
        });
      }
    }

    let resolvedRecipient = recipient;
    if (federation.isFederationAddress(recipient)) {
      resolvedRecipient = await federation.resolveRecipient(recipient);
    }

    let memoEnvelope = null;
    let encryptionMetadata = null;
    if (encryptMemo && memo) {
      try {
        const memoEncryption = require('../../utils/memoEncryption');
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

    const transaction = await donationService.createDonationRecord({
      amount: amountValidation.xlm,
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

    let feeEstimate = null;
    try {
      feeEstimate = await stellarService.estimateFee(1);
    } catch (_err) {
      // Fee estimation is best-effort; don't fail the request
    }

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

// ─── POST /donations/batch (simple, no RBAC) ──────────────────────────────────

/**
 * POST /donations/batch
 * Create up to 100 donations in a single request.
 * Rate limited: 1 batch request per minute per IP.
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

// ─── POST /donations/batch (RBAC-guarded authenticated batch) ─────────────────

/**
 * POST /donations/batch (authenticated, RBAC-guarded)
 * Full per-item validation with 207 Multi-Status response.
 * Requires donations:create permission.
 */
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
        const MemoValidator = require('../../utils/memoValidator');
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
          amount: amountValidation.xlm,
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

    return res.status(207).json({ success: true, results });
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/bulk ─────────────────────────────────────────────────────

/**
 * POST /donations/bulk
 * Concurrent bulk donation creation with per-item idempotency.
 * Up to 50 items; concurrency controlled by BULK_DONATION_CONCURRENCY env var.
 * Requires donations:create permission.
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
    const IdempotencyService = require('../../services/IdempotencyService');
    const idempotencySvc = new IdempotencyService();

    const results = new Array(donations.length);

    const processItem = async (index) => {
      const item = donations[index];

      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        results[index] = { index, status: 'failed', error: { code: 'INVALID_ITEM', message: 'Each item must be an object' } };
        return;
      }

      const itemKey = item.idempotencyKey;
      if (itemKey) {
        try {
          const cached = await idempotencySvc.get(itemKey);
          if (cached) {
            results[index] = { index, status: 'success', ...cached.response };
            return;
          }
        } catch (_) { /* best-effort */ }
      }

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
    };

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

// ─── POST /donations/cross-asset ──────────────────────────────────────────────

/**
 * POST /donations/cross-asset
 * Execute a cross-asset donation via Stellar DEX path payment.
 * The transaction must be built and signed client-side (pre-signed XDR).
 */
router.post('/cross-asset', payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), donationRateLimiter, requireApiKey, requireIdempotency, crossAssetSchema, asyncHandler(async (req, res, next) => {
  try {
    const { signedXDR, destPublicKey } = req.body;

    if (!signedXDR || !destPublicKey) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_REQUIRED_FIELDS', receivedValue: null }])
      );
    }

    const result = await stellarService.submitSignedTransaction(signedXDR);

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

// ─── POST /donations/claimable ────────────────────────────────────────────────

/**
 * POST /donations/claimable
 * Create a claimable balance (XLM held until claimed by an eligible account).
 */
router.post(
  '/claimable',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  createClaimableSchema,
  asyncHandler(async (req, res, next) => {
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
        predicate,
      });

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

// ─── POST /donations/claimable/:id/claim ──────────────────────────────────────

/**
 * POST /donations/claimable/:id/claim
 * Claim a claimable balance by its ID.
 */
router.post(
  '/claimable/:id/claim',
  requireApiKey,
  donationRateLimiter,
  checkPermission(PERMISSIONS.DONATIONS_CREATE),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { claimantSecret } = req.body;

      if (!claimantSecret) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'claimantSecret is required' },
        });
      }

      const result = await stellarService.claimBalance({ balanceId: id, claimantSecret });

      if (req.markLifecycleStage) req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);

      return res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
