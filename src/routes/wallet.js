const express = require('express');
const router = express.Router();
const User = require('./models/user');
const {
  validateWalletCreate,
  validateWalletId,
  validatePublicKey
} = require('../middleware/validation');

/**
 * POST /wallets
 * Create a new wallet registration
 */
router.post('/', validateWalletCreate, (req, res) => {
  try {
    const { name, walletAddress } = req.body;

    const user = User.create({
      name,
      walletAddress
    });

    res.status(201).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'WALLET_CREATION_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /wallets
 * Get all registered wallets
 */
router.get('/', (req, res) => {
  try {
    const users = User.getAll();
    res.json({
      success: true,
      data: users,
      count: users.length
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
 * GET /wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', validateWalletId, (req, res) => {
  try {
    const user = User.getById(req.params.id);
    
    res.json({
      success: true,
      data: user
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
 * POST /wallets/lookup
 * Look up a wallet by Stellar address
 */
router.post('/lookup', validatePublicKey('walletAddress'), (req, res) => {
  try {
    const { walletAddress } = req.body;
    const user = User.getByWallet(walletAddress);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: 'No wallet registered with this address'
        }
      });
    }

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'LOOKUP_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;
