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
const { NotFoundError, ValidationError, ERROR_CODES } = require('../utils/errors');
const LimitService = require('../services/LimitService');
const Database = require('../utils/database');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');
const { validateSchema } = require('../middleware/schemaValidation');
const { cacheMiddleware } = require('../middleware/caching');
const { validateDataEntry } = require('../middleware/validateDataEntry');
const { toWalletResponse } = require('../utils/responseSanitizer');
const Wallet = require('./models/wallet');
const { STROOPS_PER_XLM } = require('../constants');
const WalletService = require('../services/WalletService');
const AuditLogService = require('../services/AuditLogService');
const log = require('../utils/log');
const { parseCursorPaginationQuery } = require('../utils/pagination');

const walletService = new WalletService();

const { getStellarService } = require('../config/stellar');

const requireAuth = requireAdmin;
const requirePermission = (perm) => checkPermission(perm);

const walletIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

const walletPublicKeySchema = validateSchema({
  params: {
    fields: {
      publicKey: { type: 'string', required: true, trim: true, minLength: 1 }
    }
  }
});

const { isValidStellarPublicKey } = require('../utils/validators');

const walletCreateSchema = validateSchema({
  body: {
    fields: {
      address: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        validate: (value) => isValidStellarPublicKey(value)
          ? true
          : 'address must be a valid Stellar public key (56-character Ed25519 public key starting with G)',
      },
      label: { type: 'string', required: false, nullable: true },
      ownerName: { type: 'string', required: false, nullable: true },
      sponsored: { type: 'boolean', required: false, nullable: true }
    }
  }
});

// Inflation destination schema for PATCH
const inflationDestinationSchema = {
  type: 'object',
  required: ['destination', 'signedXDR'],
  properties: {
    destination: { type: 'string' },
    signedXDR: { type: 'string' }
  }
};

// PATCH /wallets/:id/inflation-destination
router.patch(
  '/:id/inflation-destination',
  requireAuth,
  requirePermission('wallets:write'),
  validateSchema(inflationDestinationSchema),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { destination, signedXDR } = req.body;
      const wallet = await walletService.getWalletById(id);
      if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
      const stellarService = getStellarService();
      const result = await stellarService.submitSignedTransaction(signedXDR);
      res.status(200).json({ success: true, inflationDestination: destination, transactionHash: result.hash });
    } catch (err) {
      next(err);
    }
  })
);

// GET /wallets/:id/inflation-destination
router.get(
  '/:id/inflation-destination',
  requireAuth,
  requirePermission('wallets:read'),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const wallet = await walletService.getWalletById(id);
      if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
      const stellarService = getStellarService();
      const inflationDestination = await stellarService.getInflationDestination(wallet.address);
      res.status(200).json({ inflationDestination });
    } catch (err) {
      next(err);
    }
  })
);
/**
 * PUT /wallets/:id/inflation-destination
 * Set the inflation destination for a wallet's Stellar account.
 * Body: { destinationPublicKey: string, signedXDR: string }
 * Requires wallets:write permission.
 */
router.put('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const { destinationPublicKey, signedXDR } = req.body;
    if (!destinationPublicKey || !signedXDR) {
      return res.status(400).json({ success: false, error: 'Missing required fields: destinationPublicKey, signedXDR' });
    }
    // Validate destination public key format (G...)
    if (!/^G[A-Z2-7]{55}$/.test(destinationPublicKey)) {
      return res.status(400).json({ success: false, error: 'Invalid Stellar public key for inflation destination' });
    }
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    // Only the account owner can set inflation destination
    if (!req.user || String(wallet.ownerId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, error: 'Only the account owner may set the inflation destination' });
    }
    const stellarSvc = getStellarService();
    let result;
    try {
      result = await stellarSvc.submitSignedTransaction(signedXDR);
    } catch (err) {
      if (err && err.name === 'ValidationError') return next(err);
      return res.status(502).json({ success: false, error: 'Stellar network error while setting inflation destination' });
    }
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'INFLATION_DESTINATION_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/inflation-destination`,
      details: { walletId: req.params.id, inflationDestination: destinationPublicKey, txHash: result.hash },
    });
    return res.json({ success: true, data: { inflationDestination: destinationPublicKey, hash: result.hash, ledger: result.ledger } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:id/inflation-destination
 * Returns the current inflation destination set on the wallet's Stellar account.
 */
router.get('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const wallet = await walletService.getWalletById(req.params.id);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }
    const stellarSvc = getStellarService();
    const inflationDest = await stellarSvc.getInflationDestination(wallet.address || wallet.publicKey).catch(() => null);
    return res.json({ success: true, data: { inflationDestination: inflationDest || null } });
  } catch (error) {
    next(error);
  }
}));

