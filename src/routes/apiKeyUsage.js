/**
 * API Key Usage Analytics Routes (#1554, #1778)
 *
 * The single route module for API key usage and analytics.
 *
 * module.exports (mounted at /api/v1/api-keys):
 *   GET /:id/usage                 - Summary stats for a key
 *   GET /:id/usage/timeseries      - Time-series data (granularity: hour|day|week)
 *   GET /:id/usage/anomalies       - Anomaly detection results
 *   GET /:id/analytics[/summary|/dashboard] - Owner-or-admin analytics
 *
 * module.exports.adminRouter (mounted at /admin/api-keys, admin only):
 *   GET /usage                     - Usage for every key (period, sortBy, paging)
 *   GET /:id/analytics             - Dashboard for one key by DB id, with key
 *                                    metadata and rate-limit proximity flags
 *
 * Replaces the former routes/admin/apiKeyUsage.js and
 * routes/admin/apiKeyAnalytics.js. Both routers read the same
 * ApiKeyUsageService instance (swappable in tests via setUsageService).
 */

const express = require('express');
const ApiKeyUsageService = require('../services/ApiKeyUsageService');
const requireApiKey = require('../middleware/apiKey');
const { validateInteger } = require('../utils/validationHelpers');
const { requireAdmin } = require('../middleware/rbac');
const { listApiKeys, getApiKeyById } = require('../models/apiKeys');
const { NotFoundError, ValidationError, ERROR_CODES } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// Allow tests to inject a custom service instance
let _service = ApiKeyUsageService.instance;
const setUsageService = (svc) => { _service = svc; };

const requireApiKeyOwnerOrAdmin = (req, res, next) => {
  const keyId = String(req.params.id);

  if (req.user && req.user.role === 'admin') {
    return next();
  }

  if (req.apiKey && String(req.apiKey.id) === keyId) {
    return next();
  }

  if (req.user && req.user.authMethod === 'jwt' && String(req.user.subject) === keyId) {
    return next();
  }

  return res.status(403).json({ success: false, error: 'Access denied' });
};

/**
 * GET /api-keys/:id/usage
 * Returns overall summary for the given API key.
 */
