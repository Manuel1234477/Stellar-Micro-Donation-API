/**
 * Stream Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for recurring donation schedules AND
 *                 real-time SSE transaction feed.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, middleware (auth, RBAC), SseManager, donationEvents
 */

/**
 * @openapi
 * tags:
 *   - name: Stream
 *     description: Recurring donation schedules
 *
 * /stream/create:
 *   post:
 *     tags: [Stream]
 *     summary: Create a recurring donation schedule
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [donorPublicKey, recipientPublicKey, amount, frequency]
 *             properties:
 *               donorPublicKey:
 *                 type: string
 *               recipientPublicKey:
 *                 type: string
 *               amount:
 *                 type: number
 *               frequency:
 *                 type: string
 *                 enum: [daily, weekly, monthly]
 *     responses:
 *       201:
 *         description: Schedule created
 *       400:
 *         description: Validation error
 *
 * /stream/schedules:
 *   get:
 *     tags: [Stream]
 *     summary: List all recurring donation schedules
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of schedules
 *
 * /stream/schedules/{id}:
 *   get:
 *     tags: [Stream]
 *     summary: Get a specific schedule
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Schedule details
 *       404:
 *         description: Schedule not found
 *   delete:
 *     tags: [Stream]
 *     summary: Cancel a recurring donation schedule
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Schedule cancelled
 *       404:
 *         description: Schedule not found
 */

const express = require('express');
const { clientErrorMessage } = require('../utils/clientErrorMessage');
const router = express.Router();
const crypto = require('crypto');
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { VALID_FREQUENCIES, SCHEDULE_STATUS } = require('../constants');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const { validateSchema } = require('../middleware/schemaValidation');
const { isValidStellarPublicKey } = require('../utils/validators');
const SseManager = require('../services/SseManager');
const donationEvents = require('../events/donationEvents');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { requestTimeout, TIMEOUTS } = require('../middleware/requestTimeout');
const AuditLogService = require('../services/AuditLogService');
const asyncHandler = require('../utils/asyncHandler');
const { toStroops, fromStroops } = require('../utils/money');
const RecurringDonationService = require('../services/RecurringDonationService');
const { deprecated } = require('../middleware/deprecation');

const { RecurringScheduleError, CODES: SCHEDULE_CODES } = RecurringDonationService;

/** Canonical successor for the deprecated schedule routes (#2113). */
const RECURRING_BASE = '/api/v1/donations/recurring';

/**
 * Map the deprecated stream path to its /donations/recurring successor.
 * Mounted under '/schedules', so req.path is e.g. '/5/history'.
 */
function recurringSuccessor(req) {
  return req.path && req.path !== '/' ? `${RECURRING_BASE}${req.path}` : RECURRING_BASE;
}

/**
 * Send a RecurringScheduleError using this router's legacy response shapes;
 * other errors go to the error handler.
 */
function handleServiceError(error, res, next) {
  if (!(error instanceof RecurringScheduleError)) return next(error);
  switch (error.code) {
    case SCHEDULE_CODES.DONOR_NOT_FOUND:
    case SCHEDULE_CODES.RECIPIENT_NOT_FOUND:
      return res.status(422).json({
        success: false,
        error: {
          code: 'WALLET_NOT_FOUND',
          message: `${error.message}. Register the wallet first via POST /wallets.`,
          field: error.field,
        },
      });
    case SCHEDULE_CODES.INVALID_FREQUENCY:
      return res.status(400).json({ success: false, error: error.message, code: 'INVALID_FREQUENCY', errorCode: 1006 });
    case SCHEDULE_CODES.INVALID_AMOUNT:
      return res.status(422).json({ success: false, error: error.message });
    case SCHEDULE_CODES.NO_CHANGES:
      return res.status(400).json({ success: false, error: { code: 'INVALID_REQUEST', message: error.message } });
    case SCHEDULE_CODES.NOT_FOUND:
      return res.status(404).json({ success: false, error: error.message });
    case SCHEDULE_CODES.FORBIDDEN:
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: error.message } });
    case SCHEDULE_CODES.CONFLICT:
      return res.status(409).json({
        success: false,
        error: error.message.startsWith('Cannot update') ? { code: 'CONFLICT', message: error.message } : error.message,
      });
    default:
      return res.status(400).json({ success: false, error: error.message, code: error.code });
  }
}

