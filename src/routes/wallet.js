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
const Database = require('../utils/database');
const { getStellarService } = require('../config/stellar');
const log = require('../utils/log');
const { validateSchema } = require('../middleware/schemaValidation');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { validateDataEntry } = require('../middleware/validateDataEntry');
// eslint-disable-next-line no-unused-vars
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
router.post('/', checkPermission(PERMISSIONS.WALLETS_CREATE), walletCreateSchema, async (req, res) => {});
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
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), walletPublicKeySchema, async (req, res, next) => {
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
    // eslint-disable-next-line no-unused-vars
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
      data: transactions,
      count: transactions.length,
      data: formattedTransactions,
      count: formattedTransactions.length,
      count: formattedTransactions.length
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

/**
 * DELETE /wallets/:id
 * Soft delete a wallet by setting deleted_at timestamp
 */
router.delete('/:id', checkPermission(PERMISSIONS.WALLETS_DELETE), walletIdSchema, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if wallet exists and isn't already deleted
    const wallet = await Database.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found or already deleted', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // Perform Soft Delete
    await Database.run(
      'UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id]
    );

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.WALLET_DELETED,
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${id}`,
      details: { walletId: id, type: 'SOFT_DELETE' }
    });

    res.json({ success: true, message: 'Wallet soft-deleted successfully' });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/deleted
 * Admin only: View all soft-deleted wallets and transactions
 */
router.get('/admin/deleted', requireAdmin(), async (req, res, next) => {
  try {
    const deletedWallets = await Database.query('SELECT * FROM users WHERE deleted_at IS NULL');
    const deletedTransactions = await Database.query('SELECT * FROM transactions WHERE deleted_at IS NOT NULL');

    res.json({
      success: true,
      data: {
        wallets: deletedWallets,
        transactions: deletedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * UPDATED: GET /wallets/:publicKey/transactions
 * Now filters out soft-deleted transactions
 */
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), walletPublicKeySchema, async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    const user = await Database.get(
      'SELECT id FROM users WHERE publicKey = ? AND deleted_at IS NULL',
      [publicKey]
    );

    if (!user) {
      return res.json({ success: true, data: [], count: 0, message: 'No active user found' });
    }

    // Added "t.deleted_at IS NULL" to the WHERE clause
    const transactions = await Database.query(
      `SELECT t.*, sender.publicKey as senderPublicKey, receiver.publicKey as receiverPublicKey
       FROM transactions t
       LEFT JOIN users sender ON t.senderId = sender.id
       LEFT JOIN users receiver ON t.receiverId = receiver.id
       WHERE (t.senderId = ? OR t.receiverId = ?) AND t.deleted_at IS NULL
       ORDER BY t.timestamp DESC`,
      [user.id, user.id]
    );

    res.json({
      success: true,
      data: transactions,
      count: transactions.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /wallets/:id/data
 * Create or update a data entry on the wallet's Stellar account
 * Body: { secretKey, key, value }
 * 
 * SECURITY WARNING: Data entries are publicly readable on-chain.
 * Do not store PII, secrets, or sensitive information.
 */
router.post('/:id/data', 
  checkPermission(PERMISSIONS.WALLETS_UPDATE), 
  walletIdSchema,
  validateDataEntry,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { secretKey, key, value } = req.body;

      if (!secretKey) {
        throw new ValidationError(
          'Secret key is required to set data entries',
          null,
          ERROR_CODES.MISSING_REQUIRED_FIELD
        );
      }

      const result = await walletService.setAccountData(id, secretKey, key, value);

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: 'DATA_ENTRY_SET',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${id}/data`,
        details: { walletId: id, key, txHash: result.hash }
      });

      res.status(201).json({
        success: true,
        data: {
          hash: result.hash,
          ledger: result.ledger
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /wallets/:id/data
 * Fetch all current data entries for a wallet from the Stellar network
 */
router.get('/:id/data',
  checkPermission(PERMISSIONS.WALLETS_READ),
  walletIdSchema,
  async (req, res, next) => {
    try {
      const { id } = req.params;

      const result = await walletService.getAccountData(id);

      res.json({
        success: true,
        data: result.entries || {},
        count: Object.keys(result.entries || {}).length
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /wallets/:id/data/:key
 * Remove a specific data entry from the wallet's Stellar account
 * Body: { secretKey }
 * 
 * Deletion is done by setting the value to null in a manageData operation.
 */
router.delete('/:id/data/:key',
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  async (req, res, next) => {
    try {
      const { id, key } = req.params;
      const { secretKey } = req.body;

      // Validate wallet ID
      const walletId = parseInt(id, 10);
      if (isNaN(walletId) || walletId < 1) {
        throw new ValidationError('Invalid wallet ID', null, ERROR_CODES.INVALID_REQUEST);
      }

      if (!secretKey) {
        throw new ValidationError(
          'Secret key is required to delete data entries',
          null,
          ERROR_CODES.MISSING_REQUIRED_FIELD
        );
      }

      if (!key) {
        throw new ValidationError(
          'Data entry key is required',
          null,
          ERROR_CODES.MISSING_REQUIRED_FIELD
        );
      }

      const result = await walletService.deleteAccountData(walletId, secretKey, key);

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: 'DATA_ENTRY_DELETED',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${id}/data/${key}`,
        details: { walletId: id, key, txHash: result.hash }
      });

      res.json({
        success: true,
        data: {
          hash: result.hash,
          ledger: result.ledger
        }
      });
    } catch (error) {
      next(error);
    }
  }
);
 * POST /wallets/:id/merge
 * Merge a wallet into a destination account.
 *
 * Transfers all XLM from the source wallet to the destination, closes the
 * source account on the Stellar network, and soft-deletes the wallet record.
 *
 * @requires wallets:delete permission
 * @body {string}  destinationPublicKey - Stellar public key of the receiving account
 * @body {string}  sourceSecret         - Secret key of the wallet being merged
 * @body {boolean} confirm              - Must be exactly `true` to proceed
 */
router.post('/:id/merge', checkPermission(PERMISSIONS.WALLETS_DELETE), async (req, res, next) => {
  try {
    const { destinationPublicKey, sourceSecret, confirm } = req.body;

    // ── Confirmation gate ────────────────────────────────────────────────────
    if (confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Account merge requires explicit confirmation. Set confirm: true to proceed.',
      });
    }

    // ── Required fields ──────────────────────────────────────────────────────
    if (!destinationPublicKey || !sourceSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: destinationPublicKey, sourceSecret',
      });
    }

    // ── Lookup source wallet ─────────────────────────────────────────────────
    const sourceWallet = await Database.get(
      'SELECT id, publicKey, mergedAt FROM users WHERE id = ?',
      [req.params.id]
    );

    if (!sourceWallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (sourceWallet.mergedAt) {
      return res.status(409).json({
        success: false,
        error: 'Wallet has already been merged and closed',
      });
    }

    if (sourceWallet.publicKey === destinationPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Source and destination wallets cannot be the same',
      });
    }

    // ── Execute merge on Stellar ─────────────────────────────────────────────
    const stellarService = getStellarService();
    const mergeResult = await stellarService.mergeAccount(sourceSecret, destinationPublicKey);

    // ── Soft-delete source wallet ────────────────────────────────────────────
    const now = new Date().toISOString();
    await Database.run(
      'UPDATE users SET mergedAt = ?, mergedInto = ? WHERE id = ?',
      [now, destinationPublicKey, sourceWallet.id]
    );

    // ── Write audit log ──────────────────────────────────────────────────────
    await Database.run(
      `INSERT INTO wallet_merge_audit
         (sourceWalletId, sourcePublicKey, destinationPublicKey, mergedAmount,
          transactionHash, ledger, performedBy, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sourceWallet.id,
        sourceWallet.publicKey,
        destinationPublicKey,
        mergeResult.mergedAmount,
        mergeResult.hash,
        mergeResult.ledger,
        req.user ? req.user.id : 'unknown',
        now,
      ]
    );

    log.info('WALLET_ROUTE', 'Wallet merged', {
      sourceId: sourceWallet.id,
      sourcePublicKey: sourceWallet.publicKey,
      destinationPublicKey,
      hash: mergeResult.hash,
    });

    return res.json({
      success: true,
      message: 'Account merged successfully. Source account has been closed.',
      data: {
        sourceWalletId: sourceWallet.id,
        sourcePublicKey: sourceWallet.publicKey,
        destinationPublicKey,
        mergedAmount: mergeResult.mergedAmount,
        transactionHash: mergeResult.hash,
        ledger: mergeResult.ledger,
        mergedAt: now,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
