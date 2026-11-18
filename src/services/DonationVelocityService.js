/**
 * DonationVelocityService — Sliding-window per-donor velocity enforcement
 *
 * Replaces the fixed-window counter approach with a true sliding-window algorithm
 * using a log of timestamps. This prevents the fixed-window boundary exploit where
 * a donor could make 2× the allowed transactions by straddling a window boundary.
 *
 * Algorithm:
 *   On each donation attempt:
 *     1. Delete all velocity_log rows for the donor older than VELOCITY_WINDOW_SECONDS.
 *     2. COUNT remaining rows — that is the true number of donations in the sliding window.
 *     3. If count >= tier limit → reject with HTTP 429 + Retry-After header.
 *     4. Otherwise record the new donation and proceed.
 *
 * Tier-based limits (configurable via env vars, defaults below):
 *   free:     VELOCITY_LIMIT_FREE     (default 5)  donations per VELOCITY_WINDOW_SECONDS
 *   standard: VELOCITY_LIMIT_STANDARD (default 20) donations per VELOCITY_WINDOW_SECONDS
 *   premium:  VELOCITY_LIMIT_PREMIUM  (default 100) donations per VELOCITY_WINDOW_SECONDS
 *
 * Window duration: VELOCITY_WINDOW_SECONDS (default 3600 = 1 hour)
 *
 * The velocity_log table is SQLite-backed so limits survive service restarts.
 *
 * Backward-compatible exports retained:
 *   setLimits, getLimits, getVelocityUsage, getWindowStart, getWindowEnd
 *   checkVelocityLimits, recordDonation
 */

'use strict';

