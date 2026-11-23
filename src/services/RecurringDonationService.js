'use strict';

/**
 * Recurring Donation Service - Business Logic Layer (#2113)
 *
 * RESPONSIBILITY: Single implementation of recurring-schedule create, update,
 *   pause and resume, shared by the canonical `/donations/recurring` router and
 *   the deprecated `/stream/create` + `/stream/schedules/*` router.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, RecurringDonationScheduler (date maths), money utils
 *
 * Before this service the two routers validated different frequency sets and
 * each computed `nextExecutionDate` with its own local-time switch statement.
 * Now both validate against VALID_FREQUENCIES and every `nextExecutionDate`
 * comes from RecurringDonationScheduler.calculateNextExecution().
 *
 * Methods throw RecurringScheduleError with a stable `code`; each router maps
 * codes to HTTP statuses and keeps its own response envelope.
 */

const Database = require('../utils/database');
const { VALID_FREQUENCIES, SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const { isValidDonationAmount } = require('../utils/validationHelpers');
const { toStroops, fromStroops } = require('../utils/money');
const { RecurringDonationScheduler } = require('./RecurringDonationScheduler');

/** Error raised for invalid input or state; `code` is stable for clients. */
class RecurringScheduleError extends Error {
  /**
   * @param {string} code - e.g. INVALID_FREQUENCY, DONOR_NOT_FOUND, NOT_FOUND
   * @param {string} message
   * @param {Object} [extra] - e.g. { field, missing }
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'RecurringScheduleError';
    this.code = code;
    Object.assign(this, extra);
  }
}

const CODES = Object.freeze({
  MISSING_FIELDS: 'MISSING_FIELDS',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_FREQUENCY: 'INVALID_FREQUENCY',
  INVALID_INTERVAL: 'INVALID_INTERVAL',
  INVALID_MAX_EXECUTIONS: 'INVALID_MAX_EXECUTIONS',
  INVALID_START_DATE: 'INVALID_START_DATE',
  DONOR_NOT_FOUND: 'DONOR_NOT_FOUND',
  RECIPIENT_NOT_FOUND: 'RECIPIENT_NOT_FOUND',
  SELF_DONATION: 'SELF_DONATION',
  NO_CHANGES: 'NO_CHANGES',
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
});

const SCHEDULE_SELECT = `
  SELECT rd.id, rd.amount_stroops, rd.frequency, rd.customIntervalDays,
         rd.maxExecutions, rd.webhookUrl, rd.startDate, rd.nextExecutionDate,
         rd.lastExecutionDate, rd.status, rd.executionCount, rd.failureCount,
         rd.lastFailureReason, rd.createdAt,
         donor.publicKey AS donorPublicKey,
         recipient.publicKey AS recipientPublicKey
  FROM recurring_donations rd
  JOIN users donor     ON rd.donorId    = donor.id
  JOIN users recipient ON rd.recipientId = recipient.id
  WHERE rd.id = ?`;

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Validate and normalise an XLM amount. Numbers are accepted when their
 * decimal string form is a valid amount (e.g. 10.5), not only integers.
 * @returns {string} Normalised decimal string.
 */
function normaliseAmount(amount) {
  const asString = typeof amount === 'number' && Number.isFinite(amount) ? String(amount) : amount;
  if (!isValidDonationAmount(asString)) {
    throw new RecurringScheduleError(
      CODES.INVALID_AMOUNT,
      'Invalid amount: must be a positive XLM amount with at most 7 decimal places',
      { field: 'amount' },
    );
  }
  return String(asString).trim();
}

/** @returns {string} Lower-cased frequency from VALID_FREQUENCIES. */
function normaliseFrequency(frequency) {
  const value = typeof frequency === 'string' ? frequency.trim().toLowerCase() : '';
  if (!VALID_FREQUENCIES.includes(value)) {
    throw new RecurringScheduleError(
      CODES.INVALID_FREQUENCY,
      `frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`,
      { field: 'frequency' },
    );
  }
  return value;
}

/** @returns {number|null} Interval in days for custom schedules, else null. */
function normaliseInterval(frequency, intervalDays) {
  if (frequency !== DONATION_FREQUENCIES.CUSTOM) return null;
  const n = typeof intervalDays === 'string' ? Number(intervalDays.trim()) : intervalDays;
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    throw new RecurringScheduleError(
      CODES.INVALID_INTERVAL,
      'intervalDays (or customIntervalDays) is required and must be between 1 and 365 for custom frequency',
      { field: 'intervalDays' },
    );
  }
  return n;
}

/**
 * The one place a schedule's next execution date is computed.
 *
 * @param {string} frequency
 * @param {number|null} [intervalDays]
 * @param {Date} [from=new Date()]
 * @returns {Date}
 */
function computeNextExecutionDate(frequency, intervalDays = null, from = new Date()) {
  return RecurringDonationScheduler.calculateNextExecution(from, frequency, intervalDays || undefined);
}

/** Shape a DB row into the canonical API representation. */
function formatSchedule(row) {
  return {
    id: row.id,
    donorPublicKey: row.donorPublicKey,
    recipientPublicKey: row.recipientPublicKey,
    amount: fromStroops(row.amount_stroops),
    amountStroops: row.amount_stroops,
    frequency: row.frequency,
    customIntervalDays: row.customIntervalDays || null,
    intervalDays: row.customIntervalDays || null,
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

async function getScheduleRow(id) {
  return Database.get(SCHEDULE_SELECT, [id]);
}

/**
 * Whether `actor` may change a schedule owned by `donorPublicKey`.
 * Admins and legacy/system keys (no subject) are trusted callers.
 * When no actor is given the caller is assumed to have checked already.
 */
function canModify(actor, donorPublicKey) {
  if (!actor) return true;
  const { user, apiKey } = actor;
  const isAdmin = (user && user.role === 'admin') || (apiKey && apiKey.role === 'admin');
  const isLegacy = (apiKey && apiKey.isLegacy) || (user && user.isLegacy);
  const subject = (user && user.subject) || (apiKey && apiKey.subject);
  return Boolean(isAdmin || isLegacy || subject === donorPublicKey);
}

/**
 * Create a recurring donation schedule.
 *
 * @param {Object} input
 * @param {string} input.donorPublicKey
 * @param {string} input.recipientPublicKey
 * @param {number|string} input.amount - XLM per execution
 * @param {string} input.frequency - one of VALID_FREQUENCIES
 * @param {number} [input.intervalDays] - required for `custom` (alias: customIntervalDays)
 * @param {number} [input.maxExecutions]
 * @param {string} [input.webhookUrl]
 * @param {string} [input.startDate] - ISO date of the first execution (must be in the future)
 * @returns {Promise<Object>} Created schedule (formatSchedule shape)
 */
async function create(input = {}) {
  const { donorPublicKey, recipientPublicKey, amount, frequency } = input;

  const missing = ['donorPublicKey', 'recipientPublicKey', 'amount', 'frequency']
    .filter((field) => isMissing(input[field]));
  if (missing.length > 0) {
    throw new RecurringScheduleError(
      CODES.MISSING_FIELDS,
      `Missing required fields: ${missing.join(', ')}`,
      { missing },
    );
  }

  const amountXlm = normaliseAmount(amount);
  const normalizedFreq = normaliseFrequency(frequency);
  const rawInterval = input.intervalDays !== undefined ? input.intervalDays : input.customIntervalDays;
  const intervalDays = normaliseInterval(normalizedFreq, rawInterval);

  let maxExecutions = null;
  if (!isMissing(input.maxExecutions)) {
    const n = Number(input.maxExecutions);
    if (!Number.isInteger(n) || n < 1) {
      throw new RecurringScheduleError(
        CODES.INVALID_MAX_EXECUTIONS,
        'Invalid maxExecutions: must be an integer of at least 1',
        { field: 'maxExecutions' },
      );
    }
    maxExecutions = n;
  }

  let firstExecution;
  if (!isMissing(input.startDate)) {
    firstExecution = new Date(input.startDate);
    if (Number.isNaN(firstExecution.getTime())) {
      throw new RecurringScheduleError(CODES.INVALID_START_DATE, 'Invalid startDate format', { field: 'startDate' });
    }
    if (firstExecution.getTime() < Date.now() + 60000) {
      throw new RecurringScheduleError(CODES.INVALID_START_DATE, 'Start date must be in the future', { field: 'startDate' });
    }
  } else {
    firstExecution = computeNextExecutionDate(normalizedFreq, intervalDays);
  }

  const wallets = await Database.all(
    'SELECT id, publicKey FROM users WHERE publicKey IN (?, ?)',
    [donorPublicKey, recipientPublicKey],
  );
  const donor = wallets.find((w) => w.publicKey === donorPublicKey);
  const recipient = wallets.find((w) => w.publicKey === recipientPublicKey);

  if (!donor) {
    throw new RecurringScheduleError(CODES.DONOR_NOT_FOUND, 'Donor wallet not found', { field: 'donorPublicKey' });
  }
  if (!recipient) {
    throw new RecurringScheduleError(CODES.RECIPIENT_NOT_FOUND, 'Recipient wallet not found', { field: 'recipientPublicKey' });
  }
  if (donor.id === recipient.id) {
    throw new RecurringScheduleError(CODES.SELF_DONATION, 'Donor and recipient cannot be the same');
  }

  // Monetary values are stored as integer stroops (ADR-004).
  const amountStroops = toStroops(amountXlm);
  const result = await Database.run(
    `INSERT INTO recurring_donations
       (donorId, recipientId, amount_stroops, frequency, customIntervalDays,
        maxExecutions, webhookUrl, nextExecutionDate, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      donor.id,
      recipient.id,
      amountStroops,
      normalizedFreq,
      intervalDays,
      maxExecutions,
      input.webhookUrl || null,
      firstExecution.toISOString(),
      SCHEDULE_STATUS.ACTIVE,
    ],
  );

  return formatSchedule(await getScheduleRow(result.id));
}

/**
 * Update amount and/or frequency (and interval) of a schedule. Changing the
 * frequency or interval recalculates nextExecutionDate from now.
 *
 * @param {number|string} id
 * @param {Object} changes - { amount?, frequency?, intervalDays?, customIntervalDays? }
 * @param {Object} [actor] - { user, apiKey } for the ownership check
 * @returns {Promise<{ schedule: Object, oldValues: Object, newValues: Object }>}
 */
async function update(id, changes = {}, actor = null) {
  const { amount, frequency } = changes;
  const rawInterval = changes.intervalDays !== undefined ? changes.intervalDays : changes.customIntervalDays;

  if (amount === undefined && frequency === undefined && rawInterval === undefined) {
    throw new RecurringScheduleError(
      CODES.NO_CHANGES,
      'At least one of amount, frequency or intervalDays must be provided',
    );
  }

  const newAmountXlm = amount !== undefined ? normaliseAmount(amount) : null;
  const requestedFreq = frequency !== undefined ? normaliseFrequency(frequency) : null;

  const current = await getScheduleRow(id);
  if (!current) {
    throw new RecurringScheduleError(CODES.NOT_FOUND, 'Schedule not found');
  }
  if (!canModify(actor, current.donorPublicKey)) {
    throw new RecurringScheduleError(
      CODES.FORBIDDEN,
      'You do not have permission to update this schedule. Only the schedule owner or an admin can update it.',
    );
  }
  if (current.status === SCHEDULE_STATUS.CANCELLED || current.status === 'suspended'
    || current.status === SCHEDULE_STATUS.COMPLETED) {
    throw new RecurringScheduleError(CODES.CONFLICT, `Cannot update a schedule with status: ${current.status}`);
  }

  const newFrequency = requestedFreq || current.frequency;
  const intervalSource = rawInterval !== undefined ? rawInterval : current.customIntervalDays;
  const newInterval = normaliseInterval(newFrequency, intervalSource);
  const newAmountStroops = newAmountXlm !== null ? toStroops(newAmountXlm) : current.amount_stroops;

  const timingChanged = newFrequency !== current.frequency
    || (newInterval || null) !== (current.customIntervalDays || null);
  const nextExecutionDate = timingChanged
    ? computeNextExecutionDate(newFrequency, newInterval).toISOString()
    : current.nextExecutionDate;

  await Database.run(
    `UPDATE recurring_donations
       SET amount_stroops = ?, frequency = ?, customIntervalDays = ?, nextExecutionDate = ?
     WHERE id = ?`,
    [newAmountStroops, newFrequency, newInterval, nextExecutionDate, id],
  );

  return {
    schedule: formatSchedule(await getScheduleRow(id)),
    oldValues: {
      amount: fromStroops(current.amount_stroops),
      frequency: current.frequency,
      intervalDays: current.customIntervalDays || null,
    },
    newValues: {
      amount: fromStroops(newAmountStroops),
      amountStroops: newAmountStroops,
      frequency: newFrequency,
      intervalDays: newInterval,
    },
  };
}

/**
 * Pause an active schedule.
 * @returns {Promise<{ id: number, status: string, pausedAt: string }>}
 */
async function pause(id, actor = null) {
  const current = await getScheduleRow(id);
  if (!current) throw new RecurringScheduleError(CODES.NOT_FOUND, 'Schedule not found');
  if (!canModify(actor, current.donorPublicKey)) {
    throw new RecurringScheduleError(
      CODES.FORBIDDEN,
      'You do not have permission to pause this schedule. Only the schedule owner or an admin can pause it.',
    );
  }
  if (current.status === SCHEDULE_STATUS.PAUSED) {
    throw new RecurringScheduleError(CODES.CONFLICT, 'Schedule is already paused');
  }
  if (current.status !== SCHEDULE_STATUS.ACTIVE) {
    throw new RecurringScheduleError(CODES.INVALID_STATE, `Cannot pause a schedule with status: ${current.status}`);
  }

  const pausedAt = new Date().toISOString();
  await Database.run(
    'UPDATE recurring_donations SET status = ?, pausedAt = ? WHERE id = ?',
    [SCHEDULE_STATUS.PAUSED, pausedAt, id],
  );
  return { id: current.id, status: SCHEDULE_STATUS.PAUSED, pausedAt };
}

/**
 * Resume a paused schedule; nextExecutionDate is recalculated from now.
 * @returns {Promise<{ id: number, status: string, resumedAt: string, nextExecutionDate: string }>}
 */
async function resume(id, actor = null) {
  const current = await getScheduleRow(id);
  if (!current) throw new RecurringScheduleError(CODES.NOT_FOUND, 'Schedule not found');
  if (!canModify(actor, current.donorPublicKey)) {
    throw new RecurringScheduleError(
      CODES.FORBIDDEN,
      'You do not have permission to resume this schedule. Only the schedule owner or an admin can resume it.',
    );
  }
  if (current.status !== SCHEDULE_STATUS.PAUSED) {
    throw new RecurringScheduleError(CODES.INVALID_STATE, `Cannot resume a schedule with status: ${current.status}`);
  }

  const now = new Date();
  const nextExecutionDate = computeNextExecutionDate(current.frequency, current.customIntervalDays, now).toISOString();
  const resumedAt = now.toISOString();
  await Database.run(
    'UPDATE recurring_donations SET status = ?, resumedAt = ?, nextExecutionDate = ? WHERE id = ?',
    [SCHEDULE_STATUS.ACTIVE, resumedAt, nextExecutionDate, id],
  );
  return { id: current.id, status: SCHEDULE_STATUS.ACTIVE, resumedAt, nextExecutionDate };
}

module.exports = {
  RecurringScheduleError,
  CODES,
  create,
  update,
  pause,
  resume,
  computeNextExecutionDate,
  formatSchedule,
  getScheduleRow,
};
