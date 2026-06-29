/**
 * Donations Sub-Router — Query / Read Operations
 *
 * Handles all donation read endpoints:
 *   GET /donations/                    — list with cursor pagination
 *   GET /donations/pending             — pending donations (with stuck detection)
 *   GET /donations/recent              — recent donations (cached)
 *   GET /donations/by-campaign/:id     — donations for a campaign
 *   GET /donations/search              — full-text + field search
 *   GET /donations/limits              — configured donation amount limits
 *   GET /donations/cost-breakdown      — itemized cost estimate
 *   GET /donations/verify-anonymous    — anonymous donor verification
 *   GET /donations/cross-asset/paths   — DEX payment path discovery
 *   GET /donations/stats/by-campaign   — per-campaign aggregated stats
 *   GET /donations/stats/by-tag        — per-tag aggregated stats
 *   GET /donations/verify (POST)       — blockchain verification
 *   GET /donations/:id                 — single donation by ID
 *   GET /donations/:id/status          — SSE real-time status stream
 *   GET /donations/:id/timeline        — donation lifecycle timeline
 */

'use strict';

const express = require('express');
const router = express.Router();

const requireApiKey = require('../../middleware/apiKey');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const log = require('../../utils/log');
const { verificationRateLimiter } = require('../../middleware/rateLimiter');
const { validateXLMAmount } = require('../../utils/validationHelpers');
const { validateDateRange } = require('../../middleware/validation');
const { parseCursorPaginationQuery } = require('../../utils/pagination');
const asyncHandler = require('../../utils/asyncHandler');
const { getStellarService } = require('../../config/stellar');
const DonationService = require('../../services/DonationService');
const StatsService = require('../../services/StatsService');
const { calculateCostBreakdown } = require('../../utils/costBreakdown');
const Transaction = require('../../models/transaction');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');
const { parseAssetInput } = require('../../utils/stellarAsset');
const Cache = require('../../utils/cache');
const donationEvents = require('../../events/donationEvents');

const {
  donationIdParamSchema,
  statsByTagQuerySchema,
  crossAssetPathsSchema,
  applyNotePrivacy,
  LIFECYCLE_STAGES,
} = require('./helpers');

const donationService = new DonationService(getStellarService());
const stellarService = getStellarService();

const RECENT_MAX_LIMIT = parseInt(process.env.RECENT_DONATIONS_MAX_LIMIT || '100', 10);
const RECENT_CACHE_TTL_MS = parseInt(process.env.RECENT_DONATIONS_CACHE_TTL_SECONDS || '5', 10) * 1000;
const STUCK_THRESHOLD_SECONDS = 600; // 10 minutes

// Invalidate recent donations cache when a new donation is created
donationEvents.on(donationEvents.EVENTS.CREATED, () => {
  Cache.clearPrefix('donations:recent:');
});

// ─── GET /donations/ ──────────────────────────────────────────────────────────

/**
 * GET /donations
 * List all donations with cursor-based pagination.
 * Query params: limit, cursor, sort, status, from, to, minAmount, maxAmount
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const VALID_SORT = ['id:asc', 'id:desc', 'timestamp:asc', 'timestamp:desc', 'amount:asc', 'amount:desc'];
    const sort = req.query.sort;
    if (sort !== undefined && !VALID_SORT.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SORT',
          message: `Invalid sort value. Valid options: ${VALID_SORT.join(', ')}`,
        },
      });
    }

    const pagination = parseCursorPaginationQuery(req.query);
    const [sortBy, order] = sort ? sort.split(':') : ['timestamp', 'desc'];
    const { status, from, to, minAmount, maxAmount } = req.query;

    let statusFilter;
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      statusFilter = statuses.length === 1 ? statuses[0] : statuses;
    }

    const filters = {
      sortBy,
      order,
      ...(statusFilter !== undefined && { status: statusFilter }),
      ...(from && { startDate: from }),
      ...(to && { endDate: to }),
      ...(minAmount !== undefined && { minAmount }),
      ...(maxAmount !== undefined && { maxAmount }),
    };

    const result = donationService.getPaginatedDonations(pagination, filters);
    res.setHeader('X-Total-Count', String(result.totalCount));

    res.json({
      success: true,
      data: result.data,
      count: result.data.length,
      pagination: {
        nextCursor: result.meta.next_cursor,
        hasMore: result.meta.next_cursor !== null,
        total: result.totalCount,
      },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/pending ───────────────────────────────────────────────────

/**
 * GET /donations/pending
 * List pending donations with stuck-transaction detection.
 * Admins see all + summary; regular users see only their own.
 */
