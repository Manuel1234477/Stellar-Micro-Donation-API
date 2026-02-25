const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const Transaction = require('./models/transaction');
const requireApiKey = require('../middleware/apiKey');
const { requireIdempotency, storeIdempotencyResponse } = require('../middleware/idempotency');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const encryption = require('../utils/encryption');
const log = require('../utils/log');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { donationRateLimiter, verificationRateLimiter } = require('../middleware/rateLimiter');
const { validateRequiredFields, validateFloat, validateInteger } = require('../utils/validationHelpers');

const { getStellarService } = require('../config/stellar');
const donationValidator = require('../utils/donationValidator');
const memoValidator = require('../utils/memoValidator');
const { calculateAnalyticsFee } = require('../utils/feeCalculator');
const { sanitizeIdentifier } = require('../utils/sanitizer');

const stellarService = getStellarService();

/**
 * POST /donations/verify
 * Verify a donation transaction by hash
 * Rate limited: 30 requests per minute per IP
 */
router.post('/verify', verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_VERIFY), async (req, res) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      throw new ValidationError('Transaction hash is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    const verification = await stellarService.verifyTransaction(transactionHash);

    res.status(200).json({
      success: true,
      data: verification
    });
  } catch (error) {
    // Handle Stellar errors with proper status codes
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
      senderId,
      receiverId,
      amount,
      hasMemo: !!memo
    });

    // 1. Validation
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

    // 2. Database Lookup
    const sender = await Database.get('SELECT * FROM users WHERE id = ?', [senderId]);
    const receiver = await Database.get('SELECT * FROM users WHERE id = ?', [receiverId]);

    log.debug('DONATION_ROUTE', 'Database lookup complete', {
      senderFound: !!sender,
      receiverFound: !!receiver
    });

    if (!sender || !receiver) {
      return res.status(404).json({
        success: false,
        error: 'Sender or receiver not found'
      });
    }

    if (!sender.encryptedSecret) {
      return res.status(400).json({
        success: false,
        error: 'Sender has no secret key configured'
      });
    }

    // 3. Stellar Transaction using custodial secret
    const secret = encryption.decrypt(sender.encryptedSecret);

    log.debug('DONATION_ROUTE', 'Initiating Stellar transaction');

    const stellarResult = await stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: memo
    });

    log.debug('DONATION_ROUTE', 'Stellar transaction successful', {
      hash: stellarResult.hash
    });

    // 4. Record in SQLite
    const dbResult = await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [senderId, receiverId, amount, memo]
    );

    // 5. Record in JSON with explicit lifecycle transitions
    const transaction = Transaction.create({
      id: dbResult.id.toString(),
      amount: parseFloat(amount),
      donor: sender.publicKey,
      recipient: receiver.publicKey,
      status: TRANSACTION_STATES.PENDING
    });

    Transaction.updateStatus(transaction.id, TRANSACTION_STATES.SUBMITTED, {
      transactionId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
    });

    Transaction.updateStatus(transaction.id, TRANSACTION_STATES.CONFIRMED, {
      transactionId: stellarResult.transactionId,
      ledger: stellarResult.ledger,
      confirmedAt: new Date().toISOString(),
    });

    const response = {
      success: true,
      data: {
        id: dbResult.id,
        stellarTxId: stellarResult.transactionId,
        ledger: stellarResult.ledger,
        amount: amount,
        sender: sender.publicKey,
        receiver: receiver.publicKey,
        timestamp: new Date().toISOString()
      }
    };

    // Store idempotency response
    await storeIdempotencyResponse(req, response);

    res.status(201).json(response);
  } catch (error) {
    log.error('DONATION_ROUTE', 'Failed to send donation', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to send donation',
      message: error.message
    });
  }
});

/**
 * POST /donations/verify
 * Verify a donation transaction by hash
 */
