const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { VALID_FREQUENCIES, SCHEDULE_STATUS } = require('../constants');
const log = require('../utils/log');

/**
 * POST /stream/create
 * Create a recurring donation schedule
 */
router.post('/create', checkPermission(PERMISSIONS.STREAM_CREATE), async (req, res) => {
  try {
    const { donorPublicKey, recipientPublicKey, amount, frequency } = req.body;

    // Validate required fields
    if (!donorPublicKey || !recipientPublicKey || !amount || !frequency) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: donorPublicKey, recipientPublicKey, amount, frequency'
      });
    }

    // Validate amount
    if (isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be a positive number'
      });
    }

    // Validate frequency
    if (!VALID_FREQUENCIES.includes(frequency.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `Frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`
      });
    }

    // Check if donor exists
    const donor = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [donorPublicKey]
    );

    if (!donor) {
      return res.status(404).json({
        success: false,
        error: 'Donor wallet not found'
      });
    }

    // Check if recipient exists
    const recipient = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [recipientPublicKey]
    );

    if (!recipient) {
      return res.status(404).json({
        success: false,
        error: 'Recipient wallet not found'
      });
    }

    // Prevent self-donations
    if (donor.id === recipient.id) {
      return res.status(400).json({
        success: false,
        error: 'Donor and recipient cannot be the same'
      });
    }

    // Calculate next execution date based on frequency
    const now = new Date();
    const nextExecutionDate = new Date(now);
    
    switch (frequency.toLowerCase()) {
      case 'daily':
        nextExecutionDate.setDate(nextExecutionDate.getDate() + 1);
        break;
      case 'weekly':
        nextExecutionDate.setDate(nextExecutionDate.getDate() + 7);
        break;
      case 'monthly':
        nextExecutionDate.setMonth(nextExecutionDate.getMonth() + 1);
        break;
    }

    // Insert recurring donation schedule
    const result = await Database.run(
      `INSERT INTO recurring_donations 
       (donorId, recipientId, amount, frequency, nextExecutionDate, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donor.id, recipient.id, parseFloat(amount), frequency.toLowerCase(), nextExecutionDate.toISOString(), SCHEDULE_STATUS.ACTIVE]
    );

    // Fetch the created schedule
    const schedule = await Database.get(
      `SELECT 
        rd.id,
        rd.amount,
        rd.frequency,
        rd.startDate,
        rd.nextExecutionDate,
        rd.status,
        rd.executionCount,
        donor.publicKey as donorPublicKey,
        recipient.publicKey as recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id
       WHERE rd.id = ?`,
      [result.id]
    );

    res.status(201).json({
      success: true,
      message: 'Recurring donation schedule created successfully',
      data: {
        scheduleId: schedule.id,
        donor: schedule.donorPublicKey,
        recipient: schedule.recipientPublicKey,
        amount: schedule.amount,
        frequency: schedule.frequency,
        nextExecution: schedule.nextExecutionDate,
        status: schedule.status,
        executionCount: schedule.executionCount
      }
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to create recurring donation', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to create recurring donation schedule',
      message: error.message
    });
  }
});

/**
 * GET /stream/schedules
 * Get all recurring donation schedules
 */
router.get('/schedules', checkPermission(PERMISSIONS.STREAM_READ), async (req, res) => {
  try {
    const schedules = await Database.query(
      `SELECT 
        rd.id,
        rd.amount,
        rd.frequency,
        rd.startDate,
        rd.nextExecutionDate,
        rd.lastExecutionDate,
        rd.status,
        rd.executionCount,
        donor.publicKey as donorPublicKey,
        recipient.publicKey as recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id
       ORDER BY rd.createdAt DESC`
    );

    res.json({
      success: true,
      data: schedules,
      count: schedules.length
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to fetch recurring donation schedules', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recurring donation schedules',
      message: error.message
    });
  }
});

/**
 * GET /stream/schedules/:id
 * Get a specific recurring donation schedule
 */
router.get('/schedules/:id', checkPermission(PERMISSIONS.STREAM_READ), async (req, res) => {
  try {
    const schedule = await Database.get(
      `SELECT 
        rd.id,
        rd.amount,
        rd.frequency,
        rd.startDate,
        rd.nextExecutionDate,
        rd.lastExecutionDate,
        rd.status,
        rd.executionCount,
        donor.publicKey as donorPublicKey,
        recipient.publicKey as recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id
       WHERE rd.id = ?`,
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    res.json({
      success: true,
      data: schedule
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to fetch recurring donation schedule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule',
      message: error.message
    });
  }
});

/**
 * DELETE /stream/schedules/:id
 * Cancel a recurring donation schedule
 */
router.delete('/schedules/:id', checkPermission(PERMISSIONS.STREAM_DELETE), async (req, res) => {
  try {
    const schedule = await Database.get(
      'SELECT id, status FROM recurring_donations WHERE id = ?',
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    await Database.run(
      'UPDATE recurring_donations SET status = ? WHERE id = ?',
      ['cancelled', req.params.id]
    );

    res.json({
      success: true,
      message: 'Recurring donation schedule cancelled successfully'
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to cancel recurring donation schedule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to cancel schedule',
      message: error.message
    });
  }
});

module.exports = router;