/**
 * @openapi
 * tags:
 *   - name: Wallets
 *     description: Wallet metadata management
 *
 * /wallets:
 *   post:
 *     tags: [Wallets]
 *     summary: Create wallet metadata
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [publicKey]
 *             properties:
 *               publicKey:
 *                 type: string
 *                 description: Stellar public key
 *               label:
 *                 type: string
 *     responses:
 *       201:
 *         description: Wallet created
 *       400:
 *         description: Validation error
 *   get:
 *     tags: [Wallets]
 *     summary: List all wallets
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of wallets
 *
 * /wallets/{id}:
 *   get:
 *     tags: [Wallets]
 *     summary: Get a specific wallet
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Wallet details
 *       404:
 *         description: Wallet not found
 *   patch:
 *     tags: [Wallets]
 *     summary: Update wallet metadata
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet updated
 *
 * /wallets/{publicKey}/transactions:
 *   get:
 *     tags: [Wallets]
 *     summary: Get all transactions for a wallet
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction list
 */

/**
 * POST /wallets
 * Create a new wallet with metadata. Auto-funds via Friendbot on testnet.
 */
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.wallet), checkPermission(PERMISSIONS.WALLETS_CREATE), walletCreateSchema, asyncHandler(async (req, res, next) => {
  try {
    const { address, label, ownerName, sponsored } = req.body;

    if (!address) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_ADDRESS', receivedValue: address }])
      );
    }

    // Validate Stellar public key format using the Stellar SDK
    const StellarSdk = require('stellar-sdk');
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
      const { formatError } = require('../utils/errors');
      return res.status(400).json(formatError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key format', req.id));
    }

    // Create wallet metadata
    const wallet = await walletService.createWallet({
      address,
      label,
      ownerName,
      sponsored: sponsored || false
    });

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
      data: toWalletResponse(wallet)
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets
 * List wallets with cursor-based pagination.
 * Query params:
 *   - limit: page size (default 20, max 100)
 *   - cursor: opaque pagination cursor
 *   - direction: 'next' | 'prev' (default 'next')
 */
router.get('/', checkPermission(PERMISSIONS.WALLETS_READ), cacheMiddleware('wallet', 'private'), (req, res, next) => {
  try {
    // #798: validate ?sort param
    const VALID_SORT = ['id:asc', 'id:desc', 'createdAt:asc', 'createdAt:desc', 'publicKey:asc', 'publicKey:desc'];
    const sort = req.query.sort || 'id:asc';
    if (!VALID_SORT.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SORT',
          message: `Invalid sort value. Valid options: ${VALID_SORT.join(', ')}`,
        },
      });
    }

    const pagination = parseCursorPaginationQuery(req.query);
    const result = walletService.getPaginatedWallets(pagination, sort);

    res.setHeader('X-Total-Count', String(result.totalCount));

    res.json({
      success: true,
      data: result.data.map(toWalletResponse),
      count: result.data.length,
      total: result.totalCount,
      nextCursor: result.meta.next_cursor,
      meta: result.meta
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id/balance
 * Returns XLM balance with TTL caching. Use ?refresh=true to force a live query.
 * Requires wallets:read permission.
 */
router.get('/:id/balance', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === 'true';

    let result;
    try {
      result = await walletService.getBalance(req.params.id, forceRefresh);
    } catch (err) {
      // StellarErrorHandler throws plain objects: { status, code, message }
      // A 404 from Horizon means the account exists locally but not on-chain
      if (err && (err.status === 404 || err.response?.status === 404)) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'STELLAR_ACCOUNT_NOT_FOUND',
            message: 'Stellar account not found. The account exists in the local database but has not been funded on the Stellar network.',
          },
        });
      }
      throw err;
    }

    res.setHeader('X-Cache', result.cached ? 'HIT' : 'MISS');

    return res.json({
      balance: result.balance,
      asset: result.asset || 'XLM',
      lastUpdated: result.lastUpdated || new Date().toISOString(),
      cached: result.cached,
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:id/history
 * Returns transaction history for a wallet.
 * Query params:
 *   - source: 'db' (default) — local DB query; 'live' — fetch from Horizon and persist
 *   - cursor: opaque pagination cursor
 *   - limit: page size (default 20, max 100)
 * source=live is rate-limited to 10 req/min per API key.
 * Requires wallets:read permission.
 */
const { liveHistoryRateLimiter } = require('../middleware/rateLimiter');
const TransactionSyncService = require('../services/TransactionSyncService');

router.get('/:id/history', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  const source = req.query.source || 'db';

  if (source !== 'db' && source !== 'live') {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_SOURCE', message: "source must be 'db' or 'live'" },
    });
  }

  // Apply live rate limiter inline when source=live
  if (source === 'live') {
    await new Promise((resolve, reject) => {
      liveHistoryRateLimiter(req, res, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    if (res.headersSent) return; // rate limiter already responded
  }

  // Validate limit
  let limit = 20;
  if (req.query.limit !== undefined) {
    const parsed = parseInt(req.query.limit, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100' },
      });
    }
    limit = parsed;
  }

  // Look up wallet by numeric id
  const wallet = await Database.get(
    'SELECT id, publicKey FROM users WHERE id = ?',
    [req.params.id]
  );
  if (!wallet) {
    return res.status(404).json({ success: false, error: 'Wallet not found' });
  }

  if (source === 'live') {
    // Decode cursor (Horizon paging_token)
    let horizonCursor;
    if (req.query.cursor) {
      try {
        horizonCursor = Buffer.from(req.query.cursor, 'base64').toString('utf8');
      } catch {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CURSOR', message: 'Invalid cursor parameter' },
        });
      }
    }

    const syncService = new TransactionSyncService(getStellarService());
    const horizonTxs = await syncService._fetchHorizonTransactions(
      wallet.publicKey,
      limit,
      horizonCursor,
      1 // single page
    );

    // Persist new transactions to DB
    const Transaction = require('./models/transaction');
    for (const tx of horizonTxs) {
      if (!Transaction.getByStellarTxId(tx.id)) {
        Transaction.create({
          stellarTxId: tx.id,
          status: 'confirmed',
          amount: tx.operations?.[0]?.amount || '0',
          memo: tx.memo,
          timestamp: tx.created_at,
        });
      }
    }

    const hasMore = horizonTxs.length === limit;
    const lastTx = horizonTxs[horizonTxs.length - 1];
    const nextCursor = hasMore && lastTx
      ? Buffer.from(String(lastTx.paging_token)).toString('base64')
      : null;

    return res.json({
      success: true,
      source: 'live',
      data: horizonTxs.map(tx => ({
        stellarTxId: tx.id,
        amount: tx.operations?.[0]?.amount || '0',
        memo: tx.memo || null,
        timestamp: tx.created_at,
        pagingToken: tx.paging_token,
      })),
      pagination: { nextCursor, hasMore },
    });
  }

  // source=db: cursor-based query from local DB
  let cursorId = null;
  if (req.query.cursor) {
    try {
      const decoded = Buffer.from(req.query.cursor, 'base64').toString('utf8');
      const parsed = parseInt(decoded, 10);
      if (!Number.isFinite(parsed)) throw new Error('invalid');
      cursorId = parsed;
    } catch {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CURSOR', message: 'Invalid cursor parameter' },
      });
    }
  }

  const params = [wallet.id, wallet.id];
  let query = `SELECT t.id, t.senderId, t.receiverId, t.amount, t.memo, t.timestamp,
      sender.publicKey as senderPublicKey, receiver.publicKey as receiverPublicKey
    FROM transactions t
    LEFT JOIN users sender ON t.senderId = sender.id
    LEFT JOIN users receiver ON t.receiverId = receiver.id
    WHERE (t.senderId = ? OR t.receiverId = ?)`;

  if (cursorId !== null) {
    query += ' AND t.id > ?';
    params.push(cursorId);
  }
  query += ' ORDER BY t.id ASC LIMIT ?';
  params.push(limit + 1);

  const rows = await Database.query(query, params);
  const hasMore = rows.length > limit;
  const transactions = hasMore ? rows.slice(0, limit) : rows;

  const lastRow = transactions[transactions.length - 1];
  const nextCursor = hasMore && lastRow
    ? Buffer.from(String(lastRow.id)).toString('base64')
    : null;

  return res.json({
    success: true,
    source: 'db',
    data: transactions.map(tx => ({
      id: tx.id,
      sender: tx.senderPublicKey,
      receiver: tx.receiverPublicKey,
      amount: (tx.amount / STROOPS_PER_XLM).toFixed(7),
      memo: tx.memo,
      timestamp: tx.timestamp,
    })),
    pagination: { nextCursor, hasMore },
  });
}));

