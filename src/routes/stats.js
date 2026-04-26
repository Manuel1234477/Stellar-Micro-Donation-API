/**
 * Stats Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for donation statistics and analytics
 * OWNER: Analytics Team
 * DEPENDENCIES: StatsService, middleware (auth, validation, RBAC)
 * 
 * Thin controllers that orchestrate service calls for donation analytics including
 * daily/weekly stats, donor/recipient reports, and summary analytics.
 */

/**
 * @openapi
 * tags:
 *   - name: Statistics
 *     description: Donation analytics and statistics
 *
 * /stats/daily:
 *   get:
 *     tags: [Statistics]
 *     summary: Get daily donation statistics
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Daily stats
 *
 * /stats/weekly:
 *   get:
 *     tags: [Statistics]
 *     summary: Get weekly donation statistics
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Weekly stats
 *
 * /stats/summary:
 *   get:
 *     tags: [Statistics]
 *     summary: Get summary analytics
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Summary analytics
 *
 * /stats/donors:
 *   get:
 *     tags: [Statistics]
 *     summary: Get donor statistics
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Donor stats
 *
 * /stats/recipients:
 *   get:
 *     tags: [Statistics]
 *     summary: Get recipient statistics
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: Recipient stats
 */

const express = require('express');
const router = express.Router();
const StatsService = require('../services/StatsService');
const { validateDateRange } = require('../middleware/validation');
const { checkPermission, requireTier } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { validateSchema } = require('../middleware/schemaValidation');
const AuditLogService = require('../services/AuditLogService');
const asyncHandler = require('../utils/asyncHandler');
const { cacheMiddleware } = require('../middleware/caching');
const Cache = require('../utils/cache');

// Stats cache TTL in milliseconds — configurable via STATS_CACHE_TTL_SECONDS env var (default: 60s)
const STATS_CACHE_TTL_MS = parseInt(process.env.STATS_CACHE_TTL_SECONDS || '60', 10) * 1000;

/**
 * Wrap a stats handler with server-side in-memory caching.
 * Sets X-Cache-Age header and uses Cache.get/set with the given prefix + cache key.
 *
 * @param {string} prefix - Cache key prefix (e.g. 'stats:daily')
 * @param {Function} dataFn - Function that returns the response body object
 * @returns {import('express').RequestHandler}
 */
