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

module.exports = router;