const streamCreateSchema = validateSchema({
  body: {
    fields: {
      donorPublicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
        validate: (value) => isValidStellarPublicKey(value)
          ? true
          : 'donorPublicKey must be a valid Stellar public key (56-character Ed25519 public key starting with G)',
      },
      recipientPublicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
        validate: (value) => isValidStellarPublicKey(value)
          ? true
          : 'recipientPublicKey must be a valid Stellar public key (56-character Ed25519 public key starting with G)',
      },
      amount: { type: 'number', required: true, min: 0.0000001 },
      intervalDays: { type: 'integer', required: false, min: 1, max: 365 },
      customIntervalDays: { type: 'integer', required: false, min: 1, max: 365 },
      maxExecutions: { type: 'integer', required: false, min: 1 },
      webhookUrl: { type: 'string', required: false },
      startDate: { type: 'string', required: false },
      frequency: {
        type: 'string',
        required: true,
        validate: (value) => {
          if (typeof value !== 'string') {
            return 'frequency must be a string';
          }
          return VALID_FREQUENCIES.includes(value.toLowerCase())
            ? true
            : `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`;
        },
      },
    },
  },
});

const streamScheduleIdSchema = validateSchema({
  params: {
    fields: {
      id: { type: 'integerString', required: true },
    },
  },
});

const updateScheduleSchema = validateSchema({
  body: {
    fields: {
      amount: { types: ['number', 'numberString'], required: false },
      // Same frequency set as /donations/recurring; validated by RecurringDonationService (#2113).
      frequency: { type: 'string', required: false },
      intervalDays: { type: 'integer', required: false, min: 1, max: 365 },
      customIntervalDays: { type: 'integer', required: false, min: 1, max: 365 },
    }
  }
});

// ── Deprecated surface (#2113) ──────────────────────────────────────────────
// /donations/recurring is the canonical recurring-schedule API. The schedule
// routes below keep working until the sunset date but advertise
// Deprecation, Sunset and Link: rel="successor-version" headers.
router.use('/create', deprecated(RECURRING_BASE));
router.use('/schedules', deprecated(recurringSuccessor));

/**
 * POST /stream/create
 * Create a recurring donation schedule
 */
