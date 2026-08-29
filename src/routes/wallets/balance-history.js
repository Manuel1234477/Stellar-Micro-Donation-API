/**
 * Balance & History Routes - Wallet balance and transaction history endpoints
 *
 * RESPONSIBILITY: HTTP request handling for wallet balance and transaction history queries
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, Database, StellarService
 *
 * Endpoints for querying XLM balance, transaction history, and donation analytics.
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { validateSchema } = require('../../middleware/schemaValidation');
const Database = require('../../utils/database');
const asyncHandler = require('../../utils/asyncHandler');
const { requestTimeout, TIMEOUTS } = require('../../middleware/requestTimeout');
const { STROOPS_PER_XLM } = require('../../constants');
const WalletService = require('../../services/WalletService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const { parseCursorPaginationQuery } = require('../../utils/pagination');
const { toISOStringUTC } = require('../../utils/timestampUtils');
const Cache = require('../../utils/cache');

const { getStellarService } = require('../../config/stellar');

const walletService = new WalletService();

const WALLET_ANALYTICS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

const { liveHistoryRateLimiter } = require('../../middleware/rateLimiter');
const TransactionSyncService = require('../../services/TransactionSyncService');

/**
 * GET /wallets/:id/balance
 * Returns XLM balance with TTL caching. Use ?refresh=true to force a live query.
 * Requires wallets:read permission.
 *
 * Explicit 10s timeout (TIMEOUTS.balance) — bounds the live-refresh Horizon lookup.
 */
router.get('/:id/balance', requestTimeout(TIMEOUTS.balance), checkPermission(PERMISSIONS.WALLETS_READ), walletIdSchema, asyncHandler(async (req, res, next) => {
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

    res.setHeader('X-Cache', result.cacheStatus || (result.cached ? 'HIT' : 'MISS'));

    return res.json({
      balance: result.balance,
      asset: result.asset || 'XLM',
      lastUpdated: result.lastUpdated || new Date().toISOString(),
      cached: result.cached,
      cacheStatus: result.cacheStatus,
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /wallets/:id/refresh-balance
 * Manually purge and refresh the cached balance for a wallet (Issue #1545).
 * Admin only — bypasses the stale-while-revalidate cache entirely and
 * performs a synchronous Horizon fetch, then repopulates the cache.
 *
 * Explicit 10s timeout (TIMEOUTS.balance) — bounds the Horizon lookup.
 */
router.post('/:id/refresh-balance', requestTimeout(TIMEOUTS.balance), requireAdmin(), walletIdSchema, asyncHandler(async (req, res, next) => {
  try {
    let result;
    try {
      result = await walletService.refreshBalance(req.params.id);
    } catch (err) {
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

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.WALLET_OPERATION,
      action: 'WALLET_BALANCE_CACHE_REFRESHED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/wallets/${req.params.id}/refresh-balance`,
      details: { walletId: req.params.id },
    });

    res.setHeader('X-Cache', result.cacheStatus);

    return res.json({
      balance: result.balance,
      asset: result.asset || 'XLM',
      lastUpdated: result.lastUpdated,
      cached: result.cached,
      cacheStatus: result.cacheStatus,
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
    const Transaction = require('../../models/transaction');
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
        timestamp: toISOStringUTC(tx.created_at),
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
      timestamp: toISOStringUTC(tx.timestamp),
    })),
    pagination: { nextCursor, hasMore },
  });
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