router.get('/pending', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const isAdmin = req.user && req.user.role === 'admin';
    const stuckThreshold = parseInt(req.query.stuckThresholdSeconds, 10) || STUCK_THRESHOLD_SECONDS;
    const now = Date.now();

    let pending = Transaction.getByStatus('pending');

    if (!isAdmin) {
      const userKey = req.user && (req.user.publicKey || req.user.id);
      if (userKey) {
        pending = pending.filter(tx => tx.donor === userKey);
      } else {
        pending = [];
      }
    }

    const enriched = pending.map(tx => {
      const submittedAt = tx.statusUpdatedAt || tx.timestamp;
      const pendingDurationSeconds = submittedAt
        ? Math.floor((now - new Date(submittedAt).getTime()) / 1000)
        : 0;
      const isStuck = pendingDurationSeconds >= stuckThreshold;

      const humanDuration = (() => {
        const s = pendingDurationSeconds;
        if (s < 60) return `${s} seconds`;
        if (s < 3600) return `${Math.floor(s / 60)} minutes`;
        return `${Math.floor(s / 3600)} hours`;
      })();

      return {
        id: tx.id,
        amount: tx.amount,
        donorPublicKey: tx.donor || null,
        recipientPublicKey: tx.recipient || null,
        stellarTxHash: tx.stellarTxId || null,
        submittedAt: submittedAt || null,
        pendingDurationSeconds,
        pendingDurationHuman: humanDuration,
        retryCount: tx.feeBumpCount || 0,
        isStuck,
        stuckThresholdSeconds: stuckThreshold,
      };
    });

    const response = { data: enriched };

    if (isAdmin) {
      const stuckCount = enriched.filter(tx => tx.isStuck).length;
      const oldestPendingSeconds = enriched.length > 0
        ? Math.max(...enriched.map(tx => tx.pendingDurationSeconds))
        : 0;
      response.summary = {
        total: enriched.length,
        stuckCount,
        oldestPendingSeconds,
      };
    }

    res.json(response);
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/recent ────────────────────────────────────────────────────

/**
 * GET /donations/recent
 * Recent donations ordered by creation date descending, with short-lived cache.
 */
router.get('/recent', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const rawLimit = req.query.limit;

    let limit = 10;
    if (rawLimit !== undefined) {
      const parsed = Number(rawLimit);
      if (!Number.isInteger(parsed) || parsed <= 0 || String(rawLimit).trim() !== String(Math.floor(parsed))) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_LIMIT', message: 'limit must be a positive integer' },
        });
      }
      limit = Math.min(parsed, RECENT_MAX_LIMIT);
    }

    const cacheKey = `donations:recent:${limit}`;
    const cached = Cache.get(cacheKey);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    const data = donationService.getRecentDonations(limit);
    res.setHeader('X-Total-Count', String(Transaction.getAll().length));
    const body = { success: true, data, count: data.length, limit };
    Cache.set(cacheKey, body, RECENT_CACHE_TTL_MS);
    res.setHeader('X-Cache', 'MISS');
    res.json(body);
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/by-campaign/:campaignId ───────────────────────────────────

