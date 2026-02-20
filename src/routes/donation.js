const express = require('express');
const router = express.Router();
const StellarService = require('../services/StellarService');
const Transaction = require('./models/transaction');

const stellarService = new StellarService({
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org'
});

/**
 * POST /api/v1/donation/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', async (req, res) => {
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
    res.status(500).json({
      success: false,
      error: {
        code: 'VERIFICATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /donations
 * Create a new donation
 */
router.post('/', (req, res) => {
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

    const { amount, donor, recipient } = req.body;

    if (!amount || !recipient) {
      return res.status(400).json({
        error: 'Missing required fields: amount, recipient'
      });
    }

    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        error: 'Amount must be a positive number'
      });
    }

    const normalizedDonor = typeof donor === 'string' ? donor.trim() : '';
    const normalizedRecipient = typeof recipient === 'string' ? recipient.trim() : '';

    if (normalizedDonor && normalizedRecipient && normalizedDonor === normalizedRecipient) {
      return res.status(400).json({
        error: 'Sender and recipient wallets must be different'
      });
    }

    const transaction = Transaction.create({
      amount: parseFloat(amount),
      donor: donor || 'Anonymous',
      recipient,
      idempotencyKey
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

module.exports = router;
