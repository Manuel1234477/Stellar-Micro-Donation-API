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

const createCampaignSchema = validateSchema({
  body: {
    fields: {
      name: { type: 'string', required: true, maxLength: 255 },
      description: { type: 'string', required: false },
      goal_amount: { type: 'number', required: true, min: 1 },
      start_date: { type: 'string', required: false },
      end_date: { type: 'string', required: false }
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
    const { name, description, goal_amount, start_date, end_date } = req.body;
    
    // Explicit numeric validation bridging
    const goalValidation = validateFloat(goal_amount);
    if (!goalValidation.valid) {
      return res.status(400).json({ success: false, error: 'Goal Amount must be a valid number' });
    }

    const dbResult = await Database.run(
      `INSERT INTO campaigns (name, description, goal_amount, current_amount, start_date, end_date, created_by, status)
       VALUES (?, ?, ?, 0, ?, ?, ?, 'active')`,
      [
        name,
        description || null,
        goalValidation.value,
        start_date || new Date().toISOString(),
        end_date || null,
        req.user ? req.user.id : null
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
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status;
    let query = 'SELECT * FROM campaigns';
    let params = [];

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
router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    
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

module.exports = router;