/**
 * GET /donations/by-campaign/:campaignId
 * Paginated donations for a specific campaign.
 */
router.get('/by-campaign/:campaignId', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { campaignId } = req.params;
    const { status, cursor } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const Database = require('../../utils/database');
    const campaign = await Database.get(
      'SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL',
      [campaignId]
    );
    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Campaign not found' },
      });
    }

    const params = [campaignId];
    let where = 'WHERE t.campaign_id = ?';

    if (status) {
      where += ' AND t.status = ?';
      params.push(status);
    }

    if (cursor) {
      where += ' AND t.id > ?';
      params.push(parseInt(cursor, 10));
    }

    const countParams = [campaignId];
    let countWhere = 'WHERE t.campaign_id = ?';
    if (status) {
      countWhere += ' AND t.status = ?';
      countParams.push(status);
    }
    const countRow = await Database.get(
      `SELECT COUNT(*) as total FROM transactions t ${countWhere}`,
      countParams
    );

    const rows = await Database.query(
      `SELECT t.id, t.amount, t.status, t.stellar_tx_id as transactionHash,
              t.timestamp, t.anonymous,
              sender.publicKey as donorPublicKey,
              t.tags
       FROM transactions t
       LEFT JOIN users sender ON t.senderId = sender.id
       ${where}
       ORDER BY t.id ASC
       LIMIT ?`,
      [...params, limit]
    );

    const data = rows.map(tx => ({
      id: tx.id,
      amount: tx.amount,
      donorPublicKey: tx.anonymous ? null : tx.donorPublicKey,
      timestamp: tx.timestamp,
      status: tx.status,
      transactionHash: tx.transactionHash,
      tags: tx.tags ? JSON.parse(tx.tags) : [],
    }));

    const nextCursor = rows.length === limit && rows.length > 0
      ? rows[rows.length - 1].id
      : null;

    res.json({
      success: true,
      data,
      count: data.length,
      total: countRow.total,
      pagination: { limit, nextCursor },
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/search ────────────────────────────────────────────────────

/**
 * GET /donations/search
 * Full-text memo search + field filtering with cursor pagination.
 */
router.get('/search', checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const Database = require('../../utils/database');
    const { q, minAmount, maxAmount, startDate, endDate, status, senderPublicKey, recipientPublicKey, limit = 50, cursor } = req.query;

    const parsedLimit = Math.min(parseInt(limit, 10) || 50, 100);
    if (parsedLimit < 1) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_LIMIT', message: 'limit must be >= 1' }
      });
    }

    const parsedMinAmount = minAmount !== undefined ? parseFloat(minAmount) : undefined;
    const parsedMaxAmount = maxAmount !== undefined ? parseFloat(maxAmount) : undefined;

    if (minAmount !== undefined && isNaN(parsedMinAmount)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_MIN_AMOUNT', message: 'minAmount must be a valid number' } });
    }
    if (maxAmount !== undefined && isNaN(parsedMaxAmount)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_MAX_AMOUNT', message: 'maxAmount must be a valid number' } });
    }

    const conditions = [];
    const params = [];

    if (q) { conditions.push('memo LIKE ?'); params.push(`%${q}%`); }
    if (parsedMinAmount !== undefined) { conditions.push('amount >= ?'); params.push(parsedMinAmount); }
    if (parsedMaxAmount !== undefined) { conditions.push('amount <= ?'); params.push(parsedMaxAmount); }
    if (startDate) { conditions.push('timestamp >= ?'); params.push(startDate); }
    if (endDate) { conditions.push('timestamp <= ?'); params.push(endDate); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (senderPublicKey) { conditions.push('sender_public_key = ?'); params.push(senderPublicKey); }
    if (recipientPublicKey) { conditions.push('recipient_public_key = ?'); params.push(recipientPublicKey); }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countResult = await Database.get(
      `SELECT COUNT(*) as total FROM transactions ${whereClause}`,
      params
    );
    const totalCount = countResult?.total || 0;

    const offset = cursor ? parseInt(cursor, 10) : 0;
    const rows = await Database.query(
      `SELECT * FROM transactions ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      [...params, parsedLimit + 1, offset]
    );

    const hasMore = rows.length > parsedLimit;
    const data = rows.slice(0, parsedLimit);
    const nextCursor = hasMore ? offset + parsedLimit : null;

    res.setHeader('X-Total-Count', String(totalCount));
    res.json({
      success: true,
      data,
      pagination: { cursor: offset, nextCursor, hasMore, limit: parsedLimit, total: totalCount }
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/limits ────────────────────────────────────────────────────

/**
 * GET /donations/limits
 * Return the configured minimum and maximum donation amounts.
 * Must be registered before /:id to avoid the param route shadowing it.
 */
router.get('/limits', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res) => {
  const config = require('../../config');
  const crypto = require('crypto');
  const { minAmount, maxAmount, maxDailyPerDonor } = config.donations;

  const limitsData = { minAmount, maxAmount, maxDailyPerDonor, currency: 'XLM' };
  const etag = `"${crypto.createHash('sha256').update(JSON.stringify(limitsData)).digest('hex').slice(0, 32)}"`;

  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && (ifNoneMatch === etag || ifNoneMatch === '*')) {
    return res.status(304).end();
  }

  return res.json({ success: true, data: limitsData });
});

// ─── GET /donations/cost-breakdown ───────────────────────────────────────────

/**
 * GET /donations/cost-breakdown
 * Itemized cost breakdown for a prospective donation amount.
 */
router.get('/cost-breakdown', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { amount, surgeFeeMultiplier, xlmUsdRate } = req.query;

    if (!amount) {
      return res.status(400).json(
        buildErrorResponse([{ code: 'MISSING_AMOUNT', receivedValue: amount }])
      );
    }

    const amountValidation = validateXLMAmount(amount);
    if (!amountValidation.valid) {
      return res.status(422).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`,
      });
    }

    const platformFeePercent = Math.min(
      Math.max(parseFloat(process.env.PLATFORM_FEE_PERCENT || '0') || 0, 0),
      100
    );
    const surgeMultiplier = surgeFeeMultiplier
      ? Math.max(parseFloat(surgeFeeMultiplier) || 1, 1)
      : 1;
    const usdRate = xlmUsdRate ? parseFloat(xlmUsdRate) || 0 : 0;

    const breakdown = calculateCostBreakdown({
      amount: amountValidation.xlm,
      surgeFeeMultiplier: surgeMultiplier,
      platformFeePercent,
      xlmUsdRate: usdRate,
    });

    return res.json({ success: true, data: breakdown });
  } catch (error) {
    next(error);
  }
});