const Database = require('../utils/database');
const { AppError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { DONATION_FREQUENCIES, MS_PER_DAY, MS_PER_WEEK, MONTHLY_WINDOW_DAY } = require('../constants');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Allowed velocity-tracking window types — reuses the canonical donation frequencies. */
const WINDOW_TYPES = Object.freeze({
  DAILY: DONATION_FREQUENCIES.DAILY,
  WEEKLY: DONATION_FREQUENCIES.WEEKLY,
  MONTHLY: DONATION_FREQUENCIES.MONTHLY,
});

/** Sliding-window duration in seconds. Configurable via env. */
function getWindowSeconds() {
  return parseInt(process.env.VELOCITY_WINDOW_SECONDS, 10) || 3600;
}

/** Per-tier hourly donation limits. Configurable via env. */
const TIER_LIMITS = Object.freeze({
  free: () => parseInt(process.env.VELOCITY_LIMIT_FREE, 10) || 5,
  standard: () => parseInt(process.env.VELOCITY_LIMIT_STANDARD, 10) || 20,
  premium: () => parseInt(process.env.VELOCITY_LIMIT_PREMIUM, 10) || 100,
});

// ── Custom error ──────────────────────────────────────────────────────────────

class VelocityLimitExceededError extends AppError {
  /**
   * @param {number} retryAfterSeconds - Seconds until the oldest slot in the window expires.
   * @param {number} limit             - The applicable tier limit.
   * @param {number} windowSeconds     - The window duration.
   */
  constructor(retryAfterSeconds, limit, windowSeconds) {
    super(
      'VELOCITY_LIMIT_EXCEEDED',
      `Donation velocity limit of ${limit} per ${windowSeconds}s exceeded. ` +
      `Retry after ${retryAfterSeconds}s.`,
      429,
      { retryAfter: retryAfterSeconds, limit, window: `${windowSeconds}s` }
    );
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ── Sliding-window helpers ────────────────────────────────────────────────────

/**
 * Ensure the velocity_log table exists.
 * Called lazily; safe to call multiple times.
 */
async function _ensureTable() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS velocity_log (
      id         INTEGER  PRIMARY KEY AUTOINCREMENT,
      donor_id   INTEGER  NOT NULL,
      api_key    TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await Database.run(`
    CREATE INDEX IF NOT EXISTS idx_velocity_log_donor_created
    ON velocity_log(donor_id, created_at)
  `);
}

/**
 * Get the donor tier for a given donor ID.
 * Looks for a `tier` column on the users table; defaults to 'free'.
 *
 * @param {number|string} donorId
 * @returns {Promise<string>} 'free' | 'standard' | 'premium'
 */
async function _getDonorTier(donorId) {
  try {
    const row = await Database.get(
      'SELECT tier FROM users WHERE id = ?',
      [donorId]
    );
    if (row && row.tier && TIER_LIMITS[row.tier]) return row.tier;
  } catch (_) {
    // tier column may not exist in older schemas — fall back to 'free'
  }
  return 'free';
}

/**
 * Compute seconds until the oldest entry in the window expires.
 * This is the precise Retry-After value.
 *
 * @param {number|string} donorId
 * @param {number}        windowSeconds
 * @param {number}        [nowMs]
 * @returns {Promise<number>} seconds (minimum 1)
 */
async function _retryAfterSeconds(donorId, windowSeconds, nowMs = Date.now()) {
  const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString();
  const oldest = await Database.get(
    `SELECT created_at FROM velocity_log
     WHERE donor_id = ? AND created_at > ?
     ORDER BY created_at ASC
     LIMIT 1`,
    [donorId, windowStart]
  );
  if (!oldest) return 1;
  const oldestMs = new Date(oldest.created_at).getTime();
  const expiresAt = oldestMs + windowSeconds * 1000;
  return Math.max(1, Math.ceil((expiresAt - nowMs) / 1000));
}

// ── Public sliding-window API ─────────────────────────────────────────────────

/**
 * Check if a donor is within their velocity limit.
 * Throws VelocityLimitExceededError (HTTP 429) if the limit is exceeded.
 *
 * @param {number|string} donorId
 * @param {string}        [apiKey]
 */
async function checkSlidingVelocity(donorId, apiKey) {
  await _ensureTable();

  const windowSeconds = getWindowSeconds();
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - windowSeconds * 1000).toISOString();

  // Remove stale entries for this donor (keeps the table lean).
  await Database.run(
    'DELETE FROM velocity_log WHERE donor_id = ? AND created_at <= ?',
    [donorId, windowStart]
  );

  // Count remaining entries in the sliding window.
  const countRow = await Database.get(
    'SELECT COUNT(*) AS cnt FROM velocity_log WHERE donor_id = ?',
    [donorId]
  );
  const currentCount = countRow ? countRow.cnt : 0;

  // Resolve the donor's tier and its limit.
  const tier = await _getDonorTier(donorId);
  const limit = TIER_LIMITS[tier]();

  if (currentCount >= limit) {
    const retryAfter = await _retryAfterSeconds(donorId, windowSeconds, nowMs);
    throw new VelocityLimitExceededError(retryAfter, limit, windowSeconds);
  }
}

/**
 * Record a donation in the sliding-window log.
 * Call this AFTER the donation has been successfully created.
 *
 * @param {number|string} donorId
 * @param {string}        [apiKey]
 */
async function recordSlidingDonation(donorId, apiKey) {
  await _ensureTable();
  await Database.run(
    'INSERT INTO velocity_log (donor_id, api_key, created_at) VALUES (?, ?, ?)',
    [donorId, apiKey || null, new Date().toISOString()]
  );
}

// ── Backward-compatible helpers (legacy fixed-window API) ─────────────────────

/**
 * Compute the window start timestamp for a given window type (UTC).
 * Retained for backward compatibility with existing callers.
 */
function getWindowStart(windowType, now = new Date()) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);

  if (windowType === WINDOW_TYPES.MONTHLY) {
    d.setUTCDate(MONTHLY_WINDOW_DAY);
  } else if (windowType === WINDOW_TYPES.WEEKLY) {
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setUTCDate(d.getUTCDate() - diff);
  }
  return d.toISOString();
}

/**
 * Compute the window end timestamp.
 * Retained for backward compatibility.
 */
