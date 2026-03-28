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
const requireApiKey = require('../middleware/apiKey');
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const LimitService = require('../services/LimitService');
const Database = require('../utils/database');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const WalletService = require('../services/WalletService');
const { getStellarService } = require('../config/stellar');
const log = require('../utils/log');
const { cacheMiddleware } = require('../middleware/caching');
const { cacheMiddleware } = require('../middleware/caching');
const { validateSchema } = require('../middleware/schemaValidation');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const { validateDataEntry } = require('../middleware/validateDataEntry');
// eslint-disable-next-line no-unused-vars
const { sanitizeLabel, sanitizeName } = require('../utils/sanitizer');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { bulkImportRateLimiter } = require('../middleware/rateLimiter');
const BulkWalletImportService = require('../services/BulkWalletImportService');

const walletService = new WalletService(require('../config/serviceContainer').getStellarService());
const stellarService = require('../config/serviceContainer').getStellarService();
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
router.get('/', checkPermission(PERMISSIONS.WALLETS_READ), cacheMiddleware('wallet', 'private'), (req, res, next) => {
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
router.get('/:id', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, cacheMiddleware('wallet', 'private'), async (req, res, next) => {
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    const stellarSvc = getStellarService();
    const homeDomain = await stellarSvc.getHomeDomain(wallet.address || wallet.publicKey).catch(() => null);
    res.json({ success: true, data: { ...wallet, homeDomain: homeDomain || null } });
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
 * PATCH /wallets/:id/home-domain
 * Set the home domain on a wallet's Stellar account.
 * Body: { domain: string, sourceSecret: string }
 */
router.patch('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const { domain, sourceSecret } = req.body;

    if (!domain || !sourceSecret) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: domain, sourceSecret',
      });
    }

    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const stellarSvc = getStellarService();
    let result;
    try {
      result = await stellarSvc.setHomeDomain(sourceSecret, domain);
    } catch (err) {
      if (err && err.name === 'ValidationError') {
        return next(err);
      }
      return res.status(502).json({
        success: false,
        error: 'Stellar network error while setting home domain',
      });
    }

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.HOME_DOMAIN_UPDATED,
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/home-domain`,
      details: { walletId: req.params.id, homeDomain: domain, txHash: result.hash },
    });

    return res.json({
      success: true,
      data: { homeDomain: domain },
    });
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

/**
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

// ─── Trustline Endpoints ──────────────────────────────────────────────────────

/** Maximum trust limit allowed by the Stellar network */
const STELLAR_MAX_LIMIT = '922337203685.4775807';

/**
 * Validate a trust limit string.
 * @param {string} limit - Limit value to validate
 * @returns {string|null} Error message, or null if valid
 */
function validateTrustLimit(limit) {
  const num = parseFloat(limit);
  if (isNaN(num) || num <= 0) return 'limit must be a positive numeric string';
  if (num > parseFloat(STELLAR_MAX_LIMIT)) {
    return `limit cannot exceed Stellar maximum of ${STELLAR_MAX_LIMIT}`;
  }
  return null;
}

const trustlineCreateSchema = validateSchema({
  params: { fields: { id: { type: 'integerString', required: true } } },
  body: {
    fields: {
      secretKey:    { type: 'string', required: true },
      assetCode:    { type: 'string', required: true, trim: true, minLength: 1, maxLength: 12 },
      issuerPublic: { type: 'string', required: true, trim: true },
      limit:        { type: 'string', required: false, nullable: true },
    },
  },
});

const trustlineUpdateSchema = validateSchema({
  params: {
    fields: {
      id:    { type: 'integerString', required: true },
      asset: { type: 'string', required: true },
    },
  },
  body: {
    fields: {
      secretKey:    { type: 'string', required: true },
      issuerPublic: { type: 'string', required: true, trim: true },
      limit:        { type: 'string', required: true },
    },
  },
});

/**
 * POST /wallets/:id/trustlines
 * Create a trustline for a custom asset on the wallet's Stellar account.
 * Optionally set a custom trust limit.
 *
 * @body {string}      secretKey    - Secret key of the wallet account
 * @body {string}      assetCode    - Asset code (1-12 alphanumeric characters)
 * @body {string}      issuerPublic - Public key of the asset issuer
 * @body {string|null} [limit]      - Optional trust limit (positive numeric string,
 *   max "922337203685.4775807"). Omit for unlimited.
 */
router.post('/:id/trustlines', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineCreateSchema, async (req, res, next) => {
  try {
    const { secretKey, assetCode, issuerPublic, limit } = req.body;

    if (limit !== null && limit !== undefined) {
      const err = validateTrustLimit(limit);
      if (err) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: err } });
    }

    const stellar = getStellarService();
    const result = await stellar.addTrustline(secretKey, assetCode, issuerPublic, limit || null);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'TRUSTLINE_CREATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/trustlines`,
      details: { walletId: req.params.id, assetCode, issuerPublic, limit: result.limit, txHash: result.hash },
    });

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /wallets/:id/trustlines/:asset
 * Update the trust limit for an existing trustline without removing it.
 *
 * @param {string} asset         - Asset code in the URL path
 * @body {string} secretKey      - Secret key of the wallet account
 * @body {string} issuerPublic   - Public key of the asset issuer
 * @body {string} limit          - New trust limit (positive numeric string,
 *   max "922337203685.4775807")
 */
router.patch('/:id/trustlines/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineUpdateSchema, async (req, res, next) => {
  try {
    const { asset } = req.params;
    const { secretKey, issuerPublic, limit } = req.body;

    const err = validateTrustLimit(limit);
    if (err) return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: err } });

    const stellar = getStellarService();
    const result = await stellar.addTrustline(secretKey, asset, issuerPublic, limit);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'TRUSTLINE_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/trustlines/${asset}`,
      details: { walletId: req.params.id, assetCode: asset, issuerPublic, limit: result.limit, txHash: result.hash },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ─── Account Set Options ──────────────────────────────────────────────────────

const walletOptionsSchema = validateSchema({
  params: { fields: { id: { type: 'integerString', required: true } } },
  body: {
    fields: {
      secret:         { type: 'string', required: true },
      homeDomain:     { type: 'string', required: false, nullable: true, maxLength: 32 },
      inflationDest:  { type: 'string', required: false, nullable: true },
      masterWeight:   { type: 'integer', required: false, min: 0, max: 255 },
      lowThreshold:   { type: 'integer', required: false, min: 0, max: 255 },
      medThreshold:   { type: 'integer', required: false, min: 0, max: 255 },
      highThreshold:  { type: 'integer', required: false, min: 0, max: 255 },
      setFlags:       { type: 'integer', required: false, min: 0 },
      clearFlags:     { type: 'integer', required: false, min: 0 },
    },
  },
});

/**
 * PATCH /wallets/:id/options
 * Set Stellar account options for a custodial wallet.
 * Validates that AUTH_IMMUTABLE cannot be cleared.
 * Logs changes to the audit trail.
 */
router.patch('/:id/options', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletOptionsSchema, async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    const { secret, ...options } = req.body;

    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) throw new NotFoundError(`Wallet ${walletId} not found`);

    const stellar = getStellarService();
    const result = await stellar.setOptions(secret, options);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'WALLET_OPTIONS_SET',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/options`,
      details: { walletId, options: Object.keys(options), transactionHash: result.hash },
    });

    return res.json({ success: true, data: { walletId, transactionHash: result.hash, ledger: result.ledger } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