// ─── GET /donations/verify-anonymous ─────────────────────────────────────────

/**
 * GET /donations/verify-anonymous
 * Allow a donor to prove their anonymous donation using their wallet address.
 */
router.get('/verify-anonymous', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const { donationId, walletAddress } = req.query;

    if (!donationId || !walletAddress) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'donationId and walletAddress query parameters are required',
        },
      });
    }

    const result = donationService.verifyAnonymousDonation(donationId, walletAddress);

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ─── POST /donations/verify ───────────────────────────────────────────────────

/**
 * POST /donations/verify
 * Verify a transaction on the Stellar blockchain.
 */
router.post('/verify', verificationRateLimiter, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { transactionHash, donationId, walletAddress } = req.body;

    if (!transactionHash) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_FIELD', message: 'transactionHash is required' },
      });
    }

    let result;
    try {
      result = await donationService.verifyTransaction(transactionHash, donationId);
    } catch (verifyError) {
      if (verifyError.code === 'VERIFICATION_FAILED' || verifyError.errorCode === 'VERIFICATION_FAILED') {
        return res.status(422).json({
          success: false,
          error: { code: 'VERIFICATION_FAILED', message: verifyError.message },
        });
      }
      throw verifyError;
    }

    const isAdmin = req.user && req.user.role === 'admin';
    const isApiKeyClient = Boolean(req.apiKey) || Boolean(req.headers['x-api-key']);
    if (!isAdmin) {
      if (walletAddress) {
        const tx = result.transaction;
        const isOwner = tx && (tx.source === walletAddress || tx.destination === walletAddress);
        if (!isOwner) {
          return res.status(403).json({
            success: false,
            error: { code: 'FORBIDDEN', message: 'You are not authorized to verify this transaction' },
          });
        }
      } else if (!isApiKeyClient) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FIELD', message: 'walletAddress is required' },
        });
      }
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/cross-asset/paths ────────────────────────────────────────