/**
 * GET /wallets/:id
 * Get a specific wallet. Excludes soft-deleted wallets by default.
 */
router.get('/:id', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, cacheMiddleware('wallet', 'private'), asyncHandler(async (req, res, next) => {
  try {
    const wallet = await Database.get(
      'SELECT id, publicKey, label, ownerName, createdAt FROM users WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    // ETag and conditional request support (#751)
    const lastModifiedDate = new Date(wallet.updatedAt || wallet.createdAt);
    const etag = `"${wallet.id}-${lastModifiedDate.getTime()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModifiedDate.toUTCString());
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }
    if (req.headers['if-modified-since']) {
      const ifModifiedSince = new Date(req.headers['if-modified-since']);
      if (!isNaN(ifModifiedSince.getTime()) && lastModifiedDate <= ifModifiedSince) {
        return res.status(304).end();
      }
    }

    const stellarSvc = getStellarService();
    const homeDomain = await stellarSvc.getHomeDomain(wallet.address || wallet.publicKey).catch(() => null);
    res.json({ success: true, data: toWalletResponse({ ...wallet, homeDomain: homeDomain || null }) });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /wallets/:id/label
 * Update the human-readable label for a wallet.
 * Body: { "label": "string" } — empty string or null clears the label.
 * Requires wallets:write permission (not admin).
 */
router.patch('/:id/label', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { label } = req.body;

    // label key must be present (can be null or empty string to clear)
    if (!Object.prototype.hasOwnProperty.call(req.body, 'label')) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: "'label' field is required" },
      });
    }

    // null or empty string → clear the label; otherwise validate max length
    const newLabel = (label === null || label === '') ? null : String(label);
    if (newLabel !== null && newLabel.length > 100) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'label must not exceed 100 characters' },
      });
    }

    const wallet = await walletService.updateWallet(id, { label: newLabel });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: AuditLogService.ACTION.WALLET_UPDATED,
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${id}/label`,
      details: { walletId: id, label: newLabel },
    });

    res.json({ success: true, data: toWalletResponse(wallet) });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /wallets/:id
 * Update wallet metadata (label, ownerName only — publicKey is immutable)
 */
router.patch('/:id', checkPermission(PERMISSIONS.WALLETS_UPDATE), payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    // publicKey is immutable — changing it would break all FK relationships
    if (req.body.publicKey !== undefined) {
      return res.status(400).json({ success: false, error: 'Public key cannot be changed' });
    }

    const { label, ownerName } = req.body;

    if (!label && !ownerName) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_WALLET_FIELD', receivedValue: undefined }])
      );
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

    res.json({ success: true, data: toWalletResponse(wallet) });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /wallets/:id/home-domain
 * Set the home domain on a wallet's Stellar account.
 * Body: { domain: string, sourceSecret: string }
 */
router.patch('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
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
}));

/**
 * PUT /wallets/:id/home-domain
 * Idiomatic alias for PATCH — sets the home domain on a wallet's Stellar account.
 * Body: { domain: string, sourceSecret: string }
 */
router.put('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const { domain, sourceSecret } = req.body;

    if (!domain || !sourceSecret) {
      return res.status(400).json({ success: false, error: 'Missing required fields: domain, sourceSecret' });
    }

    const _wallet = walletService.getWalletById(req.params.id);

    const stellarSvc = getStellarService();
    let result;
    try {
      result = await stellarSvc.setHomeDomain(sourceSecret, domain);
    } catch (err) {
      if (err && err.name === 'ValidationError') return next(err);
      return res.status(502).json({ success: false, error: 'Stellar network error while setting home domain' });
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

    return res.json({ success: true, data: { homeDomain: domain, hash: result.hash, ledger: result.ledger } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:id/home-domain
 * Returns the current home_domain set on the wallet's Stellar account.
 */
router.get('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const wallet = walletService.getWalletById(req.params.id);

    const stellarSvc = getStellarService();
    const homeDomain = await stellarSvc.getHomeDomain(wallet.address || wallet.publicKey).catch(() => null);

    return res.json({ success: true, data: { homeDomain: homeDomain || null } });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /wallets/:id/home-domain/verify
 * Fetches https://{domain}/.well-known/stellar.toml and confirms the wallet's
 * public key is listed under ACCOUNTS.
 */
router.post('/:id/home-domain/verify', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const wallet = walletService.getWalletById(req.params.id);

    const stellarSvc = getStellarService();
    const publicKey = wallet.address || wallet.publicKey;
    const homeDomain = await stellarSvc.getHomeDomain(publicKey).catch(() => null);

    if (!homeDomain) {
      return res.status(400).json({ success: false, error: 'No home domain is set for this wallet' });
    }

    const https = require('https');
    const tomlUrl = `https://${homeDomain}/.well-known/stellar.toml`;

    const tomlContent = await new Promise((resolve, reject) => {
      const req2 = https.get(tomlUrl, { timeout: 5000 }, (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          return reject(new Error(`stellar.toml returned HTTP ${response.statusCode}`));
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(chunks.join('')));
      });
      req2.on('timeout', () => { req2.destroy(); reject(new Error('Request timed out after 5 seconds')); });
      req2.on('error', (err) => reject(err));
    }).catch((err) => {
      return res.status(502).json({
        success: false,
        error: `Could not fetch stellar.toml from ${tomlUrl}: ${err.message}`,
      });
    });

    // If response was already sent (error case above), stop here
    if (res.headersSent) return;

    const listed = tomlContent.includes(publicKey);
    if (!listed) {
      return res.status(422).json({
        success: false,
        error: `Account ${publicKey} is not listed in ${tomlUrl}`,
        data: { homeDomain, publicKey, verified: false },
      });
    }

    return res.json({
      success: true,
      data: { homeDomain, publicKey, verified: true },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:publicKey/transactions
 * Get all transactions (sent and received) for a wallet with cursor-based pagination.
 * Query params:
 *   - limit: number of results per page (default 20, max 100)
 *   - cursor: opaque base64-encoded pagination cursor (transaction ID)
 */
router.get('/:publicKey/transactions', checkPermission(PERMISSIONS.WALLETS_READ), walletPublicKeySchema, asyncHandler(async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    // Validate limit
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_LIMIT', message: 'limit must be an integer between 1 and 100' },
        });
      }
      limit = parsed;
    }

    // Decode opaque cursor (base64-encoded numeric ID)
    let cursorId = null;
    if (req.query.cursor) {
      try {
        const decoded = Buffer.from(req.query.cursor, 'base64').toString('utf8');
        const parsed = parseInt(decoded, 10);
        if (!Number.isFinite(parsed)) throw new Error('invalid');
        cursorId = parsed;
      } catch {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_CURSOR', message: 'Invalid cursor parameter' },
        });
      }
    }

    // Check wallet exists
    const user = await Database.get(
      'SELECT id, publicKey, createdAt FROM users WHERE publicKey = ?',
      [publicKey]
    );

    if (!user) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Total count
    const countResult = await Database.get(
      'SELECT COUNT(*) as total FROM transactions t WHERE t.senderId = ? OR t.receiverId = ?',
      [user.id, user.id]
    );
    const total = countResult.total;

    // Fetch limit+1 to detect hasMore
    const params = [user.id, user.id];
    let query = `SELECT
        t.id, t.senderId, t.receiverId, t.amount, t.memo, t.timestamp,
        sender.publicKey as senderPublicKey,
        receiver.publicKey as receiverPublicKey
      FROM transactions t
      LEFT JOIN users sender ON t.senderId = sender.id
      LEFT JOIN users receiver ON t.receiverId = receiver.id
      WHERE (t.senderId = ? OR t.receiverId = ?)`;

    if (cursorId !== null) {
      query += ' AND t.id > ?';
      params.push(cursorId);
    }

    query += ' ORDER BY t.id ASC LIMIT ?';
    params.push(limit + 1);

    const rows = await Database.query(query, params);
    const hasMore = rows.length > limit;
    const transactions = hasMore ? rows.slice(0, limit) : rows;

    const formattedTransactions = transactions.map(tx => ({
      id: tx.id,
      sender: tx.senderPublicKey,
      receiver: tx.receiverPublicKey,
      amount: (tx.amount / STROOPS_PER_XLM).toFixed(7),
      memo: tx.memo,
      timestamp: tx.timestamp,
    }));

    // Encode next cursor as opaque base64 string
    const lastTx = transactions[transactions.length - 1];
    const nextCursor = hasMore && lastTx
      ? Buffer.from(String(lastTx.id)).toString('base64')
      : null;

    res.json({
      success: true,
      data: formattedTransactions,
      pagination: {
        nextCursor,
        hasMore,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /wallets/:id/limits
 * Set per-wallet donation limits (admin only)
 * Body: { daily_limit, monthly_limit, per_transaction_limit } — all optional, positive number or null
 */
router.patch('/:id/limits', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
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
}));

/**
 * PATCH /wallets/:id/leaderboard-visibility
 * Opt a wallet in or out of public leaderboard ranking.
 * Body: { visible: boolean }
 */
router.patch('/:id/leaderboard-visibility', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const { visible } = req.body || {};
    if (typeof visible !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: "'visible' must be a boolean" },
      });
    }
    const wallet = walletService.getWalletById(req.params.id);
    const updated = Wallet.update(wallet.id, { leaderboard_visibility: visible });
    res.json({ success: true, data: { id: updated.id, leaderboard_visibility: updated.leaderboard_visibility } });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /wallets/:id/sponsor
 * Sponsor a new account's base reserve using the platform SPONSOR_SECRET.
 */
router.post('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
  try {
    const result = await walletService.sponsorAccount(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /wallets/:id/sponsor
 * Revoke sponsorship for a wallet. Returns 400 if the account cannot cover its own reserve.
 */
router.delete('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const { entryType } = req.query;
    const result = await walletService.revokeSponsorship(req.params.id, entryType);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /wallets/:id/sponsor
 * Return the current sponsorship status for a wallet.
 */
router.get('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const status = await walletService.getSponsorshipStatus(req.params.id);
    res.json({ success: true, data: status });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /wallets/:id/revoke-sponsorship
 * Revoke platform sponsorship for a wallet.
 * Requires SPONSOR_SECRET to be configured in environment.
 */
router.post('/:id/revoke-sponsorship', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
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
}));

/**
 * DELETE /wallets/:id
 * Soft delete a wallet by setting deleted_at timestamp.
 * Returns 409 if the wallet has active recurring donation schedules.
 */
router.delete('/:id', checkPermission(PERMISSIONS.WALLETS_DELETE), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if wallet exists and isn't already deleted
    const wallet = await Database.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!wallet) {
      throw new NotFoundError('Wallet not found or already deleted', ERROR_CODES.WALLET_NOT_FOUND);
    }

    // 409: block deletion if wallet has active recurring donation schedules
    const activeSchedules = await Database.query(
      `SELECT id FROM recurring_donations WHERE (donorId = ? OR recipientId = ?) AND status = 'active'`,
      [id, id]
    );
    if (activeSchedules && activeSchedules.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'ACTIVE_SCHEDULES',
          message: 'Cannot delete wallet with active recurring donation schedules',
          activeScheduleIds: activeSchedules.map(s => s.id)
        }
      });
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
}));

/**
 * GET /admin/deleted
 * Admin only: View all soft-deleted wallets and transactions
 */
router.get('/admin/deleted', requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const deletedWallets = await Database.query('SELECT * FROM users WHERE deleted_at IS NOT NULL');
    const deletedTransactions = await Database.query('SELECT * FROM transactions WHERE deleted_at IS NOT NULL');

    res.json({
      success: true,
      data: {
        wallets: deletedWallets.map(toWalletResponse),
        transactions: deletedTransactions
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/wallets/:id/restore
 * Admin only: Restore a soft-deleted wallet by clearing deleted_at
 */
router.post('/admin/wallets/:id/restore', requireAdmin(), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;

    const wallet = await Database.get('SELECT id FROM users WHERE id = ? AND deleted_at IS NOT NULL', [id]);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found or not deleted' });
    }

    await Database.run('UPDATE users SET deleted_at = NULL WHERE id = ?', [id]);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'WALLET_RESTORED',
      severity: AuditLogService.SEVERITY.HIGH,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/admin/wallets/${id}/restore`,
      details: { walletId: id }
    });

    res.json({ success: true, message: 'Wallet restored successfully' });
  } catch (error) {
    next(error);
  }
}));



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
  asyncHandler(async (req, res, next) => {
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
  })
);

/**
 * GET /wallets/:id/data
 * Fetch all current data entries for a wallet from the Stellar network
 */
router.get('/:id/data',
  checkPermission(PERMISSIONS.WALLETS_READ),
  walletIdSchema,
  asyncHandler(async (req, res, next) => {
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
  })
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
  asyncHandler(async (req, res, next) => {
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
  })
);

/**
 * GET /wallets/:id/merge/eligibility
 * Check whether a wallet account is eligible for merging.
 * Returns all blocking conditions (open offers, non-zero trustlines, data entries).
 */
router.get('/:id/merge/eligibility', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    const wallet = await Database.get(
      'SELECT id, publicKey, mergedAt FROM users WHERE id = ?',
      [req.params.id]
    );

    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    if (wallet.mergedAt) {
      return res.status(409).json({
        success: false,
        error: 'Wallet has already been merged and closed',
        data: { eligible: false, blockers: [{ type: 'already_merged', detail: 'Wallet was merged on ' + wallet.mergedAt }] }
      });
    }

    const stellarSvc = getStellarService();
    const result = await stellarSvc.validateMergeEligibility(wallet.publicKey);

    res.json({
      success: true,
      data: {
        walletId: wallet.id,
        publicKey: wallet.publicKey,
        eligible: result.eligible,
        blockers: result.blockers,
      }
    });
  } catch (error) {
    next(error);
  }
}));

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
router.post('/:id/merge', checkPermission(PERMISSIONS.WALLETS_DELETE), payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
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
}));

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
async function handleTrustlineCreate(req, res, next) {
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
      resource: req.originalUrl,
      details: { walletId: req.params.id, assetCode, issuerPublic, limit: result.limit, txHash: result.hash },
    });

    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

router.post('/:id/trustlines', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineCreateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(handleTrustlineCreate));
router.post('/:id/trustline', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineCreateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(handleTrustlineCreate));

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
async function handleTrustlineUpdate(req, res, next) {
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
      resource: req.originalUrl,
      details: { walletId: req.params.id, assetCode: asset, issuerPublic, limit: result.limit, txHash: result.hash },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

router.patch('/:id/trustlines/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineUpdateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(handleTrustlineUpdate));
router.patch('/:id/trustline/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineUpdateSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(handleTrustlineUpdate));

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
router.patch('/:id/options', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletOptionsSchema, payloadSizeLimiter(ENDPOINT_LIMITS.wallet), asyncHandler(async (req, res, next) => {
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
}));

// ─── Trustline Management ───────────────────────────────────────────────────────

const trustlineDeleteSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
      asset: { type: 'string', required: true },
    },
  },
  body: {
    fields: {
      secretKey:    { type: 'string', required: true },
      issuerPublic: { type: 'string', required: true, trim: true },
    },
  },
});

const trustlineListSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
    },
  },
});

/**
 * DELETE /wallets/:id/trustlines/:asset
 * Remove a trustline for a custom asset from the wallet's Stellar account.
 * The account must have a zero balance for the asset before removal.
 *
 * @param {string} asset - Asset code in the URL path
 * @body {string} secretKey    - Secret key of the wallet account
 * @body {string} issuerPublic - Public key of the asset issuer
 */
async function handleTrustlineDelete(req, res, next) {
  try {
    const { asset } = req.params;
    const { secretKey, issuerPublic } = req.body;

    const stellar = getStellarService();
    const result = await stellar.removeTrustline(secretKey, asset, issuerPublic);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'TRUSTLINE_REMOVED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: req.originalUrl,
      details: { walletId: req.params.id, assetCode: asset, issuerPublic, txHash: result.hash },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

router.delete('/:id/trustlines/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineDeleteSchema, asyncHandler(handleTrustlineDelete));
router.delete('/:id/trustline/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineDeleteSchema, asyncHandler(handleTrustlineDelete));

/**
 * GET /wallets/:id/trustlines
 * List all trustlines (and native XLM balance) for the wallet's Stellar account.
 * Response is cached for 30 seconds per wallet.
 */
router.get('/:id/trustlines', checkPermission(PERMISSIONS.WALLETS_READ), trustlineListSchema, asyncHandler(async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);

    const wallet = await Database.get('SELECT id, publicKey, address FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      return res.status(404).json({
        success: false,
        error: { code: 'WALLET_NOT_FOUND', message: `Wallet ${walletId} not found` },
      });
    }

    const publicKey = wallet.publicKey || wallet.address;
    const stellar = getStellarService();

    let balances;
    try {
      balances = await stellar.getAccountBalances(publicKey);
    } catch (err) {
      // Horizon returns 404 when the account has never been funded
      const notFound =
        err?.status === 404 ||
        err?.response?.status === 404 ||
        err?.message?.toLowerCase().includes('not found') ||
        err?.message?.toLowerCase().includes('does not exist');
      if (notFound) {
        return res.status(422).json({
          success: false,
          error: { code: 'STELLAR_ACCOUNT_NOT_FOUND', message: 'Stellar account does not exist on the network' },
        });
      }
      throw err;
    }

    const trustlines = balances.map(b => {
      if (b.asset_type === 'native') {
        return { assetCode: 'XLM', assetType: 'native', balance: b.balance };
      }
      return {
        assetCode: b.asset_code,
        assetIssuer: b.asset_issuer,
        balance: b.balance,
        limit: b.limit,
        authorized: Boolean(b.is_authorized),
      };
    });

    res.setHeader('Cache-Control', 'private, max-age=30');

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'TRUSTLINES_LISTED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${walletId}/trustlines`,
      details: { walletId, count: trustlines.length },
    });

    return res.json({ success: true, data: trustlines, count: trustlines.length });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /wallets/bulk-import
// ─────────────────────────────────────────────────────────────────────────────

const multer = require('multer');
const { parse: parseCsvSync } = require('csv-parse/sync');
const StellarSdkBulk = require('stellar-sdk');

const BULK_IMPORT_MAX_BYTES = parseInt(process.env.BULK_IMPORT_MAX_SIZE_BYTES || (1 * 1024 * 1024), 10);
const bulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: BULK_IMPORT_MAX_BYTES },
});