function getWindowEnd(windowType, now = new Date()) {
  const start = new Date(getWindowStart(windowType, now));
  if (windowType === WINDOW_TYPES.DAILY) return new Date(start.getTime() + MS_PER_DAY);
  if (windowType === WINDOW_TYPES.WEEKLY) return new Date(start.getTime() + MS_PER_WEEK);
  const next = new Date(start);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** Set or update per-recipient velocity limits (legacy API). */
async function setLimits(recipientId, { maxAmount, maxCount, windowType = WINDOW_TYPES.DAILY }) {
  if (!Object.values(WINDOW_TYPES).includes(windowType)) {
    const err = new Error(
      `Invalid windowType "${windowType}". Must be one of ${Object.values(WINDOW_TYPES).join(', ')}.`
    );
    err.status = 400;
    throw err;
  }

  const recipient = await Database.get('SELECT id FROM users WHERE id = ?', [recipientId]);
  if (!recipient) throw new NotFoundError('Recipient not found', ERROR_CODES.USER_NOT_FOUND);

  await Database.run(
    `INSERT INTO recipient_velocity_limits (recipientId, maxAmount, maxCount, windowType, updatedAt)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(recipientId) DO UPDATE SET
       maxAmount  = excluded.maxAmount,
       maxCount   = excluded.maxCount,
       windowType = excluded.windowType,
       updatedAt  = CURRENT_TIMESTAMP`,
    [recipientId, maxAmount ?? null, maxCount ?? null, windowType]
  );
}

/** Get per-recipient velocity limits (legacy API). */
async function getLimits(recipientId) {
  const row = await Database.get(
    'SELECT * FROM recipient_velocity_limits WHERE recipientId = ?',
    [recipientId]
  );
  return row || null;
}

/**
 * Check velocity limits using the NEW sliding-window algorithm.
 * The `amount` parameter is accepted for backward compatibility but is ignored
 * by the sliding window (which only tracks count, not amount).
 *
 * For legacy per-recipient amount limits, the old logic is also preserved below.
 *
 * @param {number} donorId
 * @param {number} recipientId
 * @param {number} amount
 */
async function checkVelocityLimits(donorId, recipientId, amount) {
  // ── New sliding-window per-donor count check ──
  await checkSlidingVelocity(donorId);

  // ── Legacy per-recipient amount/count limits (preserved) ──
  const limits = await getLimits(recipientId);
  if (!limits) return;

  const windowType = limits.windowType || WINDOW_TYPES.DAILY;
  const windowStart = getWindowStart(windowType);
  const windowEnd = getWindowEnd(windowType);

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
      `Donation would exceed the per-recipient amount limit of ${limits.maxAmount} per ` +
      `${windowType} window. Used: ${currentTotal}, Requested: ${amount}`,
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
      `Donation would exceed the per-recipient count limit of ${limits.maxCount} per ` +
      `${windowType} window. Used: ${currentCount}`,
      429,
      { limit: limits.maxCount, used: currentCount, resetAt }
    );
    err.resetAt = resetAt;
    throw err;
  }
}

/**
 * Record a completed donation in both the sliding-window log and the legacy tracker.
 *
 * @param {number} donorId
 * @param {number} recipientId
 * @param {number} amount
 * @param {string} [windowType]
 * @param {string} [apiKey]
 */
async function recordDonation(donorId, recipientId, amount, windowType = WINDOW_TYPES.DAILY, apiKey) {
  // Record in new sliding-window log.
  await recordSlidingDonation(donorId, apiKey);

  // Also update legacy donation_velocity for backward-compatible reads.
  const limits = await getLimits(recipientId).catch(() => null);
  const wt = (limits && limits.windowType) || windowType;
  const windowStart = getWindowStart(wt);

  await Database.run(
    `INSERT INTO donation_velocity (donorId, recipientId, windowStart, totalAmount, count, updatedAt)
     VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
     ON CONFLICT(donorId, recipientId, windowStart) DO UPDATE SET
       totalAmount = totalAmount + excluded.totalAmount,
       count       = count + 1,
       updatedAt   = CURRENT_TIMESTAMP`,
    [donorId, recipientId, windowStart, amount]
  );
}

/**
 * Get current velocity usage for a donor→recipient pair.
 * Returns sliding-window count alongside legacy totals.
 */
async function getVelocityUsage(donorId, recipientId) {
  await _ensureTable();

  const windowSeconds = getWindowSeconds();
  const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

  const slidingRow = await Database.get(
    'SELECT COUNT(*) AS cnt FROM velocity_log WHERE donor_id = ? AND created_at > ?',
    [donorId, windowStart]
  );

  const tier = await _getDonorTier(donorId);
  const limit = TIER_LIMITS[tier]();

  // Legacy per-recipient data.
  const limits = await getLimits(recipientId);
  const legacyWindowType = (limits && limits.windowType) || WINDOW_TYPES.DAILY;
  const legacyWindowStart = getWindowStart(legacyWindowType);

  const legacyRow = await Database.get(
    `SELECT totalAmount, count FROM donation_velocity
     WHERE donorId = ? AND recipientId = ? AND windowStart = ?`,
    [donorId, recipientId, legacyWindowStart]
  );

  return {
    donorId,
    recipientId,
    // Sliding-window fields
    tier,
    slidingWindowCount: slidingRow ? slidingRow.cnt : 0,
    slidingWindowLimit: limit,
    slidingWindowSeconds: windowSeconds,
    // Legacy fields
    windowType: legacyWindowType,
    windowStart: legacyWindowStart,
    totalAmount: legacyRow ? legacyRow.totalAmount : 0,
    count: legacyRow ? legacyRow.count : 0,
    limits: limits || null,
  };
}

module.exports = {
  // Sliding-window API (new)
  checkSlidingVelocity,
  recordSlidingDonation,
  VelocityLimitExceededError,
  TIER_LIMITS,
  getWindowSeconds,
  // Legacy API (backward-compatible)
  setLimits,
  getLimits,
  checkVelocityLimits,
  recordDonation,
  getVelocityUsage,
  getWindowStart,
  getWindowEnd,
};
