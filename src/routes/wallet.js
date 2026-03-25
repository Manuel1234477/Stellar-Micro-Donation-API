/**
 * Wallet Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for wallet operations
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, middleware (auth, RBAC)
 * 
 * Thin controllers that orchestrate service calls for wallet creation, updates,
 * and transaction history queries. All business logic delegated to WalletService.
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const LimitService = require('../services/LimitService');
const Database = require('../utils/database');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const WalletService = require('../services/WalletService');
const { validateSchema } = require('../middleware/schemaValidation');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { sanitizeLabel, sanitizeName } = require('../utils/sanitizer');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

const walletService = new WalletService(require('../config/serviceContainer').getStellarService());
const AuditLogService = require('../services/AuditLogService');
const walletCreateSchema = validateSchema({
  body: {
    fields: {
      address: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
      },
      label: { type: 'string', required: false, maxLength: 255, nullable: true },
      ownerName: { type: 'string', required: false, maxLength: 255, nullable: true },
      sponsored: { type: 'boolean', required: false, nullable: true },
    },
  },
});

const walletIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
    },
  },
});

const walletUpdateSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
    },
  },
  body: {
    fields: {
      label: { type: 'string', required: false, maxLength: 255, nullable: true },
      ownerName: { type: 'string', required: false, maxLength: 255, nullable: true },
    },
    validate: (body) => {
      const hasLabel = Object.prototype.hasOwnProperty.call(body, 'label');
      const hasOwnerName = Object.prototype.hasOwnProperty.call(body, 'ownerName');
      return hasLabel || hasOwnerName
        ? null
        : 'At least one field (label or ownerName) is required';
    },
  },
});

const walletPublicKeySchema = validateSchema({
  params: {
    fields: {
      publicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
      },
    },
  },
});

/**
 * POST /wallets
 * Create a new wallet with metadata. Auto-funds via Friendbot on testnet.
 */
router.post('/', checkPermission(PERMISSIONS.WALLETS_CREATE), walletCreateSchema, async (req, res) => {
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.wallet), checkPermission(PERMISSIONS.WALLETS_CREATE), walletCreateSchema, async (req, res, next) => {
  try {
    const { address, label, ownerName, sponsored } = req.body;

    const wallet = await walletService.createWallet({ address, label, ownerName, sponsored: !!sponsored });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.WALLET_CREATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${wallet.id}`,
      details: { address, funded: wallet.funded }
    });

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
router.get('/', checkPermission(PERMISSIONS.WALLETS_READ), (req, res, next) => {
  try {
    const pagination = parseCursorPaginationQuery(req.query);
    const result = walletService.getPaginatedWallets(pagination);

    res.setHeader('X-Total-Count', String(result.totalCount));

    res.json({
      success: true,
      data: result.data,
      count: result.data.length,
      meta: result.meta
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id/balance
 * Get wallet balance natively bypassing horizon load via TTL
 */
router.get('/:id/balance', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const result = await walletService.getBalance(req.params.id, forceRefresh);
    
    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');
    
    res.json({
      success: true,
      data: {
        balance: result.balance,
        asset: result.asset
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id
 * Get a specific wallet
 */
router.get('/:id', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
  try {
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    res.json({ success: true, data: wallet });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id
 * Update wallet metadata
 */
router.patch('/:id', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletUpdateSchema, async (req, res, next) => {
  try {
    const { label, ownerName } = req.body;

    if (!label && !ownerName) {
      return res.status(400).json({
        error: 'At least one field (label or ownerName) is required'
      });
    }

    const wallet = await walletService.updateWallet(req.params.id, { label, ownerName });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.WALLET_UPDATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}`,
      details: { walletId: req.params.id, updates: { label, ownerName } }
    });

    res.json({ success: true, data: wallet });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:publicKey/transactions
 * Get all transactions (sent and received) for a wallet
 */
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), walletPublicKeySchema, async (req, res) => {
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
      data: result.transactions,
      count: result.count,
      message: result.message
    });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id/limits
 * Set per-wallet donation limits (admin only)
 * Body: { daily_limit, monthly_limit, per_transaction_limit } — all optional, positive number or null
 */
router.patch('/:id/limits', requireAdmin(), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId) || userId < 1) {
      throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
    }

    const user = await Database.get('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const { daily_limit, monthly_limit, per_transaction_limit } = req.body;
    const limits = {};

    for (const [key, val] of Object.entries({ daily_limit, monthly_limit, per_transaction_limit })) {
      if (val === undefined) continue;
      if (val !== null && (typeof val !== 'number' || val <= 0 || !isFinite(val))) {
        throw new ValidationError(
          `${key} must be a positive number or null`,
          null,
          ERROR_CODES.INVALID_AMOUNT
        );
      }
      limits[key] = val;
    }

    if (Object.keys(limits).length === 0) {
      throw new ValidationError(
        'At least one limit field (daily_limit, monthly_limit, per_transaction_limit) is required',
        null,
        ERROR_CODES.MISSING_REQUIRED_FIELD
      );
    }

    await LimitService.setWalletLimits(userId, limits);

    const updated = await Database.get(
      'SELECT id, publicKey, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
      [userId]
    );

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.WALLET_UPDATED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${userId}/limits`,
      details: { walletId: userId, limits, updatedBy: req.user && req.user.id }
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /wallets/:id/revoke-sponsorship
 * Revoke platform sponsorship for a wallet.
 * Requires SPONSOR_SECRET to be configured in environment.
 */
router.post('/:id/revoke-sponsorship', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const result = await walletService.revokeSponsoredAccount(req.params.id);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'SPONSORSHIP_REVOKED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/revoke-sponsorship`,
      details: { walletId: req.params.id }
    });

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
