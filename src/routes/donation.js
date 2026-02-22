const express = require('express');
const router = express.Router();
const Transaction = require('./models/transaction');
const {
  validateDonationCreate,
  validateTransactionVerify
} = require('../middleware/validation');

/**
 * POST /donations
 * Create a new donation
 */
router.post('/', validateDonationCreate, (req, res) => {
  try {
    const { amount, donor, recipient } = req.body;

    const transaction = Transaction.create({
      amount: parseFloat(amount),
      donor: donor || 'Anonymous',
      recipient
    });

    res.status(201).json({
      success: true,
      data: transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'DONATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * POST /donations/verify
 * Verify a donation transaction by hash
 */
router.post('/verify', validateTransactionVerify, async (req, res) => {
  try {
    const { transactionHash } = req.body;
    
    // TODO: Implement actual verification with Stellar service
    res.json({
      success: true,
      data: {
        verified: true,
        transactionHash
      }
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
      success: false,
      error: {
        code: 'RETRIEVAL_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /donations/:id
 * Get a specific donation
 */
router.get('/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_PARAMETER',
          message: 'Donation ID is required'
        }
      });
    }

    const transaction = Transaction.getById(id);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DONATION_NOT_FOUND',
          message: 'Donation not found'
        }
      });
    }

    res.json({
      success: true,
      data: transaction
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'RETRIEVAL_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;