router.get('/:id/usage', (req, res) => {
  try {
    const summary = _service.getSummary(req.params.id);
    return res.json({ success: true, data: summary });
  } catch (err) {
    const status = err.message.includes('required') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.get('/:id/analytics', requireApiKey, requireApiKeyOwnerOrAdmin, (req, res) => {
  try {
    const validation = validateInteger(req.params.id, { min: 1 });
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const from = req.query.from ? new Date(req.query.from).getTime() : undefined;
    const to = req.query.to ? new Date(req.query.to).getTime() : undefined;
    if ((req.query.from && isNaN(from)) || (req.query.to && isNaN(to))) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
    }

    const analytics = _service.getAnalytics(req.params.id, { from, to });
    return res.json({ success: true, data: analytics });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

router.get('/:id/analytics/summary', requireApiKey, requireApiKeyOwnerOrAdmin, (req, res) => {
  try {
    const validation = validateInteger(req.params.id, { min: 1 });
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const from = req.query.from ? new Date(req.query.from).getTime() : undefined;
    const to = req.query.to ? new Date(req.query.to).getTime() : undefined;
    if ((req.query.from && isNaN(from)) || (req.query.to && isNaN(to))) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
    }

    const summary = _service.getAnalyticsSummary(req.params.id, { from, to });
    return res.json({ success: true, data: summary });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api-keys/:id/analytics/dashboard
 * Full dashboard analytics (#1554): hourly + daily breakdowns with
 * per-status-code error counts, top endpoints, and peak hourly request rate.
 */
router.get('/:id/analytics/dashboard', requireApiKey, requireApiKeyOwnerOrAdmin, (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from).getTime() : undefined;
    const to = req.query.to ? new Date(req.query.to).getTime() : undefined;
    if ((req.query.from && isNaN(from)) || (req.query.to && isNaN(to))) {
      return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
    }

    const dashboard = _service.getDashboardAnalytics(req.params.id, { from, to });
    return res.json({ success: true, data: dashboard });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api-keys/:id/usage/timeseries
 * Query params:
 *   granularity  - 'hour' | 'day' | 'week'  (required)
 *   from         - ISO date string or ms timestamp (optional)
 *   to           - ISO date string or ms timestamp (optional)
 */
router.get('/:id/usage/timeseries', (req, res) => {
  const { granularity, from, to } = req.query;

  if (!granularity) {
    return res.status(400).json({ success: false, error: 'granularity query param is required (hour|day|week)' });
  }

  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();

  if (isNaN(fromMs) || isNaN(toMs)) {
    return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
  }

  try {
    const series = _service.getTimeSeries(req.params.id, granularity, { from: fromMs, to: toMs });
    return res.json({ success: true, data: series, count: series.length });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

/**
 * GET /api-keys/:id/usage/anomalies
 * Query params:
 *   granularity  - 'hour' | 'day' | 'week'  (required)
 *   multiplier   - std-dev multiplier (optional, default 2)
 *   from / to    - date range (optional)
 */
router.get('/:id/usage/anomalies', (req, res) => {
  const { granularity, multiplier, from, to } = req.query;

  if (!granularity) {
    return res.status(400).json({ success: false, error: 'granularity query param is required (hour|day|week)' });
  }

  const fromMs = from ? new Date(from).getTime() : 0;
  const toMs   = to   ? new Date(to).getTime()   : Date.now();
  const mult   = multiplier ? parseFloat(multiplier) : 2;

  if (isNaN(fromMs) || isNaN(toMs)) {
    return res.status(400).json({ success: false, error: 'Invalid from/to date format' });
  }

  try {
    const result = _service.detectAnomalies(req.params.id, granularity, { multiplier: mult, from: fromMs, to: toMs });
    return res.json({ success: true, data: result });
  } catch (err) {
    const status = err.message.includes('required') || err.message.includes('Invalid') ? 400 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
});

// ─── Admin endpoints (/admin/api-keys) ────────────────────────────────────────
const adminRouter = express.Router();

const PERIOD_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const VALID_SORT_FIELDS = ['requestCount', 'errorRate', 'lastUsedAt'];
const DEFAULT_PAGE_SIZE = 20;

/**
 * GET /admin/api-keys/usage
 */
adminRouter.get('/usage', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const period = req.query.period || '24h';
  if (!PERIOD_MS[period]) {
    return res.status(400).json({
      success: false,
      error: `Invalid period. Must be one of: ${Object.keys(PERIOD_MS).join(', ')}`,
    });
  }

  const sortBy = req.query.sortBy || 'requestCount';
  if (!VALID_SORT_FIELDS.includes(sortBy)) {
    return res.status(400).json({
      success: false,
      error: `Invalid sortBy. Must be one of: ${VALID_SORT_FIELDS.join(', ')}`,
    });
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));

  const now = Date.now();
  const from = now - PERIOD_MS[period];

  // Fetch all keys from DB
  const keys = await listApiKeys();

  // For each key, look up usage records by key prefix
  // The usage service stores records by raw API key string.
  // We match by iterating all tracked keys and finding those whose prefix matches.
  const allTrackedKeys = Array.from(_service._records.keys());

  const result = keys.map(key => {
    // Find all raw keys in the usage service that start with this key's prefix
    const matchingRawKeys = allTrackedKeys.filter(k => k.startsWith(key.keyPrefix));

    // Aggregate records across all matching raw keys within the period
    let requestCount = 0;
    let errorCount = 0;
    let lastUsedAt = null;
    const endpointCounts = new Map();

    for (const rawKey of matchingRawKeys) {
      const records = _service._records.get(rawKey) || [];
      for (const record of records) {
        if (record.timestamp < from || record.timestamp > now) continue;
        requestCount++;
        if (record.statusCode >= 400) errorCount++;
        if (!lastUsedAt || record.timestamp > lastUsedAt) lastUsedAt = record.timestamp;

        const epKey = `${record.method} ${record.path}`;
        endpointCounts.set(epKey, (endpointCounts.get(epKey) || 0) + 1);
      }
    }

    // Top 5 endpoints by request count
    const topEndpoints = Array.from(endpointCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([endpoint, count]) => {
        const [method, ...pathParts] = endpoint.split(' ');
        return { endpoint: pathParts.join(' '), method, requestCount: count };
      });

    const errorRate = requestCount > 0
      ? Math.round((errorCount / requestCount) * 10000) / 100
      : 0;

    const lastUsedAtIso = lastUsedAt
      ? new Date(lastUsedAt).toISOString()
      : (key.last_used_at ? new Date(key.last_used_at).toISOString() : null);

    return {
      keyId: key.id,
      keyName: key.name,
      keyPrefix: key.keyPrefix,
      role: key.role,
      status: key.status,
      requestCount,
      errorCount,
      errorRate,
      lastUsedAt: lastUsedAtIso,
      topEndpoints,
      createdAt: key.created_at ? new Date(key.created_at).toISOString() : null,
      expiresAt: key.expires_at ? new Date(key.expires_at).toISOString() : null,
    };
  });

  // Sort
  result.sort((a, b) => {
    if (sortBy === 'requestCount') return b.requestCount - a.requestCount;
    if (sortBy === 'errorRate') return b.errorRate - a.errorRate;
    if (sortBy === 'lastUsedAt') {
      const aMs = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bMs = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return bMs - aMs;
    }
    return 0;
  });

  // Paginate
  const totalKeys = result.length;
  const totalPages = Math.ceil(totalKeys / pageSize) || 1;
  const offset = (page - 1) * pageSize;
  const paginatedKeys = result.slice(offset, offset + pageSize);

  return res.json({
    success: true,
    data: {
      period,
      from: new Date(from).toISOString(),
      to: new Date(now).toISOString(),
      sortBy,
      keys: paginatedKeys,
      pagination: {
        page,
        pageSize,
        totalKeys,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    },
  });
}));

/**
 * GET /admin/api-keys/:id/analytics
 */
adminRouter.get('/:id/analytics', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new ValidationError('API key id must be an integer', null, ERROR_CODES.INVALID_REQUEST);
  }

  const key = await getApiKeyById(id);
  if (!key) {
    throw new NotFoundError('API key not found', ERROR_CODES.NOT_FOUND);
  }

  const from = req.query.from ? new Date(req.query.from).getTime() : undefined;
  const to = req.query.to ? new Date(req.query.to).getTime() : undefined;
  if ((req.query.from && isNaN(from)) || (req.query.to && isNaN(to))) {
    throw new ValidationError('Invalid from/to date format', null, ERROR_CODES.INVALID_DATE_FORMAT);
  }

  const analytics = _service.getDashboardAnalyticsByPrefix(key.keyPrefix, {
    from,
    to,
    rateLimitPerMinute: key.rateLimitPerMinute ?? null,
  });

  res.json({
    success: true,
    data: {
      keyId: key.id,
      keyName: key.name,
      keyPrefix: key.keyPrefix,
      ...analytics,
    },
  });
}));

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.setUsageService = setUsageService;
