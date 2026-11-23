/**
 * Recurring Donation Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for recurring donation CRUD and history
 * OWNER: Backend Team
 * DEPENDENCIES: RecurringDonationService, Database, middleware (auth, RBAC)
 *
 * Canonical API for recurring schedules (#2113). Create/update/pause/resume
 * go through RecurringDonationService, shared with the deprecated
 * /stream/create and /stream/schedules/* routes.
 *
 * Endpoints:
 *   POST   /donations/recurring              – create a schedule
 *   PATCH  /donations/recurring/:id          – update amount/frequency/interval
 *   POST   /donations/recurring/:id/pause    – pause a schedule
 *   POST   /donations/recurring/:id/resume   – resume a schedule
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
const { SCHEDULE_STATUS } = require('../constants');
const { validateInteger } = require('../utils/validationHelpers');
const log = require('../utils/log');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const RecurringDonationService = require('../services/RecurringDonationService');
const AuditLogService = require('../services/AuditLogService');

const { RecurringScheduleError, CODES, formatSchedule } = RecurringDonationService;

/** HTTP status for each RecurringDonationService error code on this router. */
const STATUS_BY_CODE = {
  [CODES.MISSING_FIELDS]: 400,
  [CODES.INVALID_AMOUNT]: 422,
  [CODES.INVALID_FREQUENCY]: 400,
  [CODES.INVALID_INTERVAL]: 400,
  [CODES.INVALID_MAX_EXECUTIONS]: 400,
  [CODES.INVALID_START_DATE]: 400,
  [CODES.DONOR_NOT_FOUND]: 404,
  [CODES.RECIPIENT_NOT_FOUND]: 404,
  [CODES.SELF_DONATION]: 400,
  [CODES.NO_CHANGES]: 400,
  [CODES.NOT_FOUND]: 404,
  [CODES.FORBIDDEN]: 403,
  [CODES.CONFLICT]: 409,
  [CODES.INVALID_STATE]: 400,
};

/**
 * Send a RecurringScheduleError using this router's response shape; other
 * errors go to the error handler.
 */
function handleServiceError(error, res, next) {
  if (error instanceof RecurringScheduleError) {
    return res.status(STATUS_BY_CODE[error.code] || 400).json({
      success: false,
      error: error.message,
      code: error.code,
    });
  }
  return next(error);
}

function actorFrom(req) {
  return { user: req.user, apiKey: req.apiKey };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /donations/recurring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /donations/recurring
 * @desc    Create a new recurring donation schedule (canonical API, #2113)
 * @access  stream:create
 *
 * @body {string}  donorPublicKey      - Stellar public key of the donor
 * @body {string}  recipientPublicKey  - Stellar public key of the recipient
 * @body {number}  amount              - XLM amount per execution
 * @body {string}  frequency           - daily | weekly | biweekly | monthly | quarterly | custom
 * @body {number}  [intervalDays]      - Required when frequency === 'custom' (alias: customIntervalDays)
 * @body {number}  [maxExecutions]     - Stop after N executions (omit = unlimited)
 * @body {string}  [webhookUrl]        - URL to POST on persistent failure
 * @body {string}  [startDate]         - ISO date for first execution (default: now + 1 interval)
 */
router.post('/', checkPermission(PERMISSIONS.STREAM_CREATE), payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
  try {
    const schedule = await RecurringDonationService.create(req.body || {});

    log.info('RECURRING_DONATION_ROUTE', 'Schedule created', {
      scheduleId: schedule.id,
      frequency: schedule.frequency,
      amountStroops: schedule.amountStroops,
    });

    return res.status(201).json({
      success: true,
      message: 'Recurring donation schedule created successfully',
      data: schedule,
    });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /donations/recurring/:id
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   PATCH /donations/recurring/:id
 * @desc    Update amount, frequency and/or intervalDays. Changing the timing
 *          recalculates nextExecutionDate from now.
 * @access  stream:update
 */
router.patch('/:id', checkPermission(PERMISSIONS.STREAM_UPDATE), payloadSizeLimiter(ENDPOINT_LIMITS.stream), asyncHandler(async (req, res, next) => {
  try {
    const { schedule, oldValues, newValues } = await RecurringDonationService.update(
      req.params.id,
      req.body || {},
      actorFrom(req),
    );

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'SCHEDULE_UPDATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: (req.apiKey && req.apiKey.id) || (req.user && req.user.id) || null,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `recurring_donation/${req.params.id}`,
      details: { scheduleId: req.params.id, oldValues, newValues },
    });

    return res.json({ success: true, message: 'Schedule updated successfully', data: schedule });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}));

// ─────────────────────────────────────────────────────────────────────────────
// POST /donations/recurring/:id/pause and /resume
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /donations/recurring/:id/pause
 * @desc    Pause an active schedule (owner or admin)
 * @access  stream:update
 */
router.post('/:id/pause', checkPermission(PERMISSIONS.STREAM_UPDATE), asyncHandler(async (req, res, next) => {
  try {
    const data = await RecurringDonationService.pause(req.params.id, actorFrom(req));
    return res.json({ success: true, message: 'Recurring donation schedule paused successfully', data });
  } catch (error) {
    return handleServiceError(error, res, next);
  }
}));

/**
 * @route   POST /donations/recurring/:id/resume
 * @desc    Resume a paused schedule; nextExecutionDate is recalculated (owner or admin)
 * @access  stream:update
 */
router.post('/:id/resume', checkPermission(PERMISSIONS.STREAM_UPDATE), asyncHandler(async (req, res, next) => {
  try {
    const data = await RecurringDonationService.resume(req.params.id, actorFrom(req));
    return res.json({ success: true, message: 'Recurring donation schedule resumed successfully', data });
  } catch (error) {
    return handleServiceError(error, res, next);
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
      SELECT rd.id, rd.amount_stroops, rd.frequency, rd.customIntervalDays,
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
      `SELECT rd.id, rd.amount_stroops, rd.frequency, rd.customIntervalDays,
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

module.exports = router;