/**
 * GET /donations/cross-asset/paths
 * Preview available DEX conversion paths before committing to a cross-asset donation.
 */
router.get('/cross-asset/paths', requireApiKey, crossAssetPathsSchema, asyncHandler(async (req, res, next) => {
  try {
    const { sourcePublicKey, destPublicKey, destAsset: rawDestAsset, destAmount } = req.query;

    const destAsset = parseAssetInput(rawDestAsset, 'destAsset');
    const paths = await stellarService.findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount);

    if (paths.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: 'NO_PATH_FOUND', message: 'No conversion paths found for the specified assets and amount' },
      });
    }

    return res.status(200).json({ success: true, data: { paths } });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/stats/by-campaign ────────────────────────────────────────

/**
 * GET /donations/stats/by-campaign
 * Aggregate donation statistics per campaign with date filtering and pagination.
 */
router.get('/stats/by-campaign', checkPermission(PERMISSIONS.STATS_READ), asyncHandler(async (req, res, next) => {
  try {
    const Database = require('../../utils/database');
    const { from, to, sort = 'totalRaised', order = 'desc', limit = 20, offset = 0 } = req.query;

    const validSortFields = ['totalRaised', 'donorCount', 'donationCount'];
    if (!validSortFields.includes(sort)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_SORT', message: `Invalid sort field. Valid options: ${validSortFields.join(', ')}` }
      });
    }

    const validOrders = ['asc', 'desc'];
    if (!validOrders.includes(order.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_ORDER', message: 'Order must be "asc" or "desc"' }
      });
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 20, 100);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    let query = `
      SELECT
        c.id as campaignId,
        c.name as campaignName,
        COALESCE(SUM(t.amount), 0) as totalRaised,
        COUNT(DISTINCT t.senderId) as donorCount,
        COUNT(t.id) as donationCount,
        COALESCE(AVG(t.amount), 0) as averageDonation,
        c.goal_amount as goalAmount,
        CASE
          WHEN c.goal_amount > 0 THEN ROUND((COALESCE(SUM(t.amount), 0) / c.goal_amount) * 100, 2)
          ELSE 0
        END as percentComplete,
        MIN(t.timestamp) as firstDonationAt,
        MAX(t.timestamp) as lastDonationAt
      FROM campaigns c
      LEFT JOIN transactions t ON c.id = t.campaign_id
    `;

    const params = [];
    const conditions = [];

    if (from) { conditions.push('t.timestamp >= ?'); params.push(from); }
    if (to) { conditions.push('t.timestamp <= ?'); params.push(to); }
    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');

    query += ` GROUP BY c.id, c.name, c.goal_amount`;
    query += ` HAVING COUNT(t.id) > 0`;
    query += ` ORDER BY ${sort} ${order.toUpperCase()}`;
    query += ` LIMIT ? OFFSET ?`;
    params.push(parsedLimit, parsedOffset);

    const data = await Database.query(query, params);

    let countQuery = `SELECT COUNT(DISTINCT c.id) as total FROM campaigns c LEFT JOIN transactions t ON c.id = t.campaign_id`;
    const countParams = [];
    const countConditions = [];

    if (from) { countConditions.push('t.timestamp >= ?'); countParams.push(from); }
    if (to) { countConditions.push('t.timestamp <= ?'); countParams.push(to); }
    if (countConditions.length > 0) countQuery += ' WHERE ' + countConditions.join(' AND ');
    countQuery += ` GROUP BY c.id HAVING COUNT(t.id) > 0`;

    const countResult = await Database.query(countQuery, countParams);
    const total = countResult.length;

    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ success: true, data, total, limit: parsedLimit, offset: parsedOffset, generatedAt: new Date().toISOString() });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/stats/by-tag ──────────────────────────────────────────────

