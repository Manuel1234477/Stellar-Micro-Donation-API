'use strict';

/**
 * Admin API Key Usage Analytics Dashboard (#1554)
 *
 * GET /admin/api-keys/:id/analytics
 *
 * Aggregates records tracked by ApiKeyUsageService (backed by the
 * api_key_usage table) for a single API key: hourly + daily breakdowns
 * (total volume, per-status-code error counts, avg latency), top endpoints,
 * peak hourly request rate, and rate-limit proximity flags (>= 80% of the
 * key's configured rate_limit_per_minute in any hourly bucket).
 *
 * Query params:
 *   from, to - ISO date strings or ms timestamps (optional; defaults to the
 *              service's retention window / now)
 */

const express = require('express');
const { requireAdmin } = require('../../middleware/rbac');
const requireApiKey = require('../../middleware/apiKey');
const { getApiKeyById } = require('../../models/apiKeys');
const { instance: usageService } = require('../../services/ApiKeyUsageService');
const { NotFoundError, ValidationError, ERROR_CODES } = require('../../utils/errors');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();

/**
 * GET /admin/api-keys/:id/analytics
 */
router.get('/:id/analytics', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
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

  const analytics = usageService.getDashboardAnalyticsByPrefix(key.keyPrefix, {
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
