const { bestEffort } = require('../utils/bestEffort');
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
const { isValidStellarPublicKey } = require('../utils/validators');
const { statsRateLimiter } = require('../middleware/rateLimiter');
const donationEvents = require('../events/donationEvents');
const { deprecation } = require('../middleware/deprecation');
const { validateLimit } = require('../utils/pagination');

/** Default number of entries returned by limit-bearing stats routes. */
const STATS_DEFAULT_LIMIT = 10;
/** Maximum number of entries a stats route may return in one response. */
const STATS_MAX_LIMIT = 100;

/**
 * Validate the `limit` query parameter for stats routes (#2110).
 * Accepts integers in [1, STATS_MAX_LIMIT]; defaults to STATS_DEFAULT_LIMIT
 * when omitted. Rejects 0, negatives, non-numeric and oversized values.
 *
 * @param {*} rawLimit - Raw `limit` query value.
 * @returns {{valid: boolean, value?: number, error?: string}}
 */
function parseStatsLimit(rawLimit) {
  return validateLimit(rawLimit, { defaultValue: STATS_DEFAULT_LIMIT, max: STATS_MAX_LIMIT });
}

/**
 * Express middleware rejecting invalid `limit` values with 400 INVALID_LIMIT
 * and storing the validated value on `req.statsLimit`.
 */
function validateStatsLimit(req, res, next) {
  const result = parseStatsLimit(req.query.limit);
  if (!result.valid) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_LIMIT', message: `Invalid limit parameter: ${result.error}` },
    });
  }
  req.statsLimit = result.value;
  return next();
}

// Stats cache TTL in milliseconds — configurable via STATS_CACHE_TTL_SECONDS env var (default: 60s)
const STATS_CACHE_TTL_MS = parseInt(process.env.STATS_CACHE_TTL_SECONDS || '60', 10) * 1000;

// Summary cache TTL — configurable via STATS_SUMMARY_CACHE_TTL_SECONDS (default: 60s)
const SUMMARY_CACHE_TTL_MS = parseInt(process.env.STATS_SUMMARY_CACHE_TTL_SECONDS || '60', 10) * 1000;
const SUMMARY_CACHE_PREFIX = 'stats:summary:';

// Invalidate all summary cache entries when a new donation is created
donationEvents.on(donationEvents.EVENTS.CREATED, () => {
  Cache.clearPrefix(SUMMARY_CACHE_PREFIX);
});

/**
 * Resolve the caller's stats access context from the authenticated request.
 *
 * The HTTP layer is the only place that knows the caller's role and granted
 * permissions, so it must pass them explicitly to StatsService rather than
 * letting the service infer them. This drives the anonymisation serializer:
 * anonymous donors are only revealed to callers holding
 * `stats:read:identified` or an admin role.
 *
 * @param {import('express').Request} req
 * @returns {{ role: string, permissions: string[] }}
 */
function getStatsAccessContext(req) {
  const user = req.user || {};
  const role = user.role || (req.apiKey && req.apiKey.role) || 'anonymous';
  const permissions = Array.isArray(user.permissions)
    ? user.permissions
    : (Array.isArray(req.permissions) ? req.permissions : []);
  return { role, permissions };
}

/**
 * Global stats caching middleware.
 * Caches responses per API key, endpoint, and query parameters.
 */
function globalStatsCache(req, res, next) {
  if (req.method !== 'GET') {
    return next();
  }

  // /dashboard manages its own caching (StatsService.getDashboardData) with a
  // `cached` flag callers rely on and event-driven invalidation. Wrapping it
  // in this generic response cache would mask that flag behind a stale body.
  if (req.path === '/dashboard') {
    return next();
  }

  try {
    const apiKeyId = (req.apiKey && req.apiKey.id) ? req.apiKey.id : req.ip;
    const endpoint = req.path;
    const cacheKey = `stats_cache:${apiKeyId}:${endpoint}:${JSON.stringify(req.query)}`;
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

    next();
  } catch (error) {
    next(error);
  }
}

// Apply globally to all stats routes
router.use(statsRateLimiter);
router.use(globalStatsCache);

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
  }).catch(bestEffort('src/routes/stats.js:177'));
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
      // `from` and `to` are deprecated aliases for `startDate` and `endDate`.
      // They are still accepted for backwards compatibility but will be
      // normalised to `startDate`/`endDate` before the handler runs.
      from: { type: 'dateString', required: false },
      to: { type: 'dateString', required: false },
    },
  },
});

/**
 * Query schema for limit-bearing stats routes: the optional date range plus
 * `limit`. `limit` must be listed here or `validateSchema` strips it before
 * `validateStatsLimit` can see it; range/type checks happen there (#2110).
 */
const leaderboardQuerySchema = validateSchema({
  query: {
    fields: {
      startDate: { type: 'dateString', required: false },
      endDate: { type: 'dateString', required: false },
      from: { type: 'dateString', required: false },
      to: { type: 'dateString', required: false },
      limit: { type: 'string', required: false },
    },
  },
});

/**
 * Middleware that normalises the deprecated `from`/`to` query parameters to
 * `startDate`/`endDate` so the rest of the handler only needs to read one set
 * of names.  `startDate`/`endDate` take precedence when both are supplied.
 */
function normaliseDateAliases(req, _res, next) {
  if (!req.query.startDate && req.query.from) {
    req.query.startDate = req.query.from;
  }
  if (!req.query.endDate && req.query.to) {
    req.query.endDate = req.query.to;
  }
  next();
}

