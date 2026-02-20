const express = require('express');
const router = express.Router();
const StatsService = require('./services/StatsService');

/**
 * GET /stats/daily
 * Get daily aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/daily', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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
      error: 'Failed to retrieve daily stats',
      message: error.message
    });
  }
});

/**
 * GET /stats/weekly
 * Get weekly aggregated donation volume
 * Query params: startDate, endDate (ISO format)
 */
router.get('/weekly', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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
      error: 'Failed to retrieve weekly stats',
      message: error.message
    });
  }
});

/**
 * GET /stats/summary
 * Get overall summary statistics
 * Query params: startDate, endDate (ISO format)
 */
router.get('/summary', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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

    const stats = StatsService.getSummaryStats(start, end);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve summary stats',
      message: error.message
    });
  }
});

/**
 * GET /stats/donors
 * Get aggregated stats by donor
 * Query params: startDate, endDate (ISO format)
 */
router.get('/donors', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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
      error: 'Failed to retrieve donor stats',
      message: error.message
    });
  }
});

/**
 * GET /stats/recipients
 * Get aggregated stats by recipient
 * Query params: startDate, endDate (ISO format)
 */
router.get('/recipients', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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
      error: 'Failed to retrieve recipient stats',
      message: error.message
    });
  }
});

/**
 * GET /stats/analytics-fees
 * Get analytics fee summary for reporting
 * Query params: startDate, endDate (ISO format)
 */
router.get('/analytics-fees', (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        error: 'Missing required query parameters: startDate, endDate (ISO format)'
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

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

    const stats = StatsService.getAnalyticsFeeStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        note: 'Analytics fees are calculated but not deducted on-chain'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to retrieve analytics fee stats',
      message: error.message
    });
  }
});

module.exports = router;
