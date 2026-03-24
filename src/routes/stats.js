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

const express = require('express');
const router = express.Router();
const StatsService = require('../services/StatsService');
const { validateDateRange } = require('../middleware/validation');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { validateSchema } = require('../middleware/schemaValidation');
const AuditLogService = require('../services/AuditLogService');

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
 * GET /stats/daily
 * Get daily aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/daily', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, strictDateRangeQuerySchema, validateDateRange, (req, res) => {
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
});

/**
 * GET /stats/weekly
 * Get weekly aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get(
  "/weekly",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  strictDateRangeQuerySchema,
  validateDateRange,
  (req, res, next) => {
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
  },
);

/**
 * GET /stats/summary
 * Get overall summary statistics
 * Query params: startDate, endDate (ISO format)
 */
router.get(
  "/summary",
  checkPermission(PERMISSIONS.STATS_READ),
  auditStatsAccess,
  strictDateRangeQuerySchema,
  validateDateRange,
  (req, res, next) => {
    try {
      const { startDate, endDate } = req.query;
      const start = new Date(startDate);
      const end = new Date(endDate);

      const stats = StatsService.getSummaryStats(start, end);

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  },
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
router.get('/analytics-fees', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, strictDateRangeQuerySchema, validateDateRange, (req, res) => {
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
router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), walletAnalyticsSchema, (req, res) => {
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

router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), walletAnalyticsSchema, async (req, res) => {
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
});

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
router.get('/orphaned-transactions', checkPermission(PERMISSIONS.STATS_READ), async (req, res, next) => {
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
});

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

module.exports = router;