const walletAnalyticsSchema = validateSchema({
  params: {
    fields: {
      walletAddress: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        validate: (value) => isValidStellarPublicKey(value) || 'Invalid Stellar public key format',
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
router.get('/daily', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, cacheMiddleware('stats', 'private'), strictDateRangeQuerySchema, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getDailyStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        startDate,
        endDate,
        totalDays: stats.length,
        generatedAt: new Date().toISOString()
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
router.get('/weekly', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, cacheMiddleware('stats', 'private'), strictDateRangeQuerySchema, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const stats = StatsService.getWeeklyStats(start, end);

    res.json({
      success: true,
      data: stats,
      metadata: {
        startDate,
        endDate,
        totalWeeks: stats.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/summary
 * Get summary analytics
 * Query params: startDate, endDate (ISO format, optional)
 */
router.get('/summary', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const summary = StatsService.getSummary(start, end, access);

    res.json({
      success: true,
      data: summary,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/donors
 * Get donor statistics
 * Query params: startDate, endDate (ISO format, optional)
 */
router.get('/donors', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const stats = StatsService.getDonorStats(start, end, access);

    res.json({
      success: true,
      data: stats,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        totalDonors: stats.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/recipients
 * Get recipient statistics
 * Query params: startDate, endDate (ISO format, optional)
 */
router.get('/recipients', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const stats = StatsService.getRecipientStats(start, end, access);

    res.json({
      success: true,
      data: stats,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        totalRecipients: stats.length,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/leaderboard
 * Get donor leaderboard
 * Query params: startDate, endDate (ISO format, optional), limit (integer 1-100, default 10)
 */
router.get('/leaderboard', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, leaderboardQuerySchema, normaliseDateAliases, validateDateRange, validateStatsLimit, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    const limit = req.statsLimit;

    const access = getStatsAccessContext(req);
    const leaderboard = StatsService.getLeaderboard(start, end, limit, access);

    res.json({
      success: true,
      data: leaderboard,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        limit,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/dashboard
 * Get dashboard data
 */
router.get('/dashboard', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, (req, res, next) => {
  try {
    const access = getStatsAccessContext(req);
    const data = StatsService.getDashboardData(access);

    res.json({
      success: true,
      data,
      metadata: {
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/wallet/:walletAddress
 * Get analytics for a specific wallet
 */
router.get('/wallet/:walletAddress', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, walletAnalyticsSchema, (req, res, next) => {
  try {
    const { walletAddress } = req.params;
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const analytics = StatsService.getWalletAnalytics(walletAddress, start, end, access);

    res.json({
      success: true,
      data: analytics,
      metadata: {
        walletAddress,
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/wallet/:walletAddress/analytics
 * Get detailed analytics for a specific wallet (restored from bd149179).
 * Anonymisation is enforced via getStatsAccessContext for non-admin callers.
 */
router.get('/wallet/:walletAddress/analytics', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, walletAnalyticsSchema, (req, res, next) => {
  try {
    const { walletAddress } = req.params;
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const analytics = StatsService.getWalletAnalytics(walletAddress, start, end, access);

    res.json({
      success: true,
      data: analytics,
      metadata: {
        walletAddress,
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/analytics-fees
 * Get fee analytics (restored from bd149179).
 */
router.get('/analytics-fees', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const fees = StatsService.getFeeAnalytics(start, end, access);

    res.json({
      success: true,
      data: fees,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/memo-collisions
 * Detect memo collisions (restored from bd149179).
 */
router.get('/memo-collisions', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const collisions = StatsService.getMemoCollisions(start, end, access);

    res.json({
      success: true,
      data: collisions,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/overpayments
 * Detect overpayments (restored from bd149179).
 */
router.get('/overpayments', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const overpayments = StatsService.getOverpayments(start, end, access);

    res.json({
      success: true,
      data: overpayments,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/orphaned-transactions
 * Detect orphaned transactions (restored from bd149179).
 */
router.get('/orphaned-transactions', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const orphaned = StatsService.getOrphanedTransactions(start, end, access);

    res.json({
      success: true,
      data: orphaned,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/anonymous-breakdown
 * Get anonymous donation breakdown (restored from bd149179).
 * Non-admin callers receive anonymised data via getStatsAccessContext.
 */
router.get('/anonymous-breakdown', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const breakdown = StatsService.getAnonymousBreakdown(start, end, access);

    res.json({
      success: true,
      data: breakdown,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /stats/impact
 * Get impact statistics (restored from bd149179).
 */
router.get('/impact', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    const access = getStatsAccessContext(req);
    const impact = StatsService.getImpactStats(start, end, access);

    res.json({
      success: true,
      data: impact,
      metadata: {
        startDate: startDate || null,
        endDate: endDate || null,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /stats/cache/invalidate
 * Invalidate stats caches (restored from bd149179).
 * Requires admin-level permission.
 */
router.post('/cache/invalidate', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, (req, res, next) => {
  try {
    Cache.clearPrefix('stats_cache:');
    Cache.clearPrefix(SUMMARY_CACHE_PREFIX);
    res.json({
      success: true,
      data: { invalidated: true },
      metadata: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.parseStatsLimit = parseStatsLimit;
module.exports.validateStatsLimit = validateStatsLimit;
module.exports.STATS_DEFAULT_LIMIT = STATS_DEFAULT_LIMIT;
module.exports.STATS_MAX_LIMIT = STATS_MAX_LIMIT;
