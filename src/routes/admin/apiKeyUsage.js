'use strict';

/**
 * Admin API Key Usage Analytics
 *
 * GET /admin/api-keys/usage
 *
 * Returns per-key usage statistics for all API keys.
 * Joins database key metadata with in-memory usage records from ApiKeyUsageService.
 *
 * Query params:
 *   period  - '24h' | '7d' | '30d'  (default: '24h')
 */

const express = require('express');
const { requireAdmin } = require('../../middleware/rbac');
const requireApiKey = require('../../middleware/apiKey');
const { listApiKeys } = require('../../models/apiKeys');
const { instance: usageService } = require('../../services/ApiKeyUsageService');

const router = express.Router();

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
router.get('/', requireApiKey, requireAdmin(), async (req, res) => {
  try {
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
    const allTrackedKeys = Array.from(usageService._records.keys());

    const result = keys.map(key => {
      // Find all raw keys in the usage service that start with this key's prefix
      const matchingRawKeys = allTrackedKeys.filter(k => k.startsWith(key.keyPrefix));

      // Aggregate records across all matching raw keys within the period
      let requestCount = 0;
      let errorCount = 0;
      let lastUsedAt = null;
      const endpointCounts = new Map();

      for (const rawKey of matchingRawKeys) {
        const records = usageService._records.get(rawKey) || [];
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
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
