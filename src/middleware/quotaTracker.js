/**
 * Quota Tracker Middleware
 * 
 * RESPONSIBILITY: Track API usage against monthly quotas
 * OWNER: Platform Team
 * 
 * Increments quota usage after successful request processing.
 * Must be placed after apiKey middleware and before route handlers.
 */

const { incrementQuota } = require('../models/apiKeys');
const log = require('../utils/log');

/**
 * Determine whether a request is a read-only list request.
 * These are the hottest read paths (e.g. list-donations) and must not
 * incur any extra latency from quota bookkeeping.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
const isReadListRequest = (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false;
  }
  // List endpoints are collection reads (no resource id segment).
  // e.g. GET /api/donations -> list, GET /api/donations/123 -> single item
  const path = (req.path || req.originalUrl || '').split('?')[0];
  const segments = path.split('/').filter(Boolean);
  // Heuristic: last segment is a collection name (not an id-like token)
  const last = segments[segments.length - 1] || '';
  const looksLikeId = /^[0-9a-f-]{8,}$/i.test(last) || /^\d+$/.test(last);
  return !looksLikeId;
};

/**
 * Fire-and-forget quota increment.
 * Never throws, never blocks the response, never rejects unhandled.
 *
 * @param {string|number} keyId
 */
const incrementQuotaAsync = (keyId) => {
  try {
    const result = incrementQuota(keyId);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => {
        log.error('QUOTA_TRACKER', 'Failed to increment quota', {
          keyId,
          error: error && error.message ? error.message : String(error),
        });
      });
    }
  } catch (error) {
    // Log but don't fail the request
    log.error('QUOTA_TRACKER', 'Failed to increment quota', {
      keyId,
      error: error && error.message ? error.message : String(error),
    });
  }
};

/**
 * Track quota usage for authenticated requests
 * Increments quota counter after response is sent.
 *
 * The increment is scheduled on the 'finish' event (after the response has
 * been flushed) and is fire-and-forget so it never adds latency to the
 * request path. Read-only list requests are skipped entirely to keep the
 * hot read path (list-donations) free of quota bookkeeping overhead.
 */
const trackQuotaUsage = (req, res, next) => {
  // Only track if API key is present and has a quota
  if (req.apiKey && req.apiKey.id && req.apiKey.monthlyQuota) {
    // Skip quota bookkeeping for hot read-only list requests.
    if (isReadListRequest(req)) {
      return next();
    }

    // Increment quota after response is sent (fire-and-forget).
    res.on('finish', () => {
      // Only count successful requests (2xx and 3xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 400) {
        incrementQuotaAsync(req.apiKey.id);
      }
    });
  }

  next();
};

module.exports = trackQuotaUsage;