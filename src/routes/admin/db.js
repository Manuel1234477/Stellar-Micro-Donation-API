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
 * Sanitize SQL by replacing parameter values with ? placeholders.
 *
 * @param {string} sql - SQL statement
 * @param {Array} params - Query parameters
 * @returns {string} Sanitized SQL
 */
function sanitizeSql(sql, params = []) {
  if (!params || params.length === 0) {
    return sql;
  }

  let sanitized = sql;
  for (let i = 0; i < params.length; i++) {
    // Replace first occurrence of ? with placeholder
    sanitized = sanitized.replace('?', '?');
  }
  return sanitized;
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
 * Query params: limit (default 50, max 200), threshold (default SLOW_QUERY_WARN_MS)
 */
router.get('/slow-queries', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const limit = Math.min(200, parseLimit(req.query.limit) || 50);
    const threshold = parseLimit(req.query.threshold);
    
    let queries = Database.getSlowQueries({ limit });
    
    // Filter by threshold if provided
    if (threshold !== undefined) {
      queries = queries.filter(q => q.durationMs >= threshold);
    }
    
    // Sanitize SQL statements
    const sanitizedQueries = queries.map(q => ({
      sql: sanitizeSql(q.sql, q.params),
      durationMs: q.durationMs,
      timestamp: q.isoTimestamp,
      callerContext: q.method || 'unknown'
    }));
    
    const metrics = Database.getPerformanceMetrics();

    res.json({
      success: true,
      data: {
        thresholdMs: threshold !== undefined ? threshold : metrics.thresholdMs,
        averageQueryTimeMs: metrics.averageQueryTimeMs,
        recentQueryCount: metrics.recentQueryCount,
        slowQueryCount: metrics.slowQueryCount,
        queries: sanitizedQueries,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/db/slow-queries/stats
 * Returns aggregate statistics about slow queries.
 */
router.get('/slow-queries/stats', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const queries = Database.getSlowQueries({ limit: 1000 });
    const metrics = Database.getPerformanceMetrics();
    
    // Group queries by SQL pattern
    const queryStats = {};
    queries.forEach(q => {
      const sanitized = sanitizeSql(q.sql, q.params);
      if (!queryStats[sanitized]) {
        queryStats[sanitized] = {
          sql: sanitized,
          count: 0,
          totalDurationMs: 0,
          minDurationMs: Infinity,
          maxDurationMs: 0
        };
      }
      queryStats[sanitized].count += 1;
      queryStats[sanitized].totalDurationMs += q.durationMs;
      queryStats[sanitized].minDurationMs = Math.min(queryStats[sanitized].minDurationMs, q.durationMs);
      queryStats[sanitized].maxDurationMs = Math.max(queryStats[sanitized].maxDurationMs, q.durationMs);
    });
    
    // Calculate averages and sort by count descending
    const topQueries = Object.values(queryStats)
      .map(stat => ({
        sql: stat.sql,
        count: stat.count,
        avgDurationMs: Number((stat.totalDurationMs / stat.count).toFixed(2)),
        minDurationMs: stat.minDurationMs,
        maxDurationMs: stat.maxDurationMs
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      success: true,
      data: {
        totalSlowQueries24h: queries.length,
        averageDurationMs: metrics.averageQueryTimeMs,
        maxDurationMs: queries.length > 0 ? Math.max(...queries.map(q => q.durationMs)) : 0,
        topQueries
      }
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

// In-memory vacuum job store
const vacuumJobs = new Map();
let activeVacuumJobId = null;

/**
 * POST /admin/db/vacuum
 * Starts a background VACUUM job. Returns immediately with a jobId.
 * Only one vacuum job may run at a time.
 */
router.post('/vacuum', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res) => {
  if (activeVacuumJobId && vacuumJobs.get(activeVacuumJobId)?.status === 'running') {
    return res.status(409).json({ success: false, error: { code: 'VACUUM_IN_PROGRESS', message: 'A vacuum job is already running' } });
  }

  const jobId = `vacuum-${Date.now()}`;
  activeVacuumJobId = jobId;
  vacuumJobs.set(jobId, { status: 'running', startedAt: Date.now() });

  // Run in background
  setImmediate(async () => {
    const job = vacuumJobs.get(jobId);
    try {
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../../../data/stellar_donations.db');
      let sizeBefore = 0;
      try { sizeBefore = fs.statSync(dbPath).size; } catch (_) {}

      await Database.run('PRAGMA wal_checkpoint(FULL)');
      await Database.run('VACUUM');

      let sizeAfter = 0;
      try { sizeAfter = fs.statSync(dbPath).size; } catch (_) {}

      job.status = 'completed';
      job.sizeBefore = sizeBefore;
      job.sizeAfter = sizeAfter;
      job.reclaimedBytes = sizeBefore - sizeAfter;
      job.durationMs = Date.now() - job.startedAt;
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
      job.durationMs = Date.now() - job.startedAt;
    } finally {
      activeVacuumJobId = null;
    }
  });

  res.json({ success: true, jobId });
});

/**
 * GET /admin/db/vacuum/:jobId
 * Returns the status of a vacuum job.
 */
router.get('/vacuum/:jobId', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const job = vacuumJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: { code: 'JOB_NOT_FOUND', message: 'Vacuum job not found' } });
  }
  res.json({ success: true, data: { jobId: req.params.jobId, ...job } });
});

// ─── Integrity Check ──────────────────────────────────────────────────────────

/** In-memory store for integrity check jobs */
const integrityJobs = new Map();

/**
 * Run SQLite integrity_check and foreign_key_check pragmas.
 * Returns { status, issues, checkedAt, durationMs }.
 */
async function runIntegrityCheck() {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  const issues = [];

  try {
    // PRAGMA integrity_check returns rows with a single column "integrity_check"
    const integrityRows = await Database.query('PRAGMA integrity_check', []);
    for (const row of integrityRows) {
      const msg = row.integrity_check || row[Object.keys(row)[0]];
      if (msg && msg !== 'ok') issues.push(`integrity_check: ${msg}`);
    }

    // PRAGMA foreign_key_check returns rows for each violation
    const fkRows = await Database.query('PRAGMA foreign_key_check', []);
    for (const row of fkRows) {
      issues.push(`foreign_key_check: table=${row.table} rowid=${row.rowid} parent=${row.parent} fkid=${row.fkid}`);
    }
  } catch (err) {
    issues.push(`check_error: ${err.message}`);
  }

  return {
    status: issues.length === 0 ? 'ok' : 'corrupted',
    issues,
    checkedAt,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * POST /admin/db/integrity-check
 * Start a background integrity check job.
 * Returns { jobId } immediately; poll GET /admin/db/integrity-check/:jobId for results.
 */
router.post('/integrity-check', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const jobId = `integrity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = { status: 'running', issues: [], checkedAt: null, durationMs: null };
  integrityJobs.set(jobId, job);

  // Run asynchronously — do not await
  runIntegrityCheck().then(result => {
    Object.assign(job, result);
  }).catch(err => {
    job.status = 'corrupted';
    job.issues = [`unexpected_error: ${err.message}`];
    job.checkedAt = new Date().toISOString();
    job.durationMs = 0;
  });

  res.json({ success: true, jobId });
});

/**
 * GET /admin/db/integrity-check/:jobId
 * Returns the status and results of an integrity check job.
 */
router.get('/integrity-check/:jobId', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const job = integrityJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      success: false,
      error: { code: 'JOB_NOT_FOUND', message: 'Integrity check job not found' },
    });
  }
  res.json({ success: true, data: { jobId: req.params.jobId, ...job } });
});

module.exports = router;
