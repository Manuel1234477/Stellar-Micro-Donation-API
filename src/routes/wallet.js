// Inflation destination schema for PATCH
const inflationDestinationSchema = {
  type: 'object',
  required: ['destination', 'sourceSecret'],
  properties: {
    destination: { type: 'string' },
    sourceSecret: { type: 'string' }
  }
};

// PATCH /wallets/:id/inflation-destination
router.patch(
  '/:id/inflation-destination',
  requireAuth,
  requirePermission('wallets:write'),
  validateSchema(inflationDestinationSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const { destination, sourceSecret } = req.body;
      const wallet = await WalletService.getWalletById(id);
      if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
      const result = await StellarService.setInflationDestination(sourceSecret, destination);
      // Optionally log audit here
      res.status(200).json({ success: true, inflationDestination: destination, result });
    } catch (err) {
      next(err);
    }
  }
);

// GET /wallets/:id/inflation-destination
router.get(
  '/:id/inflation-destination',
  requireAuth,
  requirePermission('wallets:read'),
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const wallet = await WalletService.getWalletById(id);
      if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
      const inflationDestination = await StellarService.getInflationDestination(wallet.address);
      res.status(200).json({ inflationDestination });
    } catch (err) {
      next(err);
    }
  }
);
/**
 * PUT /wallets/:id/inflation-destination
 * Set the inflation destination for a wallet's Stellar account.
 * Body: { destinationPublicKey: string, sourceSecret: string }
 * Requires wallets:write permission.
 */
router.put('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const { destinationPublicKey, sourceSecret } = req.body;
    if (!destinationPublicKey || !sourceSecret) {
      return res.status(400).json({ success: false, error: 'Missing required fields: destinationPublicKey, sourceSecret' });
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
      result = await stellarSvc.setInflationDestination(sourceSecret, destinationPublicKey);
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
});

/**
 * GET /wallets/:id/inflation-destination
 * Returns the current inflation destination set on the wallet's Stellar account.
 */
router.get('/:id/inflation-destination', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
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
});
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

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const LimitService = require('../services/LimitService');
const Database = require('../utils/database');
const { buildErrorResponse } = require('../utils/validationErrorFormatter');

/**
 * POST /wallets
 * Create a new wallet with metadata. Auto-funds via Friendbot on testnet.
 */
