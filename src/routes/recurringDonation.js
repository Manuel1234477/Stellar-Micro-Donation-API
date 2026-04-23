/**
 * Recurring Donation Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for recurring donation CRUD and history
 * OWNER: Backend Team
 * DEPENDENCIES: Database, RecurringDonationScheduler, middleware (auth, RBAC)
 *
 * Endpoints:
 *   POST   /donations/recurring              – create a schedule
 *   GET    /donations/recurring              – list all schedules
 *   GET    /donations/recurring/:id          – get one schedule
 *   DELETE /donations/recurring/:id          – cancel a schedule
 *   GET    /donations/recurring/:id/history  – execution history
 */

const express = require('express');
const router = express.Router();
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { VALID_FREQUENCIES, SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const {
  validateRequiredFields,
  validateFloat,
  validateEnum,
  validateInteger,
} = require('../utils/validationHelpers');
const log = require('../utils/log');
const serviceContainer = require('../config/serviceContainer');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

// ─────────────────────────────────────────────────────────────────────────────
// POST /donations/recurring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /donations/recurring
 * @desc    Create a new recurring donation schedule
 * @access  stream:create
 *
 * @body {string}  donorPublicKey      - Stellar public key of the donor
 * @body {string}  recipientPublicKey  - Stellar public key of the recipient
 * @body {number}  amount              - XLM amount per execution
 * @body {string}  frequency           - daily | weekly | monthly | custom
 * @body {number}  [customIntervalDays] - Required when frequency === 'custom'
 * @body {number}  [maxExecutions]     - Stop after N executions (omit = unlimited)
 * @body {string}  [webhookUrl]        - URL to POST on persistent failure
 * @body {string}  [startDate]         - ISO date for first execution (default: now + 1 interval)
 */
router.post('/', checkPermission(PERMISSIONS.STREAM_CREATE), payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const {
      donorPublicKey,
      recipientPublicKey,
      amount,
      frequency,
      customIntervalDays,
      maxExecutions,
      webhookUrl,
      startDate,
    } = req.body;

    // ── Required fields ──────────────────────────────────────────────────────
    const required = validateRequiredFields(
      { donorPublicKey, recipientPublicKey, amount, frequency },
      ['donorPublicKey', 'recipientPublicKey', 'amount', 'frequency']
    );
    if (!required.valid) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${required.missing.join(', ')}`,
      });
    }

    // ── Amount ───────────────────────────────────────────────────────────────
    const amountResult = validateFloat(amount);
    if (!amountResult.valid) {
      return res.status(400).json({ success: false, error: `Invalid amount: ${amountResult.error}` });
    }

    // ── Frequency ────────────────────────────────────────────────────────────
    const freqResult = validateEnum(frequency, VALID_FREQUENCIES, { caseInsensitive: true });
    if (!freqResult.valid) {
      return res.status(400).json({ success: false, error: freqResult.error });
    }
    const normalizedFreq = freqResult.value;

    // ── Custom interval ──────────────────────────────────────────────────────
    if (normalizedFreq === DONATION_FREQUENCIES.CUSTOM) {
      const intervalResult = validateInteger(customIntervalDays, { min: 1 });
      if (!intervalResult.valid) {
        return res.status(400).json({
          success: false,
          error: `customIntervalDays is required and must be >= 1 for custom frequency`,
        });
      }
    }

    // ── maxExecutions ────────────────────────────────────────────────────────
    if (maxExecutions !== undefined && maxExecutions !== null) {
      const maxResult = validateInteger(maxExecutions, { min: 1 });
      if (!maxResult.valid) {
        return res.status(400).json({
          success: false,
          error: `Invalid maxExecutions: ${maxResult.error}`,
        });
      }
    }

    // ── Donor exists ─────────────────────────────────────────────────────────
    const donor = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [donorPublicKey]
    );
    if (!donor) {
      return res.status(404).json({ success: false, error: 'Donor wallet not found' });
    }

    // ── Recipient exists ─────────────────────────────────────────────────────
    const recipient = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [recipientPublicKey]
    );
    if (!recipient) {
      return res.status(404).json({ success: false, error: 'Recipient wallet not found' });
    }

    // ── No self-donations ────────────────────────────────────────────────────
    if (donor.id === recipient.id) {
      return res.status(400).json({ success: false, error: 'Donor and recipient cannot be the same' });
    }

    // ── Calculate first execution date ───────────────────────────────────────
    const scheduler = serviceContainer.getRecurringDonationScheduler();
    let firstExecution;
    if (startDate) {
      firstExecution = new Date(startDate);
      if (isNaN(firstExecution.getTime())) {
        return res.status(400).json({ success: false, error: 'Invalid startDate format' });
      }
    } else {
      firstExecution = scheduler.calculateNextExecutionDate(
        new Date(),
        normalizedFreq,
        customIntervalDays ? parseInt(customIntervalDays, 10) : undefined
      );
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const result = await Database.run(
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, customIntervalDays,
          maxExecutions, webhookUrl, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        donor.id,
        recipient.id,
        amountResult.value,
        normalizedFreq,
        customIntervalDays ? parseInt(customIntervalDays, 10) : null,
        maxExecutions ? parseInt(maxExecutions, 10) : null,
        webhookUrl || null,
        firstExecution.toISOString(),
        SCHEDULE_STATUS.ACTIVE,
      ]
    );

    const schedule = await Database.get(
      `SELECT rd.id, rd.amount, rd.frequency, rd.customIntervalDays,
              rd.maxExecutions, rd.webhookUrl, rd.nextExecutionDate,
              rd.status, rd.executionCount, rd.failureCount,
              donor.publicKey AS donorPublicKey,
              recipient.publicKey AS recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor     ON rd.donorId    = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id
       WHERE rd.id = ?`,
      [result.id]
    );

    log.info('RECURRING_DONATION_ROUTE', 'Schedule created', {
      scheduleId: schedule.id,
      frequency: normalizedFreq,
      amount: amountResult.value,
    });

    return res.status(201).json({
      success: true,
      message: 'Recurring donation schedule created successfully',
      data: formatSchedule(schedule),
    });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /donations/recurring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /donations/recurring
 * @desc    List all recurring donation schedules
 * @access  stream:read
 * @query   {string} [status] - Filter by status (active|paused|cancelled|completed)
 */
router.get('/', checkPermission(PERMISSIONS.STREAM_READ), asyncHandler(async (req, res, next) => {
  try {
    const { status } = req.query;

    let sql = `
      SELECT rd.id, rd.amount, rd.frequency, rd.customIntervalDays,
             rd.maxExecutions, rd.webhookUrl, rd.nextExecutionDate,
             rd.lastExecutionDate, rd.status, rd.executionCount,
             rd.failureCount, rd.lastFailureReason, rd.createdAt,
             donor.publicKey AS donorPublicKey,
             recipient.publicKey AS recipientPublicKey
      FROM recurring_donations rd
      JOIN users donor     ON rd.donorId    = donor.id
      JOIN users recipient ON rd.recipientId = recipient.id
    `;
    const params = [];

    if (status) {
      const validStatuses = Object.values(SCHEDULE_STATUS);
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }
      sql += ' WHERE rd.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY rd.createdAt DESC';

    const schedules = await Database.query(sql, params);

    return res.json({
      success: true,
      data: schedules.map(formatSchedule),
      count: schedules.length,
    });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /donations/recurring/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /donations/recurring/:id
 * @desc    Get a specific recurring donation schedule
 * @access  stream:read
 */
router.get('/:id', checkPermission(PERMISSIONS.STREAM_READ), asyncHandler(async (req, res, next) => {
  try {
    const schedule = await Database.get(
      `SELECT rd.id, rd.amount, rd.frequency, rd.customIntervalDays,
              rd.maxExecutions, rd.webhookUrl, rd.nextExecutionDate,
              rd.lastExecutionDate, rd.status, rd.executionCount,
              rd.failureCount, rd.lastFailureReason, rd.createdAt,
              donor.publicKey AS donorPublicKey,
              recipient.publicKey AS recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor     ON rd.donorId    = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id
       WHERE rd.id = ?`,
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    return res.json({ success: true, data: formatSchedule(schedule) });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /donations/recurring/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   DELETE /donations/recurring/:id
 * @desc    Cancel a recurring donation schedule
 * @access  stream:delete
 */
router.delete('/:id', checkPermission(PERMISSIONS.STREAM_DELETE), asyncHandler(async (req, res, next) => {
  try {
    const schedule = await Database.get(
      'SELECT id, status FROM recurring_donations WHERE id = ?',
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    if (schedule.status === SCHEDULE_STATUS.CANCELLED) {
      return res.status(409).json({ success: false, error: 'Schedule is already cancelled' });
    }

    await Database.run(
      'UPDATE recurring_donations SET status = ? WHERE id = ?',
      [SCHEDULE_STATUS.CANCELLED, req.params.id]
    );

    log.info('RECURRING_DONATION_ROUTE', 'Schedule cancelled', { scheduleId: req.params.id });

    return res.json({
      success: true,
      message: 'Recurring donation schedule cancelled successfully',
    });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// GET /donations/recurring/:id/history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /donations/recurring/:id/history
 * @desc    Get execution history for a recurring donation schedule
 * @access  stream:read
 * @query   {number} [limit=20]  - Max records to return (1-100)
 * @query   {number} [offset=0]  - Pagination offset
 */
router.get('/:id/history', checkPermission(PERMISSIONS.STREAM_READ), asyncHandler(async (req, res, next) => {
  try {
    // Verify schedule exists
    const schedule = await Database.get(
      'SELECT id FROM recurring_donations WHERE id = ?',
      [req.params.id]
    );
    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    const limitResult = validateInteger(req.query.limit, { min: 1, max: 100, default: 20 });
    const offsetResult = validateInteger(req.query.offset, { min: 0, default: 0 });

    if (!limitResult.valid) {
      return res.status(400).json({ success: false, error: `Invalid limit: ${limitResult.error}` });
    }

    const logs = await Database.query(
      `SELECT id, scheduleId, status, transactionHash, errorMessage,
              attemptNumber, timestamp, correlationId
       FROM recurring_donation_logs
       WHERE scheduleId = ?
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
      [req.params.id, limitResult.value, offsetResult.value || 0]
    );

    const total = await Database.get(
      'SELECT COUNT(*) AS count FROM recurring_donation_logs WHERE scheduleId = ?',
      [req.params.id]
    );

    return res.json({
      success: true,
      data: logs,
      count: logs.length,
      total: total ? total.count : 0,
      limit: limitResult.value,
      offset: offsetResult.value || 0,
    });
  } catch (error) {
    next(error);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalise a DB row into a consistent API response shape.
 * @param {Object} row
 * @returns {Object}
 */
function formatSchedule(row) {
  return {
    id: row.id,
    donorPublicKey: row.donorPublicKey,
    recipientPublicKey: row.recipientPublicKey,
    amount: row.amount,
    frequency: row.frequency,
    customIntervalDays: row.customIntervalDays || null,
    maxExecutions: row.maxExecutions || null,
    webhookUrl: row.webhookUrl || null,
    nextExecutionDate: row.nextExecutionDate,
    lastExecutionDate: row.lastExecutionDate || null,
    status: row.status,
    executionCount: row.executionCount || 0,
    failureCount: row.failureCount || 0,
    lastFailureReason: row.lastFailureReason || null,
    createdAt: row.createdAt || null,
  };
}

module.exports = router;
