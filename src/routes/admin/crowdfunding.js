/**
 * Admin Crowdfunding Campaign Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP mapping for admin management of crowdfunding campaigns
 * OWNER: Backend Team
 * DEPENDENCIES: CrowdfundingService, Database, middleware (auth, validation, RBAC)
 *
 * Endpoints:
 *   GET    /admin/crowdfunding/campaigns              — list all campaigns with status & progress
 *   POST   /admin/crowdfunding/campaigns              — create a new campaign with milestones
 *   PATCH  /admin/crowdfunding/campaigns/:id          — update name, description, deadline, or goal
 *   POST   /admin/crowdfunding/campaigns/:id/close    — close campaign and trigger milestone payouts
 *   GET    /admin/crowdfunding/campaigns/:id/milestones — list milestones with reached/unreached status
 */

'use strict';

const express = require('express');
const router = express.Router();
const AdminCrowdfundingService = require('../../services/AdminCrowdfundingService');
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const { validateSchema } = require('../../middleware/schemaValidation');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const log = require('../../utils/log');

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createCampaignSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, maxLength: 255 },
      description: { type: 'string', required: false },
      goal: { type: 'number', required: true, min: 0.0000001 },
      deadline: { type: 'string', required: true },
      recipientPublicKey: { type: 'string', required: true, maxLength: 56 },
    }
  }
});

const updateCampaignSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: false, maxLength: 255 },
      description: { type: 'string', required: false },
      deadline: { type: 'string', required: false },
      goal: { type: 'number', required: false, min: 0.0000001 },
    }
  }
});

// ─── GET /admin/crowdfunding/campaigns ────────────────────────────────────────

/**
 * List all campaigns with status and progress.
 * Query params: status (active|closed|all), limit, offset
 */
router.get('/campaigns', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { status, limit = 100, offset = 0 } = req.query;
    const campaigns = await AdminCrowdfundingService.listCampaigns({ status, limit: parseInt(limit, 10), offset: parseInt(offset, 10) });
    res.json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    log.error('ADMIN_CROWDFUNDING', 'Failed to list campaigns', { error: error.message });
    next(error);
  }
}));

// ─── POST /admin/crowdfunding/campaigns ───────────────────────────────────────

/**
 * Create a new campaign with optional milestones.
 * Body: { name, description, goal, deadline, recipientPublicKey, milestones?: [{ amount, description }] }
 */
router.post('/campaigns', requireApiKey, requireAdmin(), createCampaignSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { name, description, goal, deadline, recipientPublicKey, milestones } = req.body;

    const campaign = await AdminCrowdfundingService.createCampaign({
      name,
      description,
      goal,
      deadline,
      recipientPublicKey,
      milestones: milestones || [],
      createdBy: req.user ? req.user.id : null,
    });

    log.info('ADMIN_CROWDFUNDING', 'Campaign created', { campaignId: campaign.id, name });
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    log.error('ADMIN_CROWDFUNDING', 'Failed to create campaign', { error: error.message });
    next(error);
  }
}));

// ─── PATCH /admin/crowdfunding/campaigns/:id ──────────────────────────────────

/**
 * Update campaign details: name, description, deadline, or goal.
 * Cannot update a closed campaign.
 */
router.patch('/campaigns/:id', requireApiKey, requireAdmin(), updateCampaignSchema, payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description, deadline, goal } = req.body;

    const updated = await AdminCrowdfundingService.updateCampaign(id, { name, description, deadline, goal });

    log.info('ADMIN_CROWDFUNDING', 'Campaign updated', { campaignId: id });
    res.json({ success: true, data: updated });
  } catch (error) {
    log.error('ADMIN_CROWDFUNDING', 'Failed to update campaign', { error: error.message });
    next(error);
  }
}));

// ─── POST /admin/crowdfunding/campaigns/:id/close ─────────────────────────────

/**
 * Close a campaign and trigger milestone payouts for all reached milestones.
 * Idempotent — closing an already-closed campaign returns the existing state.
 */
router.post('/campaigns/:id/close', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await AdminCrowdfundingService.closeCampaign(id);

    log.info('ADMIN_CROWDFUNDING', 'Campaign closed', { campaignId: id, milestonesTriggered: result.milestonesTriggered });
    res.json({ success: true, data: result });
  } catch (error) {
    log.error('ADMIN_CROWDFUNDING', 'Failed to close campaign', { error: error.message });
    next(error);
  }
}));

// ─── GET /admin/crowdfunding/campaigns/:id/milestones ─────────────────────────

/**
 * List milestones for a campaign with reached/unreached status derived from
 * the campaign's current_amount vs each milestone's target_amount.
 */
router.get('/campaigns/:id/milestones', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await AdminCrowdfundingService.getMilestonesWithStatus(id);
    res.json({ success: true, count: result.milestones.length, data: result.milestones, campaign: result.campaign });
  } catch (error) {
    log.error('ADMIN_CROWDFUNDING', 'Failed to list milestones', { error: error.message });
    next(error);
  }
}));

module.exports = router;
