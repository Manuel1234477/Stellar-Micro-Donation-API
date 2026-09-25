/**
 * Limit Service - Donation Limit Enforcement Layer
 *
 * RESPONSIBILITY: Per-wallet donation limit checking, tracking, and management
 * OWNER: Backend Team
 * DEPENDENCIES: Database, config, errors
 *
 * Enforces per-wallet daily, monthly, and per-transaction donation limits.
 * Falls back to global config limits when per-wallet limits are not set.
 * All limit values are stored and compared in stroops.
 */

const Database = require('../utils/database');
const config = require('../config');
const { BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const { toStroops } = require('../utils/money');

/**
 * Normalize a limit value to stroops.
 * Accepts null/undefined (no limit) or a numeric amount in XLM.
 * @param {number|null|undefined} value - Limit in XLM
 * @returns {number|null} Limit in stroops, or null when unset
 */
function normalizeLimit(value) {
  if (value === null || value === undefined) return null;
  const stroops = toStroops(value);
  return Number.isFinite(stroops) ? stroops : null;
}

/**
 * Get the daily donation total for a user (UTC day), in stroops
 * @param {number} userId - User ID
 * @returns {Promise<number>} Total amount donated today in stroops
 */
async function getDailyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE senderId = ? AND date(timestamp) = date('now')`,
    [userId]
  );
  return row ? toStroops(row.total) : 0;
}

/**
 * Get the monthly donation total for a user (UTC month), in stroops
 * @param {number} userId - User ID
 * @returns {Promise<number>} Total amount donated this month in stroops
 */
async function getMonthlyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE senderId = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
    [userId]
  );
  return row ? toStroops(row.total) : 0;
}

/**
 * Check all applicable limits for a donation
 * Throws BusinessLogicError (422) if any limit is exceeded.
 * @param {number} userId - Sender user ID
 * @param {number} amount - Donation amount in XLM
 * @returns {Promise<void>}
 */
async function checkLimits(userId, amount) {
  const user = await Database.get(
    'SELECT daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
    [userId]
  );

  if (!user) return;

  const amountStroops = toStroops(amount);

  // Resolve effective limits: per-wallet overrides global when set
  const globalMax = config.donations.maxAmount;
  const globalDailyMax = config.donations.maxDailyPerDonor;

  const perTxLimit = user.per_transaction_limit != null
    ? normalizeLimit(user.per_transaction_limit)
    : normalizeLimit(globalMax);
  const dailyLimit = user.daily_limit != null
    ? normalizeLimit(user.daily_limit)
    : (globalDailyMax > 0 ? normalizeLimit(globalDailyMax) : null);
  const monthlyLimit = user.monthly_limit != null ? normalizeLimit(user.monthly_limit) : null;

  // Per-transaction check
  if (perTxLimit != null && amountStroops > perTxLimit) {
    throw new BusinessLogicError(
      ERROR_CODES.DONATION_LIMIT_EXCEEDED,
      `Donation amount ${amount} exceeds per-transaction limit of ${perTxLimit} stroops`,
      { limit: perTxLimit, amount: amountStroops, limitType: 'per_transaction' }
    );
  }

  // Daily limit check
  if (dailyLimit != null) {
    const dailyTotal = await getDailyTotal(userId);
    if (dailyTotal + amountStroops > dailyLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.DONATION_LIMIT_EXCEEDED,
        `Donation would exceed daily limit of ${dailyLimit} stroops. Used: ${dailyTotal}, Requested: ${amountStroops}`,
        { limit: dailyLimit, used: dailyTotal, amount: amountStroops, remaining: Math.max(0, dailyLimit - dailyTotal), limitType: 'daily' }
      );
    }
  }

  // Monthly limit check
  if (monthlyLimit != null) {
    const monthlyTotal = await getMonthlyTotal(userId);
    if (monthlyTotal + amountStroops > monthlyLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.DONATION_LIMIT_EXCEEDED,
        `Donation would exceed monthly limit of ${monthlyLimit} stroops. Used: ${monthlyTotal}, Requested: ${amountStroops}`,
        { limit: monthlyLimit, used: monthlyTotal, amount: amountStroops, remaining: Math.max(0, monthlyLimit - monthlyTotal), limitType: 'monthly' }
      );
    }
  }
}

/**
 * Get remaining daily and monthly limits for a user (in stroops)
 * @param {number} userId - User ID
 * @returns {Promise<{dailyRemaining: number|null, monthlyRemaining: number|null}>}
 */
async function getRemainingLimits(userId) {
  const user = await Database.get(
    'SELECT daily_limit, monthly_limit FROM users WHERE id = ?',
    [userId]
  );

  if (!user) return { dailyRemaining: null, monthlyRemaining: null };

  const globalDailyMax = config.donations.maxDailyPerDonor;
  const dailyLimit = user.daily_limit != null
    ? normalizeLimit(user.daily_limit)
    : (globalDailyMax > 0 ? normalizeLimit(globalDailyMax) : null);
  const monthlyLimit = user.monthly_limit != null ? normalizeLimit(user.monthly_limit) : null;

  let dailyRemaining = null;
  let monthlyRemaining = null;

  if (dailyLimit != null) {
    const dailyTotal = await getDailyTotal(userId);
    dailyRemaining = Math.max(0, dailyLimit - dailyTotal);
  }

  if (monthlyLimit != null) {
    const monthlyTotal = await getMonthlyTotal(userId);
    monthlyRemaining = Math.max(0, monthlyLimit - monthlyTotal);
  }

  return { dailyRemaining, monthlyRemaining };
}

/**
 * Set per-wallet donation limits for a user.
 * Passing null explicitly clears the corresponding limit.
 * @param {number} userId - User ID
 * @param {Object} limits - Limit values
 * @param {number|null} limits.daily_limit - Daily limit (null to clear)
 * @param {number|null} limits.monthly_limit - Monthly limit (null to clear)
 * @param {number|null} limits.per_transaction_limit - Per-transaction limit (null to clear)
 * @returns {Promise<void>}
 */
async function setWalletLimits(userId, { daily_limit, monthly_limit, per_transaction_limit }) {
  await Database.run(
    `UPDATE users SET daily_limit = ?, monthly_limit = ?, per_transaction_limit = ? WHERE id = ?`,
    [
      daily_limit !== undefined ? daily_limit : null,
      monthly_limit !== undefined ? monthly_limit : null,
      per_transaction_limit !== undefined ? per_transaction_limit : null,
      userId
    ]
  );
}

module.exports = { checkLimits, getRemainingLimits, setWalletLimits, getDailyTotal, getMonthlyTotal, normalizeLimit };
