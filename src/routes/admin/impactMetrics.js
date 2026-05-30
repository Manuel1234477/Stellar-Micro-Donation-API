/**
 * Impact Metrics Admin Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP mapping for admin management of campaign impact metrics
 * OWNER: Backend Team
 * DEPENDENCIES: ImpactMetricService, middleware (auth, validation, RBAC)
 */

const express = require('express');
const router = express.Router();
const ImpactMetricService = require('../../services/ImpactMetricService');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const { validateSchema } = require('../../middleware/schemaValidation');
const log = require('../../utils/log');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

const createImpactMetricSchema = validateSchema({
  body: {
    fields: {
      campaign_id: { type: 'integer', required: true, min: 1 },
      unit: { type: 'string', required: true, maxLength: 100 },
      amount_per_unit: { type: 'number', required: true, min: 0.0000001 },
      description: { type: 'string', required: false, maxLength: 500, nullable: true },
    },
  },
});

/**
 * POST /admin/impact-metrics
 * Create a new impact metric for a campaign.
 */
router.post('/', requireApiKey, requireAdmin(), createImpactMetricSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { campaign_id, unit, amount_per_unit, description } = req.body;

    const metric = await ImpactMetricService.create({
      campaign_id,
      unit,
      amount_per_unit,
      description: description || null,
    });

    log.info('IMPACT_METRICS_ROUTE', 'Impact metric created', { id: metric.id, campaign_id });
    res.status(201).json({ success: true, data: metric });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/impact-metrics
 * List impact metrics, optionally filtered by campaign_id.
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { campaign_id } = req.query;

    let metrics;
    if (campaign_id) {
      metrics = await ImpactMetricService.getByCampaign(parseInt(campaign_id, 10));
    } else {
      const Database = require('../../utils/database');
      metrics = await Database.query('SELECT * FROM impact_metrics ORDER BY campaign_id, amount_per_unit ASC');
    }

    res.json({ success: true, count: metrics.length, data: metrics });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/impact-metrics/:id
 * Get a specific impact metric by ID.
 */
router.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const metric = await ImpactMetricService.getById(parseInt(req.params.id, 10));
    res.json({ success: true, data: metric });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/impact-metrics/dashboard
 * Get impact metrics dashboard with SDG and geographic breakdown
 * 
 * Query params:
 *   - period: 30d (default), 90d, 1y, all
 * 
 * Response includes:
 *   - totalDonations: count of donations
 *   - totalAmountXLM: sum of donation amounts
 *   - uniqueDonors: count of unique donors
 *   - uniqueRecipients: count of unique recipients
 *   - sdgBreakdown: array of { sdgId, sdgName, donationCount, totalAmount }
 *   - geographicDistribution: array of { country, donationCount, totalAmount }
 *   - periodStart, periodEnd: date range
 */
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
let cachedDashboard = null;
let cachedDashboardExpiry = 0;

router.get('/dashboard', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { period = '30d' } = req.query;
    const Database = require('../../utils/database');

    // Check cache
    const now = Date.now();
    if (cachedDashboard && now < cachedDashboardExpiry) {
      return res.json({ success: true, data: cachedDashboard, cached: true });
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (period) {
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'all':
        startDate.setFullYear(1970);
        break;
      case '30d':
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const startIso = startDate.toISOString();
    const endIso = endDate.toISOString();

    // Get basic metrics
    const [
      donationCountResult,
      totalAmountResult,
      uniqueDonorsResult,
      uniqueRecipientsResult
    ] = await Promise.all([
      Database.get(
        `SELECT COUNT(*) as count FROM transactions WHERE timestamp >= ? AND timestamp <= ?`,
        [startIso, endIso]
      ),
      Database.get(
        `SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE timestamp >= ? AND timestamp <= ?`,
        [startIso, endIso]
      ),
      Database.get(
        `SELECT COUNT(DISTINCT sender_public_key) as count FROM transactions WHERE timestamp >= ? AND timestamp <= ?`,
        [startIso, endIso]
      ),
      Database.get(
        `SELECT COUNT(DISTINCT recipient_public_key) as count FROM transactions WHERE timestamp >= ? AND timestamp <= ?`,
        [startIso, endIso]
      )
    ]);

    // Get SDG breakdown (from campaign metadata if available)
    const sdgBreakdown = await Database.query(
      `SELECT 
        COALESCE(c.sdg_category, 'SDG1') as sdgId,
        COUNT(*) as donationCount,
        COALESCE(SUM(t.amount), 0) as totalAmount
       FROM transactions t
       LEFT JOIN campaigns c ON t.campaign_id = c.id
       WHERE t.timestamp >= ? AND t.timestamp <= ?
       GROUP BY COALESCE(c.sdg_category, 'SDG1')
       ORDER BY totalAmount DESC`,
      [startIso, endIso]
    );

    // Map SDG IDs to names
    const sdgMap = {};
    ImpactMetricService.SDG_CATEGORIES.forEach(sdg => {
      sdgMap[sdg.code] = sdg.title;
    });

    const sdgBreakdownWithNames = sdgBreakdown.map(row => ({
      sdgId: row.sdgId,
      sdgName: sdgMap[row.sdgId] || 'Unknown',
      donationCount: row.donationCount,
      totalAmount: row.totalAmount
    }));

    // Get geographic distribution (from wallet metadata if available)
    const geographicDistribution = await Database.query(
      `SELECT 
        COALESCE(w.country, 'Unknown') as country,
        COUNT(*) as donationCount,
        COALESCE(SUM(t.amount), 0) as totalAmount
       FROM transactions t
       LEFT JOIN wallets w ON t.recipient_public_key = w.public_key
       WHERE t.timestamp >= ? AND t.timestamp <= ?
       GROUP BY COALESCE(w.country, 'Unknown')
       ORDER BY totalAmount DESC`,
      [startIso, endIso]
    );

    const dashboard = {
      totalDonations: donationCountResult?.count || 0,
      totalAmountXLM: totalAmountResult?.total || 0,
      uniqueDonors: uniqueDonorsResult?.count || 0,
      uniqueRecipients: uniqueRecipientsResult?.count || 0,
      sdgBreakdown: sdgBreakdownWithNames,
      geographicDistribution,
      periodStart: startIso,
      periodEnd: endIso,
      period
    };

    // Cache the result
    cachedDashboard = dashboard;
    cachedDashboardExpiry = now + CACHE_TTL_MS;

    res.json({ success: true, data: dashboard, cached: false });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
