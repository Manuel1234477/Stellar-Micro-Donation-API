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
const { donationRateLimiter, verificationRateLimiter } = require('../middleware/rateLimiter');
const { validateRequiredFields, validateFloat, validateInteger } = require('../utils/validationHelpers');

const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const { LIFECYCLE_STAGES } = require('../middleware/requestLifecycle');

const stellarService = getStellarService();
const donationService = new DonationService(stellarService);

/**
 * POST /donations/verify
 * Verify a donation transaction by hash
 * Rate limited: 30 requests per minute per IP
 */
router.post('/verify', verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_VERIFY), async (req, res) => {
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
    const status = error.status || 500;
    const code = error.code || 'VERIFICATION_FAILED';
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
router.post('/send', donationRateLimiter, requireIdempotency, async (req, res) => {
  try {
    const { senderId, receiverId, amount, memo } = req.body;

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
      idempotencyKey: req.idempotency.key,
      requestId: req.id
    });

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

    res.status(500).json({
      success: false,
      error: 'Failed to send donation',
      message: error.message
    });
  }
});

/**
 * POST /donations
 * Create a non-custodial donation record
 */
router.post('/', donationRateLimiter, requireApiKey, requireIdempotency, async (req, res, next) => {
  try {
    const { amount, donor, recipient, memo } = req.body;

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

    const parsedAmount = amountValidation.value;

    // Delegate to service
    const transaction = await donationService.createDonationRecord({
      amount: amountValidation.value,
      donor,
      recipient,
      memo,
      idempotencyKey: req.idempotency.key
    });

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    const response = {
      success: true,
      data: {
        verified: true,
        transactionHash: transaction.stellarTxId || transaction.id
      }
    };

    await storeIdempotencyResponse(req, response);
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations
 * Get all donations
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const transactions = donationService.getAllDonations();
    
    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }
    
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /donations/limits
 * Get current donation amount limits
 */
router.get('/limits', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res) => {
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
router.get('/recent', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
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
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const transaction = donationService.getDonationById(req.params.id);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', checkPermission(PERMISSIONS.DONATIONS_UPDATE), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger } = req.body;

    if (!status) {
      throw new ValidationError('Missing required field: status', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;

    const updatedTransaction = donationService.updateDonationStatus(id, status, stellarData);

    // Mark processing complete
    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({
      success: true,
      data: updatedTransaction
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
