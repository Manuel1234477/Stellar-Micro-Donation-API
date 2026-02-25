const express = require('express');
const router = express.Router();
const Wallet = require('./models/wallet');
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { sanitizeLabel, sanitizeName } = require('../utils/sanitizer');

/**
 * POST /wallets
 * Create a new wallet with metadata
 */
router.post('/', checkPermission(PERMISSIONS.WALLETS_CREATE), (req, res) => {
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

    // Sanitize user-provided metadata
    const sanitizedLabel = label ? sanitizeLabel(label) : null;
    const sanitizedOwnerName = ownerName ? sanitizeName(ownerName) : null;

    const wallet = Wallet.create({ 
      address, 
      label: sanitizedLabel, 
      ownerName: sanitizedOwnerName 
    });

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
router.get('/', checkPermission(PERMISSIONS.WALLETS_READ), (req, res) => {
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
router.get('/:id', checkPermission(PERMISSIONS.WALLETS_READ), (req, res) => {
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
router.patch('/:id', checkPermission(PERMISSIONS.WALLETS_UPDATE), (req, res) => {
  try {
    const { label, ownerName } = req.body;

    if (!label && !ownerName) {
      return res.status(400).json({
        error: 'At least one field (label or ownerName) is required'
      });
    }

    // Sanitize user-provided metadata
    const updates = {};
    if (label !== undefined) updates.label = sanitizeLabel(label);
    if (ownerName !== undefined) updates.ownerName = sanitizeName(ownerName);

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
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), async (req, res) => {
  try {
    const { publicKey } = req.params;

    // First, check if user exists with this publicKey
    const user = await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [publicKey]
    );

    if (!user) {
      // Return empty array if wallet doesn't exist (as per acceptance criteria)
      return res.json({
        success: true,
        data: [],
        count: 0,
        message: 'No user found with this public key'
      });
    }

    // Get all transactions where user is sender or receiver
    const transactions = await Database.query(
      `SELECT 
        t.id,
        t.senderId,
        t.receiverId,
        t.amount,
        t.memo,
        t.timestamp,
        sender.publicKey as senderPublicKey,
        receiver.publicKey as receiverPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE t.senderId = ? OR t.receiverId = ?
      ORDER BY t.timestamp DESC`,
      [user.id, user.id]
    );

    // Format the response
    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      sender: tx.senderPublicKey,
      receiver: tx.receiverPublicKey,
      amount: tx.amount,
      memo: tx.memo,
      timestamp: tx.timestamp
    }));

    res.json({
      success: true,
      data: formattedTransactions,
      count: formattedTransactions.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve transactions',
      message: error.message
    });
  }
});

module.exports = router;