/**
 * GET /donations/stats/by-tag
 * Aggregate donation statistics per tag (requires startDate and endDate).
 */
router.get('/stats/by-tag', checkPermission(PERMISSIONS.STATS_READ), statsByTagQuerySchema, validateDateRange, asyncHandler(async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);
    const data = StatsService.getTagStats(start, end);

    res.setHeader('Cache-Control', 'public, max-age=60');
    return res.json({
      success: true,
      data,
      metadata: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalTags: data.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/:id ───────────────────────────────────────────────────────

/**
 * GET /donations/:id
 * Get a specific donation by ID with ETag/conditional-GET support.
 */
router.get('/:id', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, (req, res, next) => {
  try {
    const transaction = donationService.getDonationById(req.params.id);

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    const lastModifiedDate = new Date(transaction.statusUpdatedAt || transaction.timestamp);
    const etag = `"${transaction.id}-${lastModifiedDate.getTime()}"`;
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

    const { pushDonationRelated } = require('../../utils/pushHelper');
    pushDonationRelated(req, res, transaction);

    res.json({
      success: true,
      data: applyNotePrivacy(req, transaction)
    });
  } catch (error) {
    next(error);
  }
});

// ─── GET /donations/:id/status (SSE) ─────────────────────────────────────────

/**
 * GET /donations/:id/status
 * Server-Sent Events (SSE) endpoint for real-time donation status updates.
 * Long-lived HTTP connection; auto-closes on terminal state or 5-minute timeout.
 */
router.get('/:id/status', requireApiKey, donationIdParamSchema, asyncHandler(async (req, res, next) => {
  const donationId = req.params.id;

  try {
    const donation = donationService.getDonationById(donationId);

    const isAdmin = req.apiKey?.role === 'admin';
    const userOwns = donation.senderId === req.apiKey?.id || donation.receiverId === req.apiKey?.id;
    if (!isAdmin && !userOwns) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'You do not have permission to stream this donation' },
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write('retry: 3000\n\n');

    const sendStatusUpdate = (status, txHash, ledger) => {
      const event = {
        donationId: donation.id,
        status,
        timestamp: new Date().toISOString(),
      };
      if (txHash) event.txHash = txHash;
      if (ledger) event.ledger = ledger;
      res.write(`event: status_update\ndata: ${JSON.stringify(event)}\n\n`);
    };

    sendStatusUpdate(donation.status, donation.stellar_tx_id, donation.ledger);

    if (donation.status === 'confirmed' || donation.status === 'failed') {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: donation.status })}\n\n`);
      res.end();
      return;
    }

    const keepaliveInterval = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15000);

    const timeoutMs = 5 * 60 * 1000;
    const timeoutTimer = setTimeout(() => {
      res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'timeout', finalStatus: donation.status })}\n\n`);
      res.end();
    }, timeoutMs);

    const statusUpdateHandler = (payload) => {
      if (payload.donationId === donation.id) {
        sendStatusUpdate(payload.status, payload.txHash, payload.ledger);
        if (payload.status === 'confirmed' || payload.status === 'failed') {
          res.write(`event: stream_closed\ndata: ${JSON.stringify({ reason: 'terminal_state', finalStatus: payload.status })}\n\n`);
          res.end();
        }
      }
    };

    donationEvents.on('donation.submitted', statusUpdateHandler);
    donationEvents.on('donation.confirmed', statusUpdateHandler);
    donationEvents.on('donation.failed', statusUpdateHandler);

    req.on('close', () => {
      clearInterval(keepaliveInterval);
      clearTimeout(timeoutTimer);
      donationEvents.off('donation.submitted', statusUpdateHandler);
      donationEvents.off('donation.confirmed', statusUpdateHandler);
      donationEvents.off('donation.failed', statusUpdateHandler);
    });
  } catch (error) {
    next(error);
  }
}));

