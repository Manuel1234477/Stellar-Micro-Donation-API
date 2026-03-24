/**
 * Stream Routes - API Endpoint Layer
 * 
 * RESPONSIBILITY: HTTP request handling for recurring donation schedules AND
 *                 real-time SSE transaction feed.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, middleware (auth, RBAC), SseManager, donationEvents
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Database = require('../utils/database');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { VALID_FREQUENCIES, SCHEDULE_STATUS } = require('../constants');
const { validateRequiredFields, validateFloat, validateEnum } = require('../utils/validationHelpers');
const log = require('../utils/log');
const { validateSchema } = require('../middleware/schemaValidation');
const SseManager = require('../services/SseManager');
const donationEvents = require('../events/donationEvents');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const { requestTimeout, TIMEOUTS } = require('../middleware/requestTimeout');

const streamCreateSchema = validateSchema({
  body: {
    fields: {
      donorPublicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
      },
      recipientPublicKey: {
        type: 'string',
        required: true,
        trim: true,
        minLength: 1,
        maxLength: 255,
      },
      amount: { type: 'number', required: true, min: 0.0000001 },
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

/**
 * POST /stream/create
 * Create a recurring donation schedule
 */
router.post('/create', payloadSizeLimiter(ENDPOINT_LIMITS.stream), requestTimeout(TIMEOUTS.stream), checkPermission(PERMISSIONS.STREAM_CREATE), streamCreateSchema, async (req, res) => {
  try {
    const { donorPublicKey, recipientPublicKey, amount, frequency } = req.body;

    // Validate required fields
    const requiredValidation = validateRequiredFields(
      { donorPublicKey, recipientPublicKey, amount, frequency },
      ['donorPublicKey', 'recipientPublicKey', 'amount', 'frequency']
    );

    if (!requiredValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields: ${requiredValidation.missing.join(', ')}`
      });
    }

    // Validate amount
    const amountValidation = validateFloat(amount);
    if (!amountValidation.valid) {
      return res.status(400).json({
        success: false,
        error: `Invalid amount: ${amountValidation.error}`
      });
    }

    // Validate frequency
    const frequencyValidation = validateEnum(frequency, VALID_FREQUENCIES, { caseInsensitive: true });
    if (!frequencyValidation.valid) {
      return res.status(400).json({
        success: false,
        error: frequencyValidation.error
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
    next(error);
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
    next(error);
  }
});

/**
 * GET /stream/schedules/:id
 * Get a specific recurring donation schedule
 */
router.get('/schedules/:id', checkPermission(PERMISSIONS.STREAM_READ), streamScheduleIdSchema, async (req, res) => {
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
router.delete('/schedules/:id', checkPermission(PERMISSIONS.STREAM_DELETE), streamScheduleIdSchema, async (req, res) => {
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

  if (SseManager.connectionCount(keyId) >= SseManager.MAX_CONNECTIONS_PER_KEY) {
    return res.status(429).json({
      success: false,
      error: { code: 'TOO_MANY_CONNECTIONS', message: `Maximum ${SseManager.MAX_CONNECTIONS_PER_KEY} concurrent streams per API key` },
    });
  }

  // Parse filters
  const filter = {};
  if (req.query.walletAddress) filter.walletAddress = req.query.walletAddress;
  if (req.query.status)        filter.status        = req.query.status;
  if (req.query.minAmount !== undefined) {
    const v = Number(req.query.minAmount);
    if (!Number.isFinite(v)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'minAmount must be a number' } });
    filter.minAmount = v;
  }
  if (req.query.maxAmount !== undefined) {
    const v = Number(req.query.maxAmount);
    if (!Number.isFinite(v)) return res.status(400).json({ success: false, error: { code: 'INVALID_FILTER', message: 'maxAmount must be a number' } });
    filter.maxAmount = v;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const clientId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  const client = SseManager.addClient(clientId, keyId, filter, res);

  // Replay missed events for reconnecting clients
  const lastEventId = req.headers['last-event-id'];
  if (lastEventId) {
    const missed = SseManager.getMissedEvents(lastEventId);
    for (const e of missed) {
      if (SseManager.matchesFilter(e.data, filter)) {
        client.send(e.id, e.event, e.data);
      }
    }
  }

  // Send initial connected event
  SseManager.writeSseEvent(res, '0', 'connected', { clientId, message: 'Stream connected' });

  // Heartbeat
  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, SseManager.HEARTBEAT_INTERVAL_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
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
