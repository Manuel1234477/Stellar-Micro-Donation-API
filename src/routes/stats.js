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
      // `from` and `to` are deprecated aliases for `startDate` and `endDate`.
      // They are still accepted for backwards compatibility but will be
      // normalised to `startDate`/`endDate` before the handler runs.
      from: { type: 'dateString', required: false },
      to: { type: 'dateString', required: false },
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
 * Query params: startDate, endDate (ISO format, optional), limit
 */
router.get('/leaderboard', checkPermission(PERMISSIONS.STATS_READ), auditStatsAccess, optionalDateRangeQuerySchema, normaliseDateAliases, validateDateRange, (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;

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

module.exports = router;
