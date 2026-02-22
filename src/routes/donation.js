const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const Transaction = require('./models/transaction');
const requireApiKey = require('../middleware/apiKeyMiddleware');
const { checkPermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/permissions');

const { getStellarService } = require('../config/stellar');
const donationValidator = require('../utils/donationValidator');
const memoValidator = require('../utils/memoValidator');
const { calculateAnalyticsFee } = require('../utils/feeCalculator');

const stellarService = getStellarService();

/**
 * POST /api/v1/donation/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', checkPermission(PERMISSIONS.DONATIONS_VERIFY), async (req, res) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      throw new ValidationError('Transaction hash is required', null, ERROR_CODES.INVALID_REQUEST);
    }

    const result = await stellarService.verifyTransaction(transactionHash);

    res.json({
      success: true,
      data: result
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
 */
router.post('/send', checkPermission(PERMISSIONS.DONATIONS_CREATE), async (req, res) => {
  try {
    const { senderId, receiverId, amount, memo } = req.body;

    // 1. Validation
    if (!senderId || !receiverId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: senderId, receiverId, amount'
      });
    }

    if (typeof senderId === 'object' || typeof receiverId === 'object') {
      return res.status(400).json({
        success: false,
        error: 'Malformed request: senderId and receiverId must be valid IDs'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // 2. Database Lookup
    const sender = await Database.get('SELECT * FROM users WHERE id = ?', [senderId]);
    const receiver = await Database.get('SELECT * FROM users WHERE id = ?', [receiverId]);

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

    const stellarResult = await stellarService.sendDonation({
      sourceSecret: secret,
      destinationPublic: receiver.publicKey,
      amount: amount,
      memo: memo
    });

    // 4. Record in SQLite
    const dbResult = await Database.run(
      'INSERT INTO transactions (senderId, receiverId, amount, memo, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [senderId, receiverId, amount, memo]
    );

    // 5. Record in JSON for stats backward compatibility
    Transaction.create({
      id: dbResult.id.toString(),
      amount: parseFloat(amount),
      donor: sender.publicKey,
      recipient: receiver.publicKey,
      stellarTxId: stellarResult.transactionId,
      status: 'completed'
    });

    res.status(201).json({
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
    });
  } catch (error) {
    console.error('Send donation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send donation',
      message: error.message
    });
  }
});

/**
 * POST /donations
 * Create a new donation
 */
router.post('/', checkPermission(PERMISSIONS.DONATIONS_CREATE), (req, res) => {
  try {
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Idempotency key is required'
        }
      });
    }

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

    const parsedAmount = parseFloat(amount);

    // Validate amount type and basic checks
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        error: 'Amount must be a positive number'
      });
    }

    // Validate amount against configured limits
    const amountValidation = donationValidator.validateAmount(parsedAmount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: amountValidation.code,
          message: amountValidation.error,
          limits: {
            min: amountValidation.minAmount,
            max: amountValidation.maxAmount,
          },
        },
      });
    }

    // Validate daily limit if donor is specified
    if (donor && donor !== 'Anonymous') {
      const dailyTotal = Transaction.getDailyTotalByDonor(donor);
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

    const normalizedDonor = typeof donor === 'string' ? donor.trim() : '';
    const normalizedRecipient = typeof recipient === 'string' ? recipient.trim() : '';

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      throw new ValidationError('Sender and recipient wallets must be different');
    }

    // Calculate analytics fee (not deducted on-chain)
    const donationAmount = parseFloat(amount);
    const feeCalculation = calculateAnalyticsFee(donationAmount);

    // Sanitize memo for storage
    const sanitizedMemo = memo ? memoValidator.sanitize(memo) : '';

    const transaction = Transaction.create({
      amount: parsedAmount,
      donor: donor || 'Anonymous',
      recipient,
      memo: sanitizedMemo,
      idempotencyKey,
      analyticsFee: feeCalculation.fee,
      analyticsFeePercentage: feeCalculation.feePercentage
    });

    res.status(201).json({
      success: true,
      data: transaction
    });
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
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    if (isNaN(limit) || limit < 1) {
      throw new ValidationError('Invalid limit parameter. Must be a positive number.', null, ERROR_CODES.INVALID_LIMIT);
    }

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

    const validStatuses = ['pending', 'confirmed', 'failed', 'cancelled'];
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
