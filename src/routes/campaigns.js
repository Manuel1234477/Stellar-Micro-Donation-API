/**
 * Campaign Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP mapping for Campaign resources
 */

const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { validateSchema } = require('../middleware/schemaValidation');
const { validateFloat } = require('../utils/validationHelpers');
const { cacheMiddleware } = require('../middleware/caching');

const createCampaignSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, maxLength: 255 },
      description: { type: 'string', required: false },
      goal_amount: { type: 'number', required: true, min: 1 },
      start_date: { type: 'string', required: false },
      end_date: { type: 'string', required: false },
      funding_model: { type: 'string', required: false, enum: ['all-or-nothing', 'keep-what-you-raise'] }
    }
  }
});

const updateCampaignSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: false, maxLength: 255 },
      description: { type: 'string', required: false },
      goal_amount: { type: 'number', required: false, min: 1 },
      end_date: { type: 'string', required: false },
      status: { type: 'string', required: false, enum: ['active', 'paused', 'completed', 'cancelled'] }
    }
  }
});

/**
 * POST /campaigns
 * Creates a new donation campaign natively tracking goals.
 */
router.post('/', requireApiKey, checkPermission(PERMISSIONS.ADMIN), createCampaignSchema, async (req, res, next) => {
  try {
    const { name, description, goal_amount, start_date, end_date, funding_model } = req.body;
    
    // Explicit numeric validation bridging
    const goalValidation = validateFloat(goal_amount);
    if (!goalValidation.valid) {
      return res.status(400).json({ success: false, error: 'Goal Amount must be a valid number' });
    }

    const model = funding_model || 'keep-what-you-raise';

    const dbResult = await Database.run(
      `INSERT INTO campaigns (name, description, goal_amount, current_amount, start_date, end_date, created_by, status, funding_model)
       VALUES (?, ?, ?, 0, ?, ?, ?, 'active', ?)`,
      [
        name,
        description || null,
        goalValidation.value,
        start_date || new Date().toISOString(),
        end_date || null,
        req.user ? req.user.id : null,
        model
      ]
    );

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [dbResult.id]);
    res.status(201).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns
 * Retrieves active/all campaigns dynamically.
 */
router.get('/', cacheMiddleware('campaign', 'public'), async (req, res, next) => {
  try {
    let query = 'SELECT * FROM campaigns';
    let params = [];
    const { status } = req.query;

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY createdAt DESC LIMIT 100';

    const campaigns = await Database.query(query, params);

    // Auto-update expired campaigns logically
    const now = new Date();
    for (let c of campaigns) {
      if (c.status === 'active' && c.end_date && new Date(c.end_date) < now) {
        await Database.run(`UPDATE campaigns SET status = 'completed' WHERE id = ?`, [c.id]);
        c.status = 'completed';
      }
    }

    res.status(200).json({ success: true, count: campaigns.length, data: campaigns });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id
 * Retrieve a specific campaign securely.
 */
router.get('/:id', cacheMiddleware('campaign', 'public'), async (req, res, next) => {
  try {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [req.params.id]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    res.status(200).json({ success: true, data: campaign });
  } catch (error) {
    next(error);
  }
});

/**
 * PATCH /campaigns/:id
 * Update metrics or pause/complete campaigns inherently.
 */
router.patch('/:id', requireApiKey, checkPermission(PERMISSIONS.ADMIN), updateCampaignSchema, async (req, res, next) => {
  try {
    const id = req.params.id;
    const updates = req.body;
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No update fields provided' });
    }

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    let setClauses = [];
    let params = [];

    for (const [key, value] of Object.entries(updates)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }

    setClauses.push('updatedAt = CURRENT_TIMESTAMP');
    params.push(id);

    await Database.run(
      `UPDATE campaigns SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    const updated = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id/donations
 * Retrieves all donations mapped to a specific campaign securely.
 */
router.get('/:id/donations', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Explicit SQLite mapping matching our initDB logic 
    const transactions = await Database.query(
      'SELECT id, amount, senderId, receiverId, timestamp, stellar_tx_id FROM transactions WHERE campaign_id = ? ORDER BY timestamp DESC LIMIT 50',
      [id]
    );

    res.status(200).json({ success: true, count: transactions.length, data: transactions });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id/impact
 * Returns the aggregate impact summary for a campaign based on its total donations
 * and defined impact metrics.
 */
router.get('/:id/impact', async (req, res, next) => {
  try {
    const ImpactMetricService = require('../services/ImpactMetricService');
    const summary = await ImpactMetricService.calculateCampaignImpact(parseInt(req.params.id, 10));
    res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id/progress/stream
 * Server-Sent Events (SSE) endpoint for real-time campaign progress updates.
 * 
 * Connection string for clients:
 *   const eventSource = new EventSource('/api/campaigns/:id/progress/stream', {
 *     headers: { 'X-API-Key': 'your-api-key' }
 *   });
 *   eventSource.addEventListener('progress_update', (e) => {
 *     const data = JSON.parse(e.data);
 *     console.log(`Progress: ${data.progress_percentage}% (${data.current_amount}/${data.goal_amount})`);
 *   });
 * 
 * Event types:
 *   - progress_update: Sent whenever a donation is received (shows current progress)
 *   - milestone_reached: Sent when a milestone (25%, 50%, 75%, 100%) is reached
 *   - goal_reached: Sent when the campaign goal is fully reached
 */
router.get('/:id/progress/stream', requireApiKey, async (req, res, next) => {
  const log = require('../utils/log');
  const { v4: uuidv4 } = require('uuid');
  const SseManager = require('../services/SseManager');
  const DonationService = require('../services/DonationService');
  const donationEvents = require('../events/donationEvents');
  
  const campaignId = req.params.id;
  const clientId = uuidv4();
  const keyId = req.user?.id || req.headers['x-api-key'] || 'anonymous';

  // Verify campaign exists
  try {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }
  } catch (error) {
    return next(error);
  }

  // Check connection limit
  if (SseManager.connectionCount(keyId) >= SseManager.MAX_CONNECTIONS_PER_KEY) {
    return res.status(429).json({
      success: false,
      error: `Too many connections for this API key. Maximum: ${SseManager.MAX_CONNECTIONS_PER_KEY}`
    });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering in nginx
  res.setHeader('Access-Control-Allow-Origin', '*');

  log.info('SSE', `Campaign progress stream connected: ${clientId}`, { campaignId, keyId });

  // Send initial state
  try {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    const progressPercentage = Math.round((campaign.current_amount / campaign.goal_amount) * 100);
    
    const initialData = {
      event: 'initial',
      data: {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        goal_amount: campaign.goal_amount,
        current_amount: campaign.current_amount,
        progress_percentage: progressPercentage,
        status: campaign.status,
        timestamp: new Date().toISOString()
      }
    };
    
    res.write(`data: ${JSON.stringify(initialData.data)}\n\n`);
  } catch (error) {
    log.error('SSE', 'Failed to send initial state', { campaignId, error: error.message });
  }

  // Heartbeat to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (error) {
      log.warn('SSE', 'Failed to send heartbeat', { clientId, error: error.message });
      clearInterval(heartbeatInterval);
    }
  }, SseManager.HEARTBEAT_INTERVAL_MS);

  // Listen for progress updates and milestone events
  const progressHandler = async () => {
    try {
      const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
      if (!campaign) return;

      const progressPercentage = Math.round((campaign.current_amount / campaign.goal_amount) * 100);
      
      const data = {
        campaign_id: campaignId,
        campaign_name: campaign.name,
        goal_amount: campaign.goal_amount,
        current_amount: campaign.current_amount,
        progress_percentage: progressPercentage,
        status: campaign.status,
        timestamp: new Date().toISOString()
      };

      res.write(`event: progress_update\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      log.error('SSE', 'Failed to send progress update', { campaignId, error: error.message });
    }
  };

  const milestoneHandler = (data) => {
    if (data.campaign_id === parseInt(campaignId)) {
      try {
        res.write(`event: milestone_reached\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        log.error('SSE', 'Failed to send milestone event', { campaignId, error: error.message });
      }
    }
  };

  // Note: In a production system, you'd use a proper message queue or event bus
  // For now, we'll use the DonationService's event system
  donationEvents.registerHook('campaign.goal_reached', (data) => {
    if (data.campaign_id === parseInt(campaignId)) {
      try {
        res.write(`event: goal_reached\ndata: ${JSON.stringify(data)}\n\n`);
      } catch (error) {
        log.error('SSE', 'Failed to send goal_reached event', { campaignId, error: error.message });
      }
    }
  });

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    SseManager.removeClient(clientId);
    log.info('SSE', `Campaign progress stream disconnected: ${clientId}`, { campaignId });
  });

  req.on('error', (error) => {
    clearInterval(heartbeatInterval);
    SseManager.removeClient(clientId);
    log.error('SSE', 'Client connection error', { clientId, error: error.message });
  });

  // Add client to SSE manager
  const filter = { campaignId };
  SseManager.addClient(clientId, keyId, filter, res);
});

// ─── All-or-Nothing Crowdfunding Routes ──────────────────────────────────────

const CrowdfundingService = require('../services/CrowdfundingService');

/**
 * POST /campaigns/:id/pledge
 * Pledge a donation to an all-or-nothing campaign (held in escrow).
 * Body: { donor_id: number, amount: number }
 */
router.post('/:id/pledge', requireApiKey, async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const { donor_id, amount } = req.body;

    if (!donor_id || typeof donor_id !== 'number') {
      return res.status(400).json({ success: false, error: 'donor_id must be a number' });
    }
    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid || amountValidation.value <= 0) {
      return res.status(400).json({ success: false, error: 'amount must be a positive number' });
    }

    const result = await CrowdfundingService.pledge(campaignId, donor_id, amountValidation.value);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    next(error);
  }
});

/**
 * POST /campaigns/:id/settle
 * Settle a campaign: release funds if goal met, refund all donors otherwise.
 * Idempotent — safe to call multiple times.
 */
router.post('/:id/settle', requireApiKey, checkPermission(PERMISSIONS.ADMIN), async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const result = await CrowdfundingService.settle(campaignId);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    next(error);
  }
});

/**
 * GET /campaigns/:id/escrow
 * Get escrow state: all pledges, total held, goal met status.
 */
router.get('/:id/escrow', requireApiKey, async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const state = await CrowdfundingService.getEscrowState(campaignId);
    res.status(200).json({ success: true, data: state });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, error: error.message });
    next(error);
  }
});

module.exports = router;

// ─── Milestone Routes ─────────────────────────────────────────────────────────

/**
 * POST /campaigns/:id/milestones
 * Create a milestone for a campaign.
 * Body: { title, description, target_amount }
 */
router.post('/:id/milestones', requireApiKey, checkPermission(PERMISSIONS.ADMIN), async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const { title, description, target_amount } = req.body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: 'title is required' });
    }

    const amountValidation = validateFloat(target_amount);
    if (!amountValidation.valid || amountValidation.value <= 0) {
      return res.status(400).json({ success: false, error: 'target_amount must be a positive number' });
    }

    const campaign = await Database.get('SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const result = await Database.run(
      `INSERT INTO campaign_milestones (campaign_id, title, description, target_amount)
       VALUES (?, ?, ?, ?)`,
      [campaignId, title.trim(), description || null, amountValidation.value]
    );

    const milestone = await Database.get('SELECT * FROM campaign_milestones WHERE id = ?', [result.id]);
    res.status(201).json({ success: true, data: milestone });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id/milestones
 * List all milestones for a campaign with completion status.
 */
router.get('/:id/milestones', requireApiKey, async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);

    const campaign = await Database.get('SELECT id FROM campaigns WHERE id = ? AND deleted_at IS NULL', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const milestones = await Database.query(
      'SELECT * FROM campaign_milestones WHERE campaign_id = ? ORDER BY target_amount ASC',
      [campaignId]
    );

    res.json({ success: true, data: milestones, count: milestones.length });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /admin/campaigns/:id/milestones/:milestoneId/verify
 * Admin verifies a milestone, triggering fund release.
 */
router.post('/admin/:id/milestones/:milestoneId/verify', requireApiKey, checkPermission(PERMISSIONS.ADMIN), async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const milestoneId = parseInt(req.params.milestoneId, 10);

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const milestone = await Database.get(
      'SELECT * FROM campaign_milestones WHERE id = ? AND campaign_id = ?',
      [milestoneId, campaignId]
    );
    if (!milestone) {
      return res.status(404).json({ success: false, error: 'Milestone not found' });
    }

    if (milestone.status === 'verified') {
      return res.status(409).json({ success: false, error: 'Milestone already verified' });
    }

    const verifiedBy = req.user ? String(req.user.id) : 'admin';

    // Mark milestone as verified
    await Database.run(
      `UPDATE campaign_milestones
       SET status = 'verified', verified_at = CURRENT_TIMESTAMP, verified_by = ?
       WHERE id = ?`,
      [verifiedBy, milestoneId]
    );

    // Simulate fund release: record a claimable balance release note
    // In production this would trigger an on-chain claimable balance claim
    const fundReleaseTx = `mock_release_${Date.now()}_milestone_${milestoneId}`;
    await Database.run(
      'UPDATE campaign_milestones SET fund_release_tx = ? WHERE id = ?',
      [fundReleaseTx, milestoneId]
    );

    const updated = await Database.get('SELECT * FROM campaign_milestones WHERE id = ?', [milestoneId]);

    res.json({
      success: true,
      message: `Milestone verified. Funds of ${milestone.target_amount} XLM released to campaign owner.`,
      data: { milestone: updated, fundReleaseTx },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /campaigns/:id/progress
 * Returns total raised, milestone completion, and remaining amount.
 */
router.get('/:id/progress', requireApiKey, async (req, res, next) => {
  try {
    const campaignId = parseInt(req.params.id, 10);

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [campaignId]);
    if (!campaign) {
      return res.status(404).json({ success: false, error: 'Campaign not found' });
    }

    const milestones = await Database.query(
      'SELECT * FROM campaign_milestones WHERE campaign_id = ? ORDER BY target_amount ASC',
      [campaignId]
    );

    const totalMilestones = milestones.length;
    const verifiedMilestones = milestones.filter(m => m.status === 'verified').length;
    const totalReleased = milestones
      .filter(m => m.status === 'verified')
      .reduce((sum, m) => sum + m.target_amount, 0);

    const progressPct = campaign.goal_amount > 0
      ? Math.min(100, Math.round((campaign.current_amount / campaign.goal_amount) * 100))
      : 0;

    res.json({
      success: true,
      data: {
        campaignId,
        name: campaign.name,
        goalAmount: campaign.goal_amount,
        currentAmount: campaign.current_amount,
        remaining: Math.max(0, campaign.goal_amount - campaign.current_amount),
        progressPercent: progressPct,
        status: campaign.status,
        milestones: {
          total: totalMilestones,
          verified: verifiedMilestones,
          pending: totalMilestones - verifiedMilestones,
          totalReleased,
          items: milestones,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