router.post('/', donationRateLimiter, requireApiKey, requireIdempotency, async (req, res, next) => {
  try {

    const { amount, donor, recipient, memo } = req.body;

    if (!amount || !recipient) {
      throw new ValidationError('Missing required fields: amount, recipient', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    if (typeof recipient !== 'string' || (donor && typeof donor !== 'string')) {
      return res.status(400).json({
        error: 'Malformed request: donor and recipient must be strings'
      });
    }

    // Validate memo if provided
    if (memo !== undefined && memo !== null) {
      const memoValidation = memoValidator.validate(memo);
      if (!memoValidation.valid) {
        return res.status(400).json({
          success: false,
          error: {
            code: memoValidation.code,
            message: memoValidation.error,
            maxLength: memoValidation.maxLength,
            currentLength: memoValidation.currentLength
          }
        });
      }
    }

    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        error: `Invalid amount: ${amountValidation.error}`
      });
    }
    
    const parsedAmount = amountValidation.value;

    // Validate amount against configured limits
    const limitsValidation = donationValidator.validateAmount(parsedAmount);
    if (!limitsValidation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: limitsValidation.code,
          message: limitsValidation.error,
          limits: {
            min: limitsValidation.minAmount,
            max: amountValidation.maxAmount,
          },
        },
      });
    }

    // Sanitize user-provided identifiers
    const sanitizedDonor = donor ? sanitizeIdentifier(donor) : '';
    const sanitizedRecipient = sanitizeIdentifier(recipient);

    // Validate daily limit if donor is specified
    if (sanitizedDonor && sanitizedDonor !== 'Anonymous') {
      const dailyTotal = Transaction.getDailyTotalByDonor(sanitizedDonor);
      const dailyValidation = donationValidator.validateDailyLimit(parsedAmount, dailyTotal);

      if (!dailyValidation.valid) {
        return res.status(400).json({
          success: false,
          error: {
            code: dailyValidation.code,
            message: dailyValidation.error,
            dailyLimit: dailyValidation.maxDailyAmount,
            currentDailyTotal: dailyValidation.currentDailyTotal,
            remainingDaily: dailyValidation.remainingDaily,
          },
        });
      }
    }

    if (sanitizedDonor && sanitizedRecipient && sanitizedDonor === sanitizedRecipient) {
      throw new ValidationError('Sender and recipient wallets must be different');
    }

    // Calculate analytics fee (not deducted on-chain)
    const donationAmount = parseFloat(amount);
    const feeCalculation = calculateAnalyticsFee(donationAmount);

    // Sanitize memo for storage
    const sanitizedMemo = memo ? memoValidator.sanitize(memo) : '';

    const transaction = Transaction.create({
      amount: parsedAmount,
      donor: sanitizedDonor || 'Anonymous',
      recipient: sanitizedRecipient,
      memo: sanitizedMemo,
      idempotencyKey: req.idempotency.key,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage
    });

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
    const transactions = Transaction.getAll();
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
    const limits = donationValidator.getLimits();
    res.json({
      success: true,
      data: {
        minAmount: limits.minAmount,
        maxAmount: limits.maxAmount,
        maxDailyPerDonor: limits.maxDailyPerDonor,
        currency: 'XLM',
      },
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve limits',
      message: error.message
    });
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

    const limit = limitValidation.value;

    const transactions = Transaction.getAll();

    // Sort by timestamp descending (most recent first)
    const sortedTransactions = transactions
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);

    // Remove sensitive data: stellarTxId is not exposed
    const sanitizedTransactions = sortedTransactions.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donor: tx.donor,
      recipient: tx.recipient,
      timestamp: tx.timestamp,
      status: tx.status
    }));

    res.json({
      success: true,
      data: sanitizedTransactions,
      count: sanitizedTransactions.length,
      limit: limit
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
    const transaction = Transaction.getById(req.params.id);

    if (!transaction) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
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

    const validStatuses = Object.values(TRANSACTION_STATES);
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const stellarData = {};
    if (stellarTxId) stellarData.transactionId = stellarTxId;
    if (ledger) stellarData.ledger = ledger;
    if (status === 'confirmed') stellarData.confirmedAt = new Date().toISOString();

    const updatedTransaction = Transaction.updateStatus(id, status, stellarData);

    res.json({
      success: true,
      data: updatedTransaction
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
