const express = require('express');
const router = express.Router();
const Wallet = require('./models/wallet');
const Transaction = require('./models/transaction');

/**
 * POST /wallets
 * Create a new wallet with metadata
 */
router.post('/', (req, res) => {
  try {
    const { address, label, ownerName } = req.body;

    if (!address) {
      return res.status(400).json({
        error: 'Missing required field: address'
      });
    }

    const existingWallet = Wallet.getByAddress(address);
    if (existingWallet) {
      return res.status(409).json({
        error: 'Wallet with this address already exists'
      });
    }

    const wallet = Wallet.create({ address, label, ownerName });

    res.status(201).json({
      success: true,
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to create wallet',
      message: error.message
    });
  }
});

/**
 * GET /wallets
 * Get all wallets
 */
router.get('/', (req, res) => {
  try {
    const wallets = Wallet.getAll();
    res.json({
      success: true,
      data: wallets,
      count: wallets.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve wallets',
      message: error.message
    });
  }
});

/**
 * GET /wallets/:id
 * Get a specific wallet
 */
router.get('/:id', (req, res) => {
  try {
    const wallet = Wallet.getById(req.params.id);
    
    if (!wallet) {
      return res.status(404).json({
        error: 'Wallet not found'
      });
    }

    res.json({
      success: true,
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve wallet',
      message: error.message
    });
  }
});

/**
 * PATCH /wallets/:id
 * Update wallet metadata
 */
router.patch('/:id', (req, res) => {
  try {
    const { label, ownerName } = req.body;

    if (!label && !ownerName) {
      return res.status(400).json({
        error: 'At least one field (label or ownerName) is required'
      });
    }

    const updates = {};
    if (label !== undefined) updates.label = label;
    if (ownerName !== undefined) updates.ownerName = ownerName;

    const wallet = Wallet.update(req.params.id, updates);
    
    if (!wallet) {
      return res.status(404).json({
        error: 'Wallet not found'
      });
    }

    res.json({
      success: true,
      data: wallet
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update wallet',
      message: error.message
    });
  }
});

/**
 * GET /wallets/:publicKey/transactions
 * Get all transactions (sent and received) for a wallet
 */
router.get('/:publicKey/transactions', (req, res) => {
  try {
    const { publicKey } = req.params;

    // Get all transactions
    const allTransactions = Transaction.getAll();

    // Filter transactions where publicKey is donor or recipient
    const walletTransactions = allTransactions.filter(tx => 
      tx.donor === publicKey || tx.recipient === publicKey
    );

    // Sort by timestamp descending (most recent first)
    walletTransactions.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    res.json({
      success: true,
      data: walletTransactions,
      count: walletTransactions.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve transactions',
      message: error.message
    });
  }
});

module.exports = router;
