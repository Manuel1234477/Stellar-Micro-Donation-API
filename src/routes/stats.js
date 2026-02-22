const express = require('express');
const router = express.Router();
const StatsService = require('./services/StatsService');
const { validateDateRange } = require('../middleware/validation');

/**
 * GET /stats/daily
 * Get daily aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/daily', validateDateRange, (req, res) => {
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
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /stats/weekly
 * Get weekly aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/weekly', validateDateRange, (req, res) => {
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
          end: end.toISOString()
        },
        totalWeeks: stats.length,
        aggregationType: 'weekly'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /stats/summary
 * Get overall summary statistics
 * Query params: startDate, endDate (ISO format)
 */
router.get('/summary', validateDateRange, (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getSummaryStats(start, end);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /stats/donors
 * Get aggregated stats by donor
 * Query params: startDate, endDate (ISO format)
 */
router.get('/donors', validateDateRange, (req, res) => {
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
          end: end.toISOString()
        },
        totalDonors: stats.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: error.message
      }
    });
  }
});

/**
 * GET /stats/recipients
 * Get aggregated stats by recipient
 * Query params: startDate, endDate (ISO format)
 */
router.get('/recipients', validateDateRange, (req, res) => {
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
          end: end.toISOString()
        },
        totalRecipients: stats.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FAILED',
        message: error.message
      }
    });
  }
});

module.exports = router;