/**
 * POST /wallets/bulk-import
 * Bulk import wallet addresses from a CSV file (multipart/form-data, field: "file").
 * CSV must have a header row: address,label,ownerName (label and ownerName are optional).
 * Each row is validated independently — invalid rows are counted as failed, duplicates as skipped.
 * Requires admin role.
 */
router.post(
  '/bulk-import',
  requireAdmin(),
  (req, res, next) => {
    bulkUpload.single('file')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds the maximum allowed size of ${BULK_IMPORT_MAX_BYTES} bytes`,
          },
        });
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FILE', message: 'A file upload is required (field: "file")' },
        });
      }

      let rows;
      try {
        rows = parseCsvSync(req.file.buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          error: { code: 'PARSE_ERROR', message: `CSV parse error: ${parseErr.message}` },
        });
      }

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_FILE', message: 'CSV file contains no data rows' },
        });
      }

      if (!Object.prototype.hasOwnProperty.call(rows[0], 'address')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_HEADER',
            message: 'CSV must have a header row with at least an "address" column',
          },
        });
      }

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const errors = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2; // row 1 is the header
        const address = (row.address || '').trim();

        if (!address) {
          failed++;
          errors.push({ row: rowNum, address: '', reason: 'Missing address' });
          continue;
        }

        if (!StellarSdkBulk.StrKey.isValidEd25519PublicKey(address)) {
          failed++;
          errors.push({ row: rowNum, address, reason: 'Invalid Stellar public key' });
          continue;
        }

        const existing = Wallet.getByAddress(address);
        if (existing) {
          skipped++;
          continue;
        }

        try {
          Wallet.create({
            address,
            label: row.label || null,
            ownerName: row.ownerName || null,
          });
          imported++;
        } catch (createErr) {
          failed++;
          errors.push({ row: rowNum, address, reason: createErr.message });
        }
      }

      return res.status(200).json({
        success: true,
        data: { imported, skipped, failed, errors },
      });
    } catch (error) {
      next(error);
    }
  })
);

/**
 * POST /wallets/:id/fund
 * Fund a wallet via Stellar Friendbot (testnet only).
 * Rate limited to 5 requests per minute per API key.
 */
const { friendbotRateLimiter } = require('../middleware/rateLimiter');
const requireApiKey = require('../middleware/apiKey');

router.post('/:id/fund', requireApiKey, checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, friendbotRateLimiter, asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const force = req.query.force === 'true';

    // Look up wallet
    const wallet = await Database.get(
      'SELECT id, publicKey FROM users WHERE id = ?',
      [id]
    );
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const address = wallet.publicKey || wallet.address;
    const stellarSvc = getStellarService();

    // Check network — Friendbot only works on testnet
    const network = stellarSvc.getNetwork ? stellarSvc.getNetwork() : 'testnet';
    if (network === 'mainnet' || network === 'public') {
      return res.status(400).json({
        success: false,
        error: 'Friendbot funding is only available on testnet',
        network: 'mainnet',
        hint: 'Fund mainnet wallets by receiving XLM from an existing funded account',
      });
    }

    // Unless force=true, check if already funded
    if (!force) {
      try {
        const fundedStatus = await stellarSvc.isAccountFunded(address);
        if (fundedStatus && fundedStatus.funded) {
          return res.status(409).json({
            success: false,
            error: 'Wallet already has a funded account on the Stellar network',
            currentBalanceXLM: fundedStatus.balance,
            hint: 'Use POST /wallets/:id/fund?force=true to fund again (adds more XLM)',
          });
        }
      } catch (_) {
        // Account doesn't exist yet — proceed with funding
      }
    }

    // Fund via Friendbot
    const _fundResult = await stellarSvc.fundWithFriendbot(address);

    // Update wallet record with fundedAt timestamp
    const now = new Date().toISOString();
    try {
      await Database.run('ALTER TABLE users ADD COLUMN IF NOT EXISTS fundedAt TEXT');
    } catch (_) {
      // Column may already exist — ignore
    }
    await Database.run('UPDATE users SET fundedAt = ? WHERE id = ?', [now, id]);

    return res.status(200).json({
      success: true,
      data: {
        walletId: id,
        publicKey: address,
        fundedAmount: '10000',
        fundedAmountXLM: 10000,
        network: network || 'testnet',
        message: 'Wallet successfully funded via Stellar Friendbot',
      },
    });
  } catch (error) {
    next(error);
  }
}));

const Cache = require('../utils/cache');
const WALLET_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /wallets/:id/analytics
 * Returns aggregated donation analytics for a wallet (by DB id).
 * Requires wallets:read permission. Cached for 5 minutes.
 */
router.get('/:id/analytics', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res) => {
  const walletId = parseInt(req.params.id, 10);

  const wallet = await Database.get('SELECT id FROM users WHERE id = ?', [walletId]);
  if (!wallet) {
    return res.status(404).json({ success: false, error: { code: 'WALLET_NOT_FOUND', message: 'Wallet not found' } });
  }

  const cacheKey = `wallet:analytics:${walletId}`;
  const cached = Cache.get(cacheKey);
  if (cached) return res.json(cached);

  const [outRows, inRows] = await Promise.all([
    Database.query('SELECT amount, receiverId, timestamp FROM transactions WHERE senderId = ?', [walletId]),
    Database.query('SELECT amount, senderId, timestamp FROM transactions WHERE receiverId = ?', [walletId]),
  ]);

  // Aggregate outgoing (donor)
  const totalDonated = outRows.reduce((s, r) => s + r.amount, 0);
  const donationCount = outRows.length;
  const averageDonationAmount = donationCount > 0 ? totalDonated / donationCount : 0;
  const largestDonation = donationCount > 0 ? Math.max(...outRows.map(r => r.amount)) : 0;

  // Top 5 recipients
  const recipientTotals = {};
  for (const r of outRows) {
    recipientTotals[r.receiverId] = (recipientTotals[r.receiverId] || 0) + r.amount;
  }
  const topRecipients = Object.entries(recipientTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, total]) => ({ walletId: Number(id), total }));

  // Aggregate incoming (recipient)
  const totalReceived = inRows.reduce((s, r) => s + r.amount, 0);
  const receiptCount = inRows.length;

  // Top 5 donors
  const donorTotals = {};
  for (const r of inRows) {
    donorTotals[r.senderId] = (donorTotals[r.senderId] || 0) + r.amount;
  }
  const topDonors = Object.entries(donorTotals)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([id, total]) => ({ walletId: Number(id), total }));

  // Donations by month (last 12 months) — outgoing
  const now = new Date();
  const donationsByMonth = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const monthRows = outRows.filter(r => {
      const t = new Date(r.timestamp);
      return t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth();
    });
    donationsByMonth.push({ month, amount: monthRows.reduce((s, r) => s + r.amount, 0), count: monthRows.length });
  }

  // First/last donation timestamps
  const allTimestamps = outRows.map(r => r.timestamp).filter(Boolean).sort();
  const firstDonationAt = allTimestamps.length > 0 ? allTimestamps[0] : null;
  const lastDonationAt = allTimestamps.length > 0 ? allTimestamps[allTimestamps.length - 1] : null;

  const body = {
    success: true,
    data: {
      totalDonated, totalReceived, donationCount, receiptCount,
      averageDonationAmount, largestDonation,
      topRecipients, topDonors, donationsByMonth,
      firstDonationAt, lastDonationAt,
    },
  };

  Cache.set(cacheKey, body, WALLET_ANALYTICS_CACHE_TTL_MS);
  return res.json(body);
}));

module.exports = router;
