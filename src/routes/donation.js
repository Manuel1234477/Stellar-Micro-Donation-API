const express = require('express');
const router = express.Router();
const Transaction = require('./models/transaction');
const donationEvents = require('../events/donationEvents');
const {
  validateDonationCreate,
  validateTransactionVerify
} = require('../middleware/validation');
const rateLimiter = require('../middleware/rateLimiter');

// Apply rate limiting to all donation routes
router.use(rateLimiter());

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
    
    // Emit donation.submitted event
    donationEvents.emitLifecycleEvent(
      donationEvents.constructor.EVENTS.SUBMITTED,
      {
        eventType: 'donation.submitted',
        timestamp: new Date().toISOString(),
        transactionHash,
        transactionId: transactionHash // Using hash as ID for now
      }
    );
    
    // TODO: Implement actual verification with Stellar service
    const verified = true; // Placeholder
    
    if (verified) {
      // Emit donation.confirmed event on success
      donationEvents.emitLifecycleEvent(
        donationEvents.constructor.EVENTS.CONFIRMED,
        {
          eventType: 'donation.confirmed',
          timestamp: new Date().toISOString(),
          transactionHash,
          transactionId: transactionHash,
          verified: true,
          verificationDetails: {}
        }
      );
      
      res.json({
        success: true,
        data: {
          verified: true,
          transactionHash
        }
      });
    } else {
      // Emit donation.failed event on verification failure
      donationEvents.emitLifecycleEvent(
        donationEvents.constructor.EVENTS.FAILED,
        {
          eventType: 'donation.failed',
          timestamp: new Date().toISOString(),
          errorCode: 'VERIFICATION_FAILED',
          errorMessage: 'Transaction verification failed',
          context: {
            transactionHash,
            transactionId: transactionHash,
            stage: 'verification'
          }
        }
      );
      
      res.status(400).json({
        success: false,
        error: {
          code: 'VERIFICATION_FAILED',
          message: 'Transaction verification failed'
        }
      });
    }
  } catch (error) {
    // Emit donation.failed event on error
    donationEvents.emitLifecycleEvent(
      donationEvents.constructor.EVENTS.FAILED,
      {
        eventType: 'donation.failed',
        timestamp: new Date().toISOString(),
        errorCode: 'VERIFICATION_ERROR',
        errorMessage: error.message,
        context: {
          transactionHash: req.body.transactionHash,
          stage: 'verification'
        }
      }
    );
    
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