// ─── GET /donations/:id/timeline ──────────────────────────────────────────────

/**
 * GET /donations/:id/timeline
 * Get the complete lifecycle timeline of a donation.
 */
router.get('/:id/timeline', checkPermission(PERMISSIONS.DONATIONS_READ), donationIdParamSchema, asyncHandler(async (req, res, next) => {
  try {
    const donationId = req.params.id;
    const Database = require('../../utils/database');

    const donation = donationService.getDonationById(donationId);
    if (!donation) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Donation not found' }
      });
    }

    const timeline = [];

    timeline.push({
      timestamp: donation.timestamp,
      event: 'created',
      details: {
        amount: donation.amount,
        donor: donation.donor,
        recipient: donation.recipient,
        memo: donation.memo || null
      }
    });

    try {
      const auditLogs = await Database.query(
        `SELECT * FROM audit_logs
         WHERE resource LIKE ? AND action LIKE 'DONATION_%'
         ORDER BY created_at ASC`,
        [`%${donationId}%`]
      );

      for (const auditLog of auditLogs) {
        if (auditLog.action === 'DONATION_SUBMITTED') {
          timeline.push({ timestamp: auditLog.created_at, event: 'submitted', details: auditLog.details || {} });
        } else if (auditLog.action === 'DONATION_CONFIRMED') {
          timeline.push({ timestamp: auditLog.created_at, event: 'confirmed', details: auditLog.details || {} });
        } else if (auditLog.action === 'DONATION_FAILED') {
          timeline.push({ timestamp: auditLog.created_at, event: 'failed', details: auditLog.details || {} });
        } else if (auditLog.action === 'DONATION_STATUS_CHANGED') {
          timeline.push({ timestamp: auditLog.created_at, event: 'status_changed', details: auditLog.details || {} });
        }
      }
    } catch (_err) {
      // Audit logs table may not exist; continue
    }

    try {
      const refunds = await Database.query(
        `SELECT * FROM refunds WHERE donation_id = ? ORDER BY created_at ASC`,
        [donationId]
      );
      for (const refund of refunds) {
        timeline.push({
          timestamp: refund.created_at,
          event: 'refunded',
          details: { refund_id: refund.id, amount: refund.amount, reason: refund.reason || null, status: refund.status || 'pending' }
        });
      }
    } catch (_err) {
      // Refunds table may not exist; continue
    }

    try {
      const matchingDonations = await Database.query(
        `SELECT md.*, mp.sponsor_wallet_id
         FROM matching_donations md
         JOIN matching_programs mp ON md.matching_program_id = mp.id
         WHERE md.original_donation_id = ?
         ORDER BY md.created_at ASC`,
        [donationId]
      );
      for (const match of matchingDonations) {
        timeline.push({
          timestamp: match.created_at,
          event: 'matched',
          details: { matching_program_id: match.matching_program_id, sponsor_wallet_id: match.sponsor_wallet_id, matched_amount: match.matched_amount }
        });
      }
    } catch (_err) {
      // Matching donations table may not exist; continue
    }

    timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    if (req.markLifecycleStage) {
      req.markLifecycleStage(LIFECYCLE_STAGES.PROCESSED);
    }

    res.json({ success: true, data: timeline });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
