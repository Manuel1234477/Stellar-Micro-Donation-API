/**
 * DonationVelocityService - Per-recipient velocity limit enforcement
 *
 * Tracks donor→recipient donation totals within rolling time windows
 * and enforces configurable limits before Stellar transactions are submitted.
 */
'use strict';

const Database = require('../utils/database');
const { AppError, NotFoundError, ERROR_CODES } = require('../utils/errors');

const WINDOW_TYPES = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' };

/**
 * Compute the window start timestamp for a given window type (UTC).
 * @param {string} windowType - 'daily' | 'weekly' | 'monthly'
 * @param {Date} [now]
 * @returns {string} ISO datetime string for window start
 */
function getWindowStart(windowType, now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);

  if (windowType === 'monthly') {
    d.setUTCDate(1);
  } else if (windowType === 'weekly') {
    // Roll back to Monday
    const day = d.getUTCDay(); // 0=Sun
    const diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
  }
  // daily: already set to start of today

  return d.toISOString();
}

/**
 * Compute the window reset timestamp (end of current window).
 * @param {string} windowType
 * @param {Date} [now]
 * @returns {Date}
 */
function getWindowEnd(windowType, now = new Date()) {
  const start = new Date(getWindowStart(windowType, now));
  if (windowType === 'daily') {
    return new Date(start.getTime() + 24 * 60 * 60 * 1000);
  }
  if (windowType === 'weekly') {
    return new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  // monthly: first day of next month
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/**
 * Set or update velocity limits for a recipient.
 * @param {number} recipientId
 * @param {{ maxAmount?: number, maxCount?: number, windowType?: string }} limits
 */
async function setLimits(recipientId, { maxAmount, maxCount, windowType = 'daily' }) {
  if (!WINDOW_TYPES[windowType]) {
    const err = new Error(`Invalid windowType "${windowType}". Must be daily, weekly, or monthly.`);
    err.status = 400;
    throw err;
  }

  const recipient = await Database.get('SELECT id FROM users WHERE id = ?', [recipientId]);
  if (!recipient) {
    throw new NotFoundError('Recipient not found', ERROR_CODES.USER_NOT_FOUND);
  }

  await Database.run(
    `INSERT INTO recipient_velocity_limits (recipientId, maxAmount, maxCount, windowType, updatedAt)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(recipientId) DO UPDATE SET
       maxAmount = excluded.maxAmount,
       maxCount = excluded.maxCount,
       windowType = excluded.windowType,
       updatedAt = CURRENT_TIMESTAMP`,
    [recipientId, maxAmount ?? null, maxCount ?? null, windowType]
  );
}

/**
 * Get velocity limits for a recipient.
 * @param {number} recipientId
 * @returns {Promise<Object|null>}
 */
async function getLimits(recipientId) {
  return Database.get(
    'SELECT * FROM recipient_velocity_limits WHERE recipientId = ?',
    [recipientId]
  );
}

/**
 * Check velocity limits for a donor→recipient donation.
 * Throws BusinessLogicError (HTTP 429) if a limit is exceeded.
 * @param {number} donorId
 * @param {number} recipientId
 * @param {number} amount
 */
async function checkVelocityLimits(donorId, recipientId, amount) {
  const limits = await getLimits(recipientId);
  if (!limits) return; // no limits configured

  const windowType = limits.windowType || 'daily';
  const windowStart = getWindowStart(windowType);
  const windowEnd = getWindowEnd(windowType);

  // Fetch or create velocity record for this window
  const row = await Database.get(
    `SELECT totalAmount, count FROM donation_velocity
     WHERE donorId = ? AND recipientId = ? AND windowStart = ?`,
    [donorId, recipientId, windowStart]
  );

  const currentTotal = row ? row.totalAmount : 0;
  const currentCount = row ? row.count : 0;

  if (limits.maxAmount != null && currentTotal + amount > limits.maxAmount) {
    const resetAt = windowEnd.toISOString();
    const err = new AppError(
      'VELOCITY_LIMIT_EXCEEDED',
      `Donation would exceed the per-recipient amount limit of ${limits.maxAmount} per ${windowType} window. ` +
      `Used: ${currentTotal}, Requested: ${amount}`,
      429,
      { limit: limits.maxAmount, used: currentTotal, amount, resetAt }
    );
    err.resetAt = resetAt;
    throw err;
  }

  if (limits.maxCount != null && currentCount + 1 > limits.maxCount) {
    const resetAt = windowEnd.toISOString();
    const err = new AppError(
      'VELOCITY_LIMIT_EXCEEDED',
      `Donation would exceed the per-recipient count limit of ${limits.maxCount} per ${windowType} window. ` +
      `Used: ${currentCount}`,
      429,
      { limit: limits.maxCount, used: currentCount, resetAt }
    );
    err.resetAt = resetAt;
    throw err;
  }
}

/**
 * Record a completed donation in the velocity tracker.
 * @param {number} donorId
 * @param {number} recipientId
 * @param {number} amount
 * @param {string} [windowType]
 */
async function recordDonation(donorId, recipientId, amount, windowType = 'daily') {
  const limits = await getLimits(recipientId);
  const wt = (limits && limits.windowType) || windowType;
  const windowStart = getWindowStart(wt);

  await Database.run(
    `INSERT INTO donation_velocity (donorId, recipientId, windowStart, totalAmount, count, updatedAt)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(donorId, recipientId, windowStart) DO UPDATE SET
       totalAmount = totalAmount + excluded.totalAmount,
       count = count + 1,
       updatedAt = CURRENT_TIMESTAMP`,
    [donorId, recipientId, windowStart, amount]
  );
}

/**
 * Get current velocity usage for a donor→recipient pair.
 * @param {number} donorId
 * @param {number} recipientId
 * @returns {Promise<Object>}
 */
async function getVelocityUsage(donorId, recipientId) {
  const limits = await getLimits(recipientId);
  const windowType = (limits && limits.windowType) || 'daily';
  const windowStart = getWindowStart(windowType);

  const row = await Database.get(
    `SELECT totalAmount, count FROM donation_velocity
     WHERE donorId = ? AND recipientId = ? AND windowStart = ?`,
    [donorId, recipientId, windowStart]
  );

  return {
    donorId,
    recipientId,
    windowType,
    windowStart,
    totalAmount: row ? row.totalAmount : 0,
    count: row ? row.count : 0,
    limits: limits || null,
  };
}

module.exports = {
  setLimits,
  getLimits,
  checkVelocityLimits,
  recordDonation,
  getVelocityUsage,
  getWindowStart,
  getWindowEnd,
};
