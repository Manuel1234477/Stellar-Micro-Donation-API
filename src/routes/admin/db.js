/**
 * Admin Database Monitoring Routes
 *
 * RESPONSIBILITY: Admin-only visibility into database query performance
 * OWNER: Backend Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const Database = require('../../utils/database');

/**
 * Parse an optional positive integer limit query parameter.
 *
 * @param {string|undefined} rawLimit - Raw limit query parameter.
 * @returns {number|undefined} Parsed limit or undefined when omitted.
 * @throws {Error} When limit is not a positive integer.
 */
function parseLimit(rawLimit) {
  if (rawLimit === undefined) {
    return undefined;
  }

  if (typeof rawLimit !== 'string' || !/^[1-9]\d*$/.test(rawLimit)) {
    const error = new Error('limit must be a positive integer');
    error.name = 'ValidationError';
    error.status = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const limit = Number.parseInt(rawLimit, 10);
  return limit;
}

/**
 * GET /admin/db/slow-queries
 * Returns the slowest queries captured during the last 24 hours.
 */
router.get('/slow-queries', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const limit = parseLimit(req.query.limit);
    const queries = Database.getSlowQueries({ limit });
    const metrics = Database.getPerformanceMetrics();

    res.json({
      success: true,
      data: {
        thresholdMs: metrics.thresholdMs,
        averageQueryTimeMs: metrics.averageQueryTimeMs,
        recentQueryCount: metrics.recentQueryCount,
        slowQueryCount: metrics.slowQueryCount,
        queries,
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
