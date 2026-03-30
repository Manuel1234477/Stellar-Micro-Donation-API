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
router.post('/', requireApiKey, requireAdmin(), createImpactMetricSchema, async (req, res, next) => {
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
});

/**
 * GET /admin/impact-metrics
 * List impact metrics, optionally filtered by campaign_id.
 */
router.get('/', requireApiKey, requireAdmin(), async (req, res, next) => {
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
});

/**
 * GET /admin/impact-metrics/:id
 * Get a specific impact metric by ID.
 */
router.get('/:id', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const metric = await ImpactMetricService.getById(parseInt(req.params.id, 10));
    res.json({ success: true, data: metric });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