router.post('/create', payloadSizeLimiter(ENDPOINT_LIMITS.stream), requestTimeout(TIMEOUTS.stream), checkPermission(PERMISSIONS.STREAM_CREATE), streamCreateSchema, asyncHandler(async (req, res, next) => {
  try {
    // Shared implementation with POST /donations/recurring (#2113).
    const schedule = await RecurringDonationService.create(req.body || {});

    res.status(201).json({
      success: true,
      message: 'Recurring donation schedule created successfully',
      data: {
        scheduleId: schedule.id,
        donor: schedule.donorPublicKey,
        recipient: schedule.recipientPublicKey,
        amount: schedule.amount,
        amountStroops: schedule.amountStroops,
        frequency: schedule.frequency,
        intervalDays: schedule.intervalDays,
        nextExecution: schedule.nextExecutionDate,
        status: schedule.status,
        executionCount: schedule.executionCount
      }
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
}));

/**
 * GET /stream/schedules
 * Get recurring donation schedules.
 * Regular users see only their own schedules (where they are the donor).
 * Admin users can see all schedules by passing ?all=true.
 * Supports optional ?status= filter and ?sort= (default id:asc) — #798.
 */
router.get('/schedules', checkPermission(PERMISSIONS.STREAM_READ), asyncHandler(async (req, res, next) => {
  try {
    const { status, all } = req.query;
    const isAdmin = req.user?.role === 'admin' || req.apiKey?.role === 'admin';
    const userPublicKey = req.user?.subject || req.apiKey?.subject;
    // Legacy/system API keys (isLegacy: true) have no subject but are trusted callers
    const isLegacyKey = (req.apiKey && req.apiKey.isLegacy) || (req.user && req.user.isLegacy);

    // Non-admins without a subject must be identified — unless they are legacy keys
    if (!isAdmin && !userPublicKey && !isLegacyKey) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Cannot identify requesting user' }
      });
    }

    // #798: validate ?sort param — default id:asc for stable pagination
    const VALID_SORT = {
      'id:asc': 'rd.id ASC',
      'id:desc': 'rd.id DESC',
      'createdAt:asc': 'rd.id ASC',   // createdAt not stored; id is a stable proxy
      'createdAt:desc': 'rd.id DESC',
    };
    const sortParam = req.query.sort || 'id:asc';
    if (!VALID_SORT[sortParam]) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SORT',
          message: `Invalid sort value. Valid options: ${Object.keys(VALID_SORT).join(', ')}`,
        },
      });
    }
    const orderByClause = VALID_SORT[sortParam];

    const showAll = isAdmin && all === 'true';

    let query = `SELECT
        rd.id,
        rd.amount_stroops,
        rd.frequency,
        rd.startDate,
        rd.nextExecutionDate,
        rd.lastExecutionDate,
        rd.status,
        rd.executionCount,
        rd.pausedAt,
        rd.resumedAt,
        donor.publicKey as donorPublicKey,
        recipient.publicKey as recipientPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       JOIN users recipient ON rd.recipientId = recipient.id`;

    const params = [];
    const conditions = [];

    if (!showAll) {
      conditions.push('donor.publicKey = ?');
      params.push(userPublicKey);
    }

    if (status) {
      // Explicit status filter — allow any value including 'cancelled'
      conditions.push('rd.status = ?');
      params.push(status);
    } else {
      // Default: exclude cancelled schedules so the list shows only active/paused
      conditions.push("rd.status IN ('active', 'paused')");
    }

    if (conditions.length) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ` ORDER BY ${orderByClause}`;

    const schedules = await Database.query(query, params);

    res.json({
      success: true,
      data: schedules.map(s => ({
        ...s,
        amount: fromStroops(s.amount_stroops),
        amountStroops: s.amount_stroops,
      })),
      count: schedules.length
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * POST /stream/schedules/:id/pause
 * Pause an active recurring donation schedule.
 * Returns 409 if the schedule is already paused.
 * Authorization: Only the donor who created the schedule or an admin can pause it
 */
router.post('/schedules/:id/pause', checkPermission(PERMISSIONS.STREAM_UPDATE), streamScheduleIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.stream), asyncHandler(async (req, res, next) => {
  try {
    const data = await RecurringDonationService.pause(req.params.id, { user: req.user, apiKey: req.apiKey });
    res.json({ success: true, message: 'Recurring donation schedule paused successfully', data });
  } catch (error) {
    handleServiceError(error, res, next);
  }
}));

/**
 * POST /stream/schedules/:id/resume
 * Resume a paused recurring donation schedule.
 * Recalculates nextExecutionDate from now based on frequency.
 * Authorization: Only the donor who created the schedule or an admin can resume it
 */
router.post('/schedules/:id/resume', checkPermission(PERMISSIONS.STREAM_UPDATE), streamScheduleIdSchema, payloadSizeLimiter(ENDPOINT_LIMITS.stream), asyncHandler(async (req, res, next) => {
  try {
    // nextExecutionDate comes from the shared scheduler maths (#2113).
    const data = await RecurringDonationService.resume(req.params.id, { user: req.user, apiKey: req.apiKey });
    res.json({ success: true, message: 'Recurring donation schedule resumed successfully', data });
  } catch (error) {
    handleServiceError(error, res, next);
  }
}));

/**
 * GET /stream/schedules/:id
 * Get a specific recurring donation schedule
 */
router.get('/schedules/:id', checkPermission(PERMISSIONS.STREAM_READ), streamScheduleIdSchema, asyncHandler(async (req, res) => {
  try {
    const schedule = await Database.get(
      `SELECT
        rd.id,
        rd.amount_stroops,
        rd.frequency,
        rd.startDate,
        rd.nextExecutionDate,
        rd.lastExecutionDate,
        rd.status,
        rd.executionCount,
        rd.pausedAt,
        rd.resumedAt,
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
      data: {
        ...schedule,
        amount: fromStroops(schedule.amount_stroops),
        amountStroops: schedule.amount_stroops,
      }
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to fetch recurring donation schedule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch schedule',
      message: clientErrorMessage('STREAM_ROUTE', error, 500, 'Failed to fetch schedule')
    });
  }
}));

/**
 * GET /stream/schedules/:id/history
 * Paginated execution history for a recurring donation schedule.
 * Accessible to the schedule owner and admins.
 *
 * Query params:
 *   limit  {number} - records per page (default 20, max 100)
 *   cursor {string} - opaque cursor for pagination
 *   status {string} - filter by status: 'success' or 'failed'
 */
router.get('/schedules/:id/history', checkPermission(PERMISSIONS.STREAM_READ), streamScheduleIdSchema, asyncHandler(async (req, res) => {
  try {
    const { parseCursorPaginationQuery } = require('../utils/pagination');
    
    // Verify schedule exists and check ownership
    const schedule = await Database.get(
      `SELECT rd.id, donor.publicKey as donorPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       WHERE rd.id = ?`,
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({ success: false, error: 'Schedule not found' });
    }

    const isAdmin = req.user?.role === 'admin' || req.apiKey?.role === 'admin';
    const userPublicKey = req.user?.subject || req.apiKey?.subject;

    if (!isAdmin && userPublicKey !== schedule.donorPublicKey) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' }
      });
    }

    // Parse cursor pagination
    const pagination = parseCursorPaginationQuery(req.query);
    
    // Parse status filter
    const statusFilter = req.query.status;
    if (statusFilter && !['success', 'failed'].includes(statusFilter)) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_REQUEST', message: 'status must be "success" or "failed"' }
      });
    }

    // Build query with cursor-based pagination
    let whereClause = 'WHERE scheduleId = ?';
    let params = [req.params.id];
    
    if (statusFilter) {
      whereClause += ' AND status = ?';
      params.push(statusFilter);
    }

    // Get total count
    const countRow = await Database.get(
      `SELECT COUNT(*) as total FROM recurring_donation_executions ${whereClause}`,
      params
    );
    const totalCount = countRow ? countRow.total : 0;

    // Build cursor filter clause
    let cursorClause = '';
    let cursorParams = [];
    if (pagination.cursor) {
      // For descending order: id < cursor.id OR (id = cursor.id AND executedAt < cursor.timestamp)
      cursorClause = ' AND (id < ? OR (id = ? AND executedAt < ?))';
      cursorParams = [pagination.cursor.id, pagination.cursor.id, pagination.cursor.timestamp];
    }

    // Fetch one extra record to determine hasMore
    const executions = await Database.query(
      `SELECT id, executedAt, status, transactionHash, errorMessage, retryCount, durationMs
       FROM recurring_donation_executions
       ${whereClause}${cursorClause}
       ORDER BY executedAt DESC, id DESC
       LIMIT ?`,
      [...params, ...cursorParams, pagination.limit + 1]
    );

    // Determine if there are more results
    const hasMore = executions.length > pagination.limit;
    const pageData = executions.slice(0, pagination.limit);

    // Generate next cursor
    let nextCursor = null;
    if (hasMore && pageData.length > 0) {
      const lastItem = pageData[pageData.length - 1];
      nextCursor = Buffer.from(JSON.stringify({
        id: lastItem.id,
        timestamp: lastItem.executedAt
      }), 'utf8').toString('base64url');
    }

    res.json({
      success: true,
      data: pageData.map(exec => ({
        id: exec.id,
        executedAt: exec.executedAt,
        status: exec.status,
        transactionHash: exec.transactionHash || null,
        errorMessage: exec.errorMessage || null,
        retryCount: exec.retryCount || 0,
        durationMs: exec.durationMs || 0,
      })),
      pagination: {
        nextCursor,
        hasMore,
        total: totalCount,
      },
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to fetch schedule history', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch schedule history' });
  }
}));

/**
 * PATCH /stream/schedules/:id
 * Update amount and/or frequency of an active recurring donation schedule.
 * Changing frequency recalculates nextExecutionDate from now.
 * Cancelled/suspended schedules cannot be updated (409).
 * Requires stream:write permission.
 */
router.patch('/schedules/:id', checkPermission(PERMISSIONS.STREAM_UPDATE), streamScheduleIdSchema, updateScheduleSchema, payloadSizeLimiter(ENDPOINT_LIMITS.stream), asyncHandler(async (req, res, next) => {
  try {
    // Shared implementation with PATCH /donations/recurring/:id (#2113).
    const { schedule, oldValues, newValues } = await RecurringDonationService.update(
      req.params.id,
      req.body || {},
      { user: req.user, apiKey: req.apiKey },
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

    res.json({
      success: true,
      message: 'Schedule updated successfully',
      data: {
        id: schedule.id,
        amount_stroops: schedule.amountStroops,
        frequency: schedule.frequency,
        intervalDays: schedule.intervalDays,
        nextExecutionDate: schedule.nextExecutionDate,
        status: schedule.status,
        amount: schedule.amount,
        amountStroops: schedule.amountStroops,
      },
    });
  } catch (error) {
    handleServiceError(error, res, next);
  }
}));

/**
 * DELETE /stream/schedules/:id
 * Cancel a recurring donation schedule
 * Authorization: Only the donor who created the schedule or an admin can cancel it
 */
router.delete('/schedules/:id', checkPermission(PERMISSIONS.STREAM_DELETE), streamScheduleIdSchema, asyncHandler(async (req, res) => {
  try {
    const schedule = await Database.get(
      `SELECT rd.id, rd.status, donor.publicKey as donorPublicKey
       FROM recurring_donations rd
       JOIN users donor ON rd.donorId = donor.id
       WHERE rd.id = ?`,
      [req.params.id]
    );

    if (!schedule) {
      return res.status(404).json({
        success: false,
        error: 'Schedule not found'
      });
    }

    // Authorization check: verify ownership or admin role
    const isAdmin = req.user && req.user.role === 'admin';
    
    // For SEP-10 JWT authentication, the subject contains the public key
    const userPublicKey = req.user && req.user.subject;
    
    // Check if the requesting user is the donor or an admin
    if (!isAdmin && userPublicKey !== schedule.donorPublicKey) {
      log.warn('STREAM_ROUTE', 'Unauthorized schedule cancellation attempt', {
        scheduleId: req.params.id,
        requestingUser: userPublicKey || req.user?.id,
        scheduleOwner: schedule.donorPublicKey,
        userRole: req.user?.role
      });
      
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to cancel this schedule. Only the schedule owner or an admin can cancel it.'
        }
      });
    }

    // Check if the schedule is currently being executed (#778)
    const scheduler = require('../services/RecurringDonationScheduler');
    const scheduleIdNum = parseInt(req.params.id, 10);
    const isInProgress = scheduler.executingSchedules && scheduler.executingSchedules.has(scheduleIdNum);

    const now = new Date().toISOString();
    const cancellerUserId = (req.apiKey && req.apiKey.id) || (req.user && req.user.id) || null;

    if (isInProgress) {
      // Mark as pending_cancellation — the scheduler will set it to cancelled after execution completes
      await Database.run(
        'UPDATE recurring_donations SET status = ?, cancelledAt = ? WHERE id = ?',
        ['pending_cancellation', now, req.params.id]
      );

      log.info('STREAM_ROUTE', 'Schedule cancellation deferred — execution in progress', {
        scheduleId: req.params.id,
        cancelledBy: userPublicKey || req.user?.id,
        isAdmin
      });

      return res.json({
        success: true,
        cancellationStatus: 'deferred',
        message: 'Schedule is currently executing. Cancellation will take effect after the current execution completes.'
      });
    }

    await Database.run(
      'UPDATE recurring_donations SET status = ?, cancelledAt = ? WHERE id = ?',
      [SCHEDULE_STATUS.CANCELLED, now, req.params.id]
    );

    // Audit log entry for schedule cancellation
    AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'SCHEDULE_CANCELLED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: cancellerUserId,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `recurring_donation/${req.params.id}`,
      details: {
        scheduleId: req.params.id,
        resourceId: String(req.params.id),
        cancelledBy: userPublicKey || req.user?.id || null,
        isAdmin,
      },
    }).catch((auditErr) => {
      log.warn('STREAM_ROUTE', 'Failed to write audit log for schedule cancellation', { error: auditErr.message });
    });

    log.info('STREAM_ROUTE', 'Schedule cancelled immediately', {
      scheduleId: req.params.id,
      cancelledBy: userPublicKey || req.user?.id,
      isAdmin
    });

    res.json({
      success: true,
      cancellationStatus: 'immediate',
      message: 'Recurring donation schedule cancelled successfully'
    });
  } catch (error) {
    log.error('STREAM_ROUTE', 'Failed to cancel recurring donation schedule', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to cancel schedule',
      message: clientErrorMessage('STREAM_ROUTE', error, 500, 'Failed to cancel schedule')
    });
  }
}));

// ─── SSE Transaction Feed ────────────────────────────────────────────────────

// Wire donation lifecycle events → SSE broadcast
donationEvents.on(donationEvents.constructor.EVENTS?.CREATED  || 'donation.created',  tx => SseManager.broadcast('transaction.created',   tx));
donationEvents.on(donationEvents.constructor.EVENTS?.CONFIRMED || 'donation.confirmed', tx => SseManager.broadcast('transaction.confirmed', tx));
donationEvents.on(donationEvents.constructor.EVENTS?.FAILED    || 'donation.failed',    tx => SseManager.broadcast('transaction.failed',    tx));

/**
 * GET /stream/feed
 * Subscribe to a real-time SSE transaction feed.
 *
 * Query params:
 *   walletAddress {string}  - Filter by donor or recipient address.
 *   status        {string}  - Filter by transaction status.
 *   minAmount     {number}  - Minimum amount (inclusive).
 *   maxAmount     {number}  - Maximum amount (inclusive).
 *
 * Headers:
 *   Last-Event-ID - Resume from a previous event ID (reconnection support).
 */
router.get('/feed', checkPermission(PERMISSIONS.STREAM_READ), (req, res) => {
  const keyId = req.apiKey?.id != null ? String(req.apiKey.id) : (req.apiKey?.role || 'legacy');

  const filter = {};
  if (req.query.walletAddress) filter.walletAddress = req.query.walletAddress;
  if (req.query.status) filter.status = req.query.status;
  // ADR-004: monetary filters are converted to integer stroops for comparison
  if (req.query.minAmount !== undefined) {
    const v = Number(req.query.minAmount);
    if (!Number.isFinite(v)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'minAmount must be a number' } });
    filter.minAmount = v;
    filter.minAmountStroops = toStroops(String(req.query.minAmount).trim());
  }
  if (req.query.maxAmount !== undefined) {
    const v = Number(req.query.maxAmount);
    if (!Number.isFinite(v)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'maxAmount must be a number' } });
    filter.maxAmount = v;
    filter.maxAmountStroops = toStroops(String(req.query.maxAmount).trim());
  }

  const clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const { added, limitExceeded, globalLimit, client } = SseManager.addClient(clientId, keyId, filter, res);

  if (globalLimit) return SseManager.sendGlobalLimitResponse(res);

  if (limitExceeded) {
    return res.status(429).json({
      success: false,
      error: { code: 'TOO_MANY_CONNECTIONS', message: `Maximum ${SseManager.MAX_CONNECTIONS_PER_KEY} concurrent streams per API key` },
    });
  }

  if (!added || !client) {
    return res.status(500).json({ success: false, error: { code: 'SSE_ERROR', message: 'Failed to add SSE client' } });
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Replay missed events for reconnecting clients
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = SseManager.getMissedEvents(lastEventId);
    for (const e of missed) {
      if (SseManager.matchesFilter(e.data, filter)) {
        SseManager.writeSseEvent(res, e.id, e.event, e.data);
      }
    }
  }

  // Send initial connected event
  SseManager.writeSseEvent(res, '0', 'connected', { clientId, message: 'Stream connected' });

  // Heartbeat
  const heartbeat = timerRegistry.createInterval(() => {
    res.write(': ping\n\n');
  }, SseManager.HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    heartbeat.clear();
    SseManager.removeClient(clientId);
    log.info('SSE', 'Client disconnected', { clientId, keyId });
  });
});

/**
 * GET /stream/stats
 * Return active SSE connection counts (admin only).
 */
router.get('/stats', checkPermission(PERMISSIONS.STREAM_READ), (req, res) => {
  res.json({ success: true, data: SseManager.getStats() });
});

module.exports = router;
