const express = require('express');
const router = express.Router();
const StellarService = require('../services/StellarService');

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

module.exports = router;
