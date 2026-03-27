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

/**
 * POST /admin/routing/pools
 * Create a new recipient pool.
 * Body: { name: string, recipients?: Array<{id, displayName?, latitude?, longitude?, campaignDeadline?}> }
 */
router.post('/pools', requireApiKey, requireAdmin(), async (req, res, next) => {
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
});

/**
 * GET /admin/routing/pools/:name
 * Get members of a named pool.
 */
router.get('/pools/:name', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const repo = serviceContainer.getRecipientPoolRepo();
    const members = await repo.listMembers(req.params.name);
    res.json({ success: true, data: { name: req.params.name, members } });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/routing/pools/:name/members
 * Add members to an existing pool.
 * Body: { recipients: Array<{id, displayName?, latitude?, longitude?, campaignDeadline?}> }
 */
router.post('/pools/:name/members', requireApiKey, requireAdmin(), async (req, res, next) => {
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
});

/**
 * DELETE /admin/routing/pools/:name/members
 * Remove members from a pool.
 * Body: { recipientIds: string[] }
 */
router.delete('/pools/:name/members', requireApiKey, requireAdmin(), async (req, res, next) => {
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
});

/**
 * DELETE /admin/routing/pools/:name
 * Delete a pool and all its members.
 */
router.delete('/pools/:name', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const repo = serviceContainer.getRecipientPoolRepo();
    await repo.delete(req.params.name);
    res.json({ success: true, data: { name: req.params.name, deleted: true } });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /admin/routing/decisions
 * Query routing decisions.
 * Query params: donationId, poolName, strategy
 */
router.get('/decisions', requireApiKey, requireAdmin(), async (req, res, next) => {
  try {
    const { donationId, poolName, strategy } = req.query;
    const repo = serviceContainer.getRoutingDecisionRepo();

    let decisions;
    if (donationId) {
      decisions = await repo.findByDonationId(donationId);
    } else if (poolName) {
      decisions = await repo.findByPoolName(poolName);
    } else if (strategy) {
      decisions = await repo.findByStrategy(strategy);
    } else {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'At least one filter (donationId, poolName, strategy) is required' },
      });
    }

    res.json({ success: true, count: decisions.length, data: decisions });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