router.post('/', payloadSizeLimiter(ENDPOINT_LIMITS.wallet), checkPermission(PERMISSIONS.WALLETS_CREATE), walletCreateSchema, async (req, res, next) => {
  try {
    const { address, label, ownerName, sponsored } = req.body;

    if (!address) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_ADDRESS', receivedValue: address }])
      );
    }

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
  try {
    const wallet = await Database.get(
      'SELECT id, publicKey, label, ownerName, createdAt FROM users WHERE id = ?',
      [req.params.id]
    );
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
 * PUT /wallets/:id/home-domain
 * Idiomatic alias for PATCH — sets the home domain on a wallet's Stellar account.
 * Body: { domain: string, sourceSecret: string }
 */
router.put('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const { domain, sourceSecret } = req.body;

    if (!domain || !sourceSecret) {
      return res.status(400).json({ success: false, error: 'Missing required fields: domain, sourceSecret' });
    }

    const wallet = walletService.getWalletById(req.params.id);

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
});

/**
 * GET /wallets/:id/home-domain
 * Returns the current home_domain set on the wallet's Stellar account.
 */
router.get('/:id/home-domain', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
  try {
    const wallet = walletService.getWalletById(req.params.id);

    const stellarSvc = getStellarService();
    const homeDomain = await stellarSvc.getHomeDomain(wallet.address || wallet.publicKey).catch(() => null);

    return res.json({ success: true, data: { homeDomain: homeDomain || null } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /wallets/:id/home-domain/verify
 * Fetches https://{domain}/.well-known/stellar.toml and confirms the wallet's
 * public key is listed under ACCOUNTS.
 */
router.post('/:id/home-domain/verify', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
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
 * PATCH /wallets/:id/leaderboard-visibility
 * Opt a wallet in or out of public leaderboard ranking.
 * Body: { visible: boolean }
 */
router.patch('/:id/leaderboard-visibility', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
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
});

/**
 * POST /wallets/:id/sponsor
 * Sponsor a new account's base reserve using the platform SPONSOR_SECRET.
 */
router.post('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const result = await walletService.sponsorAccount(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /wallets/:id/sponsor
 * Revoke sponsorship for a wallet. Returns 400 if the account cannot cover its own reserve.
 */
router.delete('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_UPDATE), walletIdSchema, async (req, res, next) => {
  try {
    const { entryType } = req.query;
    const result = await walletService.revokeSponsorship(req.params.id, entryType);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id/sponsor
 * Return the current sponsorship status for a wallet.
 */
router.get('/:id/sponsor', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
  try {
    const status = await walletService.getSponsorshipStatus(req.params.id);
    res.json({ success: true, data: status });
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
 * GET /wallets/:id/merge/eligibility
 * Check whether a wallet account is eligible for merging.
 * Returns all blocking conditions (open offers, non-zero trustlines, data entries).
 */
router.get('/:id/merge/eligibility', checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, async (req, res, next) => {
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
});

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

    // Pre-merge eligibility check
    const eligibility = await stellarService.validateMergeEligibility(sourceWallet.publicKey);
    if (!eligibility.eligible) {
      return res.status(400).json({
        success: false,
        error: 'Account is not eligible for merge',
        data: { blockers: eligibility.blockers }
      });
    }

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
router.delete('/:id/trustlines/:asset', checkPermission(PERMISSIONS.WALLETS_UPDATE), trustlineDeleteSchema, async (req, res, next) => {
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
      resource: `/wallets/${req.params.id}/trustlines/${asset}`,
      details: { walletId: req.params.id, assetCode: asset, issuerPublic, txHash: result.hash },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /wallets/:id/trustlines
 * List all trustlines for the wallet's Stellar account with their balances.
 *
 * Returns an array of trustlines containing asset details, current balance, and limits.
 */
router.get('/:id/trustlines', checkPermission(PERMISSIONS.WALLETS_READ), trustlineListSchema, async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);

    const wallet = await Database.get('SELECT * FROM users WHERE id = ?', [walletId]);
    if (!wallet) throw new NotFoundError(`Wallet ${walletId} not found`);

    const stellar = getStellarService();
    const trustlines = await stellar.getTrustlines(wallet.publicKey);

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

    return res.json({ success: true, data: { trustlines, count: trustlines.length } });
  } catch (error) {
    next(error);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /wallets/bulk-import
// ─────────────────────────────────────────────────────────────────────────────

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * @route   POST /wallets/bulk-import
 * @desc    Bulk import wallets from a CSV or JSON file (multipart/form-data, field: "file").
 *          Atomically inserts all rows or rolls back on any failure.
 * @access  wallets:create
 */
router.post(
  '/bulk-import',
  checkPermission(PERMISSIONS.WALLETS_CREATE),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FILE', message: 'A file upload is required (field: "file")' },
        });
      }

      const mimeType = req.file.mimetype;
      const service = new BulkWalletImportService();

      let result;
      try {
        result = service.importFile(req.file.buffer, mimeType);
      } catch (err) {
        if (err.code === 'ROW_LIMIT_EXCEEDED') {
          return res.status(400).json({
            success: false,
            error: { code: 'ROW_LIMIT_EXCEEDED', message: err.message, limit: err.limit },
          });
        }
        if (err.code === 'VALIDATION_FAILED') {
          return res.status(400).json({
            success: false,
            error: { code: 'VALIDATION_FAILED', message: err.message, details: err.details },
          });
        }
        if (err.code === 'INSERT_FAILED') {
          return res.status(400).json({
            success: false,
            error: { code: 'INSERT_FAILED', message: err.message },
          });
        }
        // Unsupported type or parse error
        return res.status(400).json({
          success: false,
          error: { code: 'PARSE_ERROR', message: err.message },
        });
      }

      return res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
