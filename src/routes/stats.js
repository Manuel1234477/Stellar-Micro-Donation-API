/**
 * Stats Routes
 * Thin controllers that orchestrate service calls
 * All business logic delegated to StatsService
 */

const express = require('express');
const router = express.Router();
const StatsService = require('../services/StatsService');
const { validateDateRange } = require('../middleware/validation');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');

/**
 * GET /stats/daily
 * Get daily aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/daily', checkPermission(PERMISSIONS.STATS_READ), validateDateRange, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getDailyStats(start, end);

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
router.get('/analytics-fees', checkPermission(PERMISSIONS.STATS_READ), validateDateRange, (req, res) => {
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
router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), (req, res) => {
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

router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), async (req, res) => {
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

module.exports = router;
