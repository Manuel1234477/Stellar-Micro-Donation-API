/**
 * Admin Routing Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP endpoints for managing recipient pools and querying routing decisions
 * OWNER: Backend Team
 * DEPENDENCIES: RecipientPoolRepository, RoutingDecisionRepository, middleware
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../../middleware/apiKey');
const { requireAdmin } = require('../../middleware/rbac');
const serviceContainer = require('../../config/serviceContainer');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

/**
 * POST /admin/routing/pools
 * Create a new recipient pool.
 * Body: { name: string, recipients?: Array<{id, displayName?, latitude?, longitude?, campaignDeadline?}> }
 */
router.post('/pools', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { name, recipients = [] } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
    }
    const repo = serviceContainer.getRecipientPoolRepo();
    await repo.create(name, recipients);
    res.status(201).json({ success: true, data: { name } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/routing/pools/:name
 * Get members of a named pool.
 */
router.get('/pools/:name', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const repo = serviceContainer.getRecipientPoolRepo();
    const members = await repo.listMembers(req.params.name);
    res.json({ success: true, data: { name: req.params.name, members } });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/routing/pools/:name/members
 * Add members to an existing pool.
 * Body: { recipients: Array<{id, displayName?, latitude?, longitude?, campaignDeadline?}> }
 */
router.post('/pools/:name/members', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { recipients } = req.body;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'recipients must be a non-empty array' } });
    }
    const repo = serviceContainer.getRecipientPoolRepo();
    const rrRepo = serviceContainer.getRoundRobinStateRepo();
    await repo.addMembers(req.params.name, recipients, rrRepo);
    res.json({ success: true, data: { name: req.params.name, added: recipients.length } });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /admin/routing/pools/:name/members
 * Remove members from a pool.
 * Body: { recipientIds: string[] }
 */
router.delete('/pools/:name/members', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { recipientIds } = req.body;
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'recipientIds must be a non-empty array' } });
    }
    const repo = serviceContainer.getRecipientPoolRepo();
    const rrRepo = serviceContainer.getRoundRobinStateRepo();
    await repo.removeMembers(req.params.name, recipientIds, rrRepo);
    res.json({ success: true, data: { name: req.params.name, removed: recipientIds.length } });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /admin/routing/pools/:name
 * Delete a pool and all its members.
 */
router.delete('/pools/:name', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const repo = serviceContainer.getRecipientPoolRepo();
    await repo.delete(req.params.name);
    res.json({ success: true, data: { name: req.params.name, deleted: true } });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /admin/routing/strategies
 * Set the active routing strategy for a pool.
 * Body: { poolName: string, strategy: string }
 */
router.post('/strategies', requireApiKey, requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { poolName, strategy } = req.body;
    if (!poolName || !strategy) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'poolName and strategy are required' },
      });
    }
    const VALID_STRATEGIES = ['round-robin', 'weighted', 'priority', 'highest-need', 'geographic', 'campaign-urgency'];
    if (!VALID_STRATEGIES.includes(strategy)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: `strategy must be one of: ${VALID_STRATEGIES.join(', ')}` },
      });
    }
    const configRepo = serviceContainer.getRoutingConfigRepo();
    await configRepo.setStrategy(poolName, strategy);
    res.json({ success: true, data: { poolName, strategy } });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/routing/strategies
 * Retrieve current routing strategy configuration.
 * Query params: poolName (optional — if omitted, returns all)
 */
router.get('/strategies', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const configRepo = serviceContainer.getRoutingConfigRepo();
    if (req.query.poolName) {
      const config = await configRepo.getStrategy(req.query.poolName);
      if (!config) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `No strategy configured for pool '${req.query.poolName}'` },
        });
      }
      return res.json({ success: true, data: config });
    }
    const configs = await configRepo.listAll();
    res.json({ success: true, count: configs.length, data: configs });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/routing/decisions
 * Query routing decisions with optional filters and pagination.
 * Query params: donationId, poolName, strategy, page (default 1), limit (default 20)
 */
router.get('/decisions', requireApiKey, requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const { donationId, poolName, strategy } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const repo = serviceContainer.getRoutingDecisionRepo();

    let decisions;
    if (donationId) {
      decisions = await repo.findByDonationId(donationId);
    } else if (poolName) {
      decisions = await repo.findByPoolName(poolName);
    } else if (strategy) {
      decisions = await repo.findByStrategy(strategy);
    } else {
      decisions = await repo.findAll();
    }

    const total = decisions.length;
    const offset = (page - 1) * limit;
    const paged = decisions.slice(offset, offset + limit);

    res.json({
      success: true,
      count: paged.length,
      total,
      page,
      limit,
      data: paged,
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
