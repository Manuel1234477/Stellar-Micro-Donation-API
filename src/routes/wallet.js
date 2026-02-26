/**
 * Wallet Routes
 * Thin controllers that orchestrate service calls
 * All business logic delegated to WalletService
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const WalletService = require('../services/WalletService');

const walletService = new WalletService();

/**
 * POST /wallets
 * Create a new wallet with metadata
 */
router.post('/', checkPermission(PERMISSIONS.WALLETS_CREATE), (req, res) => {
  try {
    const { address, label, ownerName } = req.body;
    const wallet = walletService.createWallet({ address, label, ownerName });

    res.status(201).json({
      success: true,
      data: wallet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets
 * Get all wallets
 */
router.get('/', checkPermission(PERMISSIONS.WALLETS_READ), (req, res) => {
  try {
    const wallets = walletService.getAllWallets();
    res.json({
      success: true,
      data: wallets,
      count: wallets.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id
 * Get a specific wallet
 */
router.get('/:id', checkPermission(PERMISSIONS.WALLETS_READ), (req, res) => {
  try {
    const wallet = walletService.getWalletById(req.params.id);

    res.json({
      success: true,
      data: wallet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id
 * Update wallet metadata
 */
router.patch('/:id', checkPermission(PERMISSIONS.WALLETS_UPDATE), (req, res) => {
  try {
    const { label, ownerName } = req.body;
    const wallet = walletService.updateWallet(req.params.id, { label, ownerName });

    res.json({
      success: true,
      data: wallet
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:publicKey/transactions
 * Get all transactions (sent and received) for a wallet
 */
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), async (req, res) => {
  try {
    const { publicKey } = req.params;
    const result = await walletService.getWalletTransactions(publicKey);

    res.json({
      success: true,
      data: result.transactions,
      count: result.count,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
