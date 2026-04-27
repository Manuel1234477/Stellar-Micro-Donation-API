/**
 * Admin Database Monitoring Routes
 *
 * RESPONSIBILITY: Admin-only visibility into database query performance
 * OWNER: Backend Team
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const Database = require('../../utils/database');
const { createRateLimiter } = require('../../middleware/rateLimiter');

const dbStatsRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.apiKey?.id || req.ip,
});

// Known application tables
const KNOWN_TABLES = [
  'users', 'transactions', 'recurring_donations', 'campaigns',
  'api_keys', 'audit_logs', 'refresh_tokens', 'geo_rules',
  'donation_velocity', 'student_fees', 'fee_payments',
  'recovery_guardians', 'recovery_requests', 'recovery_approvals',
  'recurring_donation_executions', 'recipient_velocity_limits',
];

// 60-second in-memory cache
let statsCache = null;
let statsCacheExpiry = 0;

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
 * GET /admin/db/pool-status
 * Returns current connection pool metrics (issue #631).
 */
router.get('/pool-status', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const status = Database.getPoolStatus();
  res.json({ success: true, data: status });
});

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

/**
 * GET /admin/db/query-stats
 * Returns aggregate query performance statistics including p95 and p99 latency.
 */
router.get('/query-stats', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const stats = Database.getQueryStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/db/stats
 * Returns comprehensive database statistics. Cached for 60 seconds.
 * ?refresh=true bypasses the cache.
 */
router.get('/stats', dbStatsRateLimiter, checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const now = Date.now();
    const bypass = req.query.refresh === 'true';

    if (!bypass && statsCache && now < statsCacheExpiry) {
      res.setHeader('Cache-Control', 'max-age=60');
      return res.json({ success: true, data: statsCache });
    }

    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data/stellar_donations.db');

    // File sizes
    let fileSizeBytes = 0;
    let walFileSizeBytes = 0;
    try { fileSizeBytes = fs.statSync(dbPath).size; } catch (_) {}
    try { walFileSizeBytes = fs.statSync(dbPath + '-wal').size; } catch (_) {}

    // PRAGMA info
    const [pageCountRow, pageSizeRow, journalRow] = await Promise.all([
      Database.get('PRAGMA page_count'),
      Database.get('PRAGMA page_size'),
      Database.get('PRAGMA journal_mode'),
    ]);

    // Table row counts in parallel
    const tableCounts = await Promise.all(
      KNOWN_TABLES.map(async (name) => {
        try {
          const row = await Database.get(`SELECT COUNT(*) AS n FROM ${name}`);
          return { name, rowCount: row ? row.n : 0 };
        } catch (_) {
          return null; // table doesn't exist yet
        }
      })
    );

    const perf = Database.getPerformanceMetrics();
    const pool = Database.getPoolStatus();

    const generatedAt = new Date().toISOString();
    const cachedUntil = new Date(now + 60000).toISOString();

    const data = {
      database: {
        fileSizeBytes,
        fileSizeMB: Number((fileSizeBytes / 1048576).toFixed(2)),
        pageSize: pageSizeRow ? pageSizeRow.page_size : null,
        pageCount: pageCountRow ? pageCountRow.page_count : null,
        walFileSizeBytes,
        journalMode: journalRow ? journalRow.journal_mode : null,
      },
      tables: tableCounts.filter(Boolean),
      performance: {
        slowQueryCount: perf.slowQueryCount,
        slowQueryThresholdMs: perf.thresholdMs,
        averageQueryTimeMs: perf.averageQueryTimeMs,
        totalQueriesExecuted: perf.totalQueries,
      },
      pool: {
        activeConnections: pool.active,
        idleConnections: pool.idle,
        maxConnections: pool.poolMax,
        waitingRequests: pool.waiting,
      },
      generatedAt,
      cachedUntil,
    };

    statsCache = data;
    statsCacheExpiry = now + 60000;

    res.setHeader('Cache-Control', 'max-age=60');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