function withStatsCache(prefix, dataFn) {
  return (req, res, next) => {
    try {
      const cacheKey = `${prefix}:${JSON.stringify(req.query)}`;
      const cached = Cache.get(cacheKey);

      if (cached) {
        const ageSeconds = Math.floor((Date.now() - cached.cachedAt) / 1000);
        res.setHeader('X-Cache-Age', String(ageSeconds));
        return res.json(cached.body);
      }

      // Intercept res.json to store result in cache
      const originalJson = res.json.bind(res);
      res.json = function (body) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          Cache.set(cacheKey, { body, cachedAt: Date.now() }, STATS_CACHE_TTL_MS);
          res.setHeader('X-Cache-Age', '0');
        }
        return originalJson(body);
      };

      dataFn(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

/** Fire-and-forget audit log for stats data access */
function auditStatsAccess(req, res, next) {
  AuditLogService.log({
    category: AuditLogService.CATEGORY.DATA_ACCESS,
    action: 'STATS_ACCESSED',
    severity: AuditLogService.SEVERITY.LOW,
    result: 'SUCCESS',
    userId: req.user && req.user.id,
    requestId: req.id,
    ipAddress: req.ip,
    resource: req.path,
    details: { query: req.query, params: req.params }
  }).catch(() => {});
  next();
}

const strictDateRangeQuerySchema = validateSchema({
  query: {
    fields: {
      startDate: { type: 'dateString', required: true },
      endDate: { type: 'dateString', required: true },
    },
  },
});

const optionalDateRangeQuerySchema = validateSchema({
  query: {
    fields: {
      startDate: { type: 'dateString', required: false },
      endDate: { type: 'dateString', required: false },
      from: { type: 'dateString', required: false },
      to: { type: 'dateString', required: false },
    },
  },
});

const walletAnalyticsSchema = validateSchema({
  params: {
    fields: {
      walletAddress: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
      },
    },
  },
  query: {
    fields: {
      startDate: { type: 'dateString', required: false },
      endDate: { type: 'dateString', required: false },
    },
    validate: (query) => {
      const hasStart = Object.prototype.hasOwnProperty.call(query, 'startDate');
      const hasEnd = Object.prototype.hasOwnProperty.call(query, 'endDate');
      return hasStart === hasEnd
        ? null
        : 'Both startDate and endDate are required when filtering by date';
    },
  },
});

/**
 * GET /stats/tags
 * Get tag aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/tags', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, strictDateRangeQuerySchema, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getTagStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        startDate,
        endDate,
        totalTagsCount: stats.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/daily
 * Get daily aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/daily', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, cacheMiddleware('stats', 'private'), strictDateRangeQuerySchema, validateDateRange, withStatsCache('stats:daily', (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getDailyStats(start, end);

    AuditLogService.log({
      category: AuditLogService.CATEGORY.DATA_ACCESS,
      action: 'STATS_ACCESSED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/stats/daily',
      details: { startDate, endDate }
    }).catch(() => {});

    res.json({
      success: true,
      data: stats,
      metadata: {
        dateRange: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        totalDays: stats.length,
        aggregationType: 'daily'
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /stats/weekly
 * Get weekly aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get(
  "/weekly",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  cacheMiddleware('stats', 'private'),
  strictDateRangeQuerySchema,
  validateDateRange,
  withStatsCache('stats:weekly', (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;
      const start = new Date(startDate);
      const end = new Date(endDate);

      const stats = StatsService.getWeeklyStats(start, end);

      res.json({
        success: true,
        data: stats,
        metadata: {
          dateRange: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          totalWeeks: stats.length,
          aggregationType: "weekly",
        },
      });
    } catch (error) {
      next(error);
    }
  }),
);

/**
 * GET /stats/summary
 * Get overall summary statistics
 * Query params: startDate/endDate or from/to (all optional, ISO format)
 */
router.get(
  "/summary",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  cacheMiddleware('stats', 'private'),
  optionalDateRangeQuerySchema,
  withStatsCache('stats:summary', (req, res, next) => {
    try {
      const fromParam = req.query.from || req.query.startDate;
      const toParam = req.query.to || req.query.endDate;

      let start, end;

      if (fromParam) {
        start = new Date(fromParam);
        if (isNaN(start.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid date format for startDate/from' });
        }
      } else {
        start = new Date(0);
      }

      if (toParam) {
        end = new Date(toParam);
        if (isNaN(end.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid date format for endDate/to' });
        }
      } else {
        end = new Date();
      }

      const stats = StatsService.getSummaryStats(start, end);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }),
);

/**
 * GET /stats/donors
 * Get aggregated stats by donor
 * Query params: startDate, endDate (ISO format)
 */
router.get(
  "/donors",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  strictDateRangeQuerySchema,
  validateDateRange,
  (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;
      const start = new Date(startDate);
      const end = new Date(endDate);

      const stats = StatsService.getDonorStats(start, end);

      res.json({
        success: true,
        data: stats,
        metadata: {
          dateRange: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          totalDonors: stats.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /stats/recipients
 * Get aggregated stats by recipient
 * Query params: startDate, endDate (ISO format)
 */
router.get(
  "/recipients",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  strictDateRangeQuerySchema,
  validateDateRange,
  (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;
      const start = new Date(startDate);
      const end = new Date(endDate);

      const stats = StatsService.getRecipientStats(start, end);

      res.json({
        success: true,
        data: stats,
        metadata: {
          dateRange: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          totalRecipients: stats.length,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * GET /stats/analytics-fees
 * Get analytics fee summary for reporting
 * Query params: startDate, endDate (ISO format)
 */
router.get('/analytics-fees', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, strictDateRangeQuerySchema, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getAnalyticsFeeStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        note: 'Analytics fees are calculated but not deducted on-chain'
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/wallet/:walletAddress/analytics
 * Get donation analytics for a specific wallet
 * Query params: startDate, endDate (optional, ISO format)
 */
router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), requireTier('pro'), walletAnalyticsSchema, (req, res, next) => {
  try {
    const { walletAddress } = req.params;
    const { startDate, endDate } = req.query;

    if (!walletAddress) {
      return res.status(400).json({
        error: 'Missing required parameter: walletAddress'
      });
    }

    let start = null;
    let end = null;

    // If date filtering is requested, validate dates
    if (startDate || endDate) {
      if (!startDate || !endDate) {
        return res.status(400).json({
          error: 'Both startDate and endDate are required for date filtering'
        });
      }

      start = new Date(startDate);
      end = new Date(endDate);

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return res.status(400).json({
          error: 'Invalid date format. Use ISO format (YYYY-MM-DD or ISO 8601)'
        });
      }

      if (start > end) {
        return res.status(400).json({
          error: 'startDate must be before endDate'
        });
      }
    }

    const analytics = StatsService.getWalletAnalytics(walletAddress, start, end);

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    next(error);
  }
});

router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), walletAnalyticsSchema, asyncHandler(async (req, res, next) => {
  try {
    const { walletAddress } = req.params;

    // Trigger the new aggregation logic
    const liveStats = await StatsService.aggregateFromNetwork(walletAddress);

    // Combine with your existing local transaction analytics
    const localAnalytics = StatsService.getWalletAnalytics(walletAddress);

    res.json({
      success: true,
      data: {
        blockchain: liveStats,
        local: localAnalytics
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /stats/memo-collisions
 * Get transactions flagged for memo collision (duplicate memo within time window)
 * Query params: startDate, endDate (optional, ISO format)
 */
router.get('/memo-collisions', checkPermission(PERMISSIONS.STATS_READ), (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && isNaN(start.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid startDate' } });
    }
    if (end && isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid endDate' } });
    }
    if (start && end && start > end) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE_RANGE', message: 'startDate must be before endDate' } });
    }

    const stats = StatsService.getMemoCollisionStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        note: 'Collisions occur when the same memo is used more than once within the detection window',
        ...(start && { startDate: start.toISOString() }),
        ...(end && { endDate: end.toISOString() }),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/overpayments
 * Get all flagged overpayment transactions with excess amounts
 * Query params: startDate, endDate (optional, ISO format)
 */
router.get('/overpayments', checkPermission(PERMISSIONS.STATS_READ), (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    if (start && isNaN(start.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid startDate' } });
    }
    if (end && isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'Invalid endDate' } });
    }
    if (start && end && start > end) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_DATE_RANGE', message: 'startDate must be before endDate' } });
    }

    const stats = StatsService.getOverpaymentStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        note: 'Overpayments occur when received amount exceeds donation + analytics fee',
        ...(start && { startDate: start.toISOString() }),
        ...(end && { endDate: end.toISOString() }),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/orphaned-transactions
 * Get count and total amount of orphaned transactions detected by reconciliation
 */
router.get('/orphaned-transactions', checkPermission(PERMISSIONS.STATS_READ), asyncHandler(async (req, res, next) => {
  try {
    const stats = await StatsService.getOrphanStats();
    res.json({
      success: true,
      data: {
        orphaned_transactions: stats.count,
        totalOrphanedAmount: stats.totalAmount,
      },
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /stats/dashboard
 * Comprehensive analytics dashboard data with configurable time range.
 *
 * Query params:
 *   period       {string}  - Time range: e.g. 7d, 24h, 4w, 3m, 1y (default: 30d)
 *   granularity  {string}  - hourly|daily|weekly|monthly (auto-selected if omitted)
 *   topN         {number}  - Number of top donors/recipients (default: 10)
 */
router.get('/dashboard', checkPermission(PERMISSIONS.STATS_READ), (req, res, next) => {
  try {
    const { period = '30d', granularity, topN, movingAvgWindow } = req.query;

    const topNParsed = topN !== undefined ? parseInt(topN, 10) : 10;
    const windowParsed = movingAvgWindow !== undefined ? parseInt(movingAvgWindow, 10) : 3;

    if (topN !== undefined && (!Number.isInteger(topNParsed) || topNParsed < 1)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PARAM', message: 'topN must be a positive integer' } });
    }
    if (granularity && !['hourly', 'daily', 'weekly', 'monthly'].includes(granularity)) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PARAM', message: 'granularity must be hourly, daily, weekly, or monthly' } });
    }

    const data = StatsService.getDashboardData({ period, granularity, topN: topNParsed, movingAvgWindow: windowParsed });

    res.json({ success: true, data });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PARAM', message: error.message } });
    }
    next(error);
  }
});

/**
 * GET /stats/anonymous-breakdown
 * Get breakdown of anonymous vs identified donations
 *
 * Query params:
 *   startDate {string} - ISO date string (default: 30 days ago)
 *   endDate   {string} - ISO date string (default: now)
 */
router.get('/anonymous-breakdown', checkPermission(PERMISSIONS.STATS_READ), (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: { code: 'INVALID_PARAM', message: 'Invalid date format' } });
    }

    const data = StatsService.getAnonymousBreakdown(start, end);

    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /stats/cache/invalidate
 * Admin endpoint to manually invalidate all stats caches.
 * Requires stats:admin permission.
 */
router.post('/cache/invalidate', checkPermission(PERMISSIONS.STATS_ADMIN), (req, res) => {
  Cache.clearPrefix('stats:');
  Cache.clearPrefix('dashboard:');
  res.json({ success: true, message: 'Stats cache invalidated' });
});

module.exports = router;
