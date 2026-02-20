const express = require('express');
const router = express.Router();
const Transaction = require('./models/transaction');
const requireApiKey = require('../middleware/apiKeyMiddleware');

const stellarService = new StellarService({
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'
});
const donationValidator = require('../utils/donationValidator');
const memoValidator = require('../utils/memoValidator');
const { calculateAnalyticsFee } = require('../utils/feeCalculator');
const MockStellarService = require('../services/MockStellarService');

// Initialize Stellar service (using Mock for now)
const stellarService = new MockStellarService();

/**
 * POST /api/v1/donation/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', requireApiKey, async (req, res) => {
  try {
    const { transactionHash } = req.body;

    if (!transactionHash) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'Transaction hash is required'
        }
      });
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
 * POST /donations
 * Create a new donation
 */
router.post('/', requireApiKey, (req, res) => {
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
      return res.status(400).json({
        error: 'Missing required fields: amount, recipient'
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
      return res.status(400).json({
        error: 'Sender and recipient wallets must be different'
      });
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
    res.status(500).json({
      error: 'Failed to create donation',
      message: error.message
    });
  }
});

/**
 * GET /donations
 * Get all donations
 */
router.get('/', (req, res) => {
  try {
    const transactions = Transaction.getAll();
    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve donations',
      message: error.message
    });
  }
});

/**
 * GET /donations/limits
 * Get current donation amount limits
 */
router.get('/limits', (req, res) => {
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
router.get('/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

    if (isNaN(limit) || limit < 1) {
      return res.status(400).json({
        error: 'Invalid limit parameter. Must be a positive number.'
      });
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
    res.status(500).json({
      error: 'Failed to retrieve recent donations',
      message: error.message
    });
  }
});

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', (req, res) => {
  try {
    const transaction = Transaction.getById(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        error: 'Donation not found'
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve donation',
      message: error.message
    });
  }
});

/**
 * PATCH /donations/:id/status
 * Update donation transaction status
 */
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, stellarTxId, ledger } = req.body;

    if (!status) {
      return res.status(400).json({
        error: 'Missing required field: status'
      });
    }

    const validStatuses = ['pending', 'confirmed', 'failed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
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
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message
      });
    }
    res.status(500).json({
      error: 'Failed to update transaction status',
      message: error.message
    });
  }
});

module.exports = router;
