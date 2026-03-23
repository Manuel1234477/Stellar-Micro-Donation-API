/**
 * Limit Service - Donation Limit Enforcement Layer
 *
 * RESPONSIBILITY: Per-wallet donation limit checking, tracking, and management
 * OWNER: Backend Team
 * DEPENDENCIES: Database, config, errors
 *
 * Enforces per-wallet daily, monthly, and per-transaction donation limits.
 * Falls back to global config limits when per-wallet limits are not set.
 */

const Database = require('../utils/database');
const config = require('../config');
const { BusinessLogicError, ERROR_CODES } = require('../utils/errors');

/**
 * Get the daily donation total for a user (UTC day)
 * @param {number} userId - User ID
 * @returns {Promise<number>} Total amount donated today
 */
async function getDailyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE senderId = ? AND date(timestamp) = date('now')`,
    [userId]
  );
  return row ? row.total : 0;
}

/**
 * Get the monthly donation total for a user (UTC month)
 * @param {number} userId - User ID
 * @returns {Promise<number>} Total amount donated this month
 */
async function getMonthlyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE senderId = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
    [userId]
  );
  return row ? row.total : 0;
}

/**
 * Check all applicable limits for a donation
 * Throws BusinessLogicError (422) if any limit is exceeded.
 * @param {number} userId - Sender user ID
 * @param {number} amount - Donation amount
 * @returns {Promise<void>}
 */
async function checkLimits(userId, amount) {
  const user = await Database.get(
    'SELECT daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
    [userId]
  );

  if (!user) return;

  // Resolve effective limits: per-wallet overrides global when set
  const globalMax = config.donations.maxAmount;
  const globalDailyMax = config.donations.maxDailyPerDonor;

  const perTxLimit = user.per_transaction_limit != null ? user.per_transaction_limit : globalMax;
  const dailyLimit = user.daily_limit != null ? user.daily_limit : (globalDailyMax > 0 ? globalDailyMax : null);
  const monthlyLimit = user.monthly_limit != null ? user.monthly_limit : null;

  // Per-transaction check
  if (perTxLimit != null && amount > perTxLimit) {
    throw new BusinessLogicError(
      ERROR_CODES.INVALID_AMOUNT,
      `Donation amount ${amount} exceeds per-transaction limit of ${perTxLimit}`,
      { limit: perTxLimit, amount }
    );
  }

  // Daily limit check
  if (dailyLimit != null) {
    const dailyTotal = await getDailyTotal(userId);
    if (dailyTotal + amount > dailyLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.INVALID_AMOUNT,
        `Donation would exceed daily limit of ${dailyLimit}. Used: ${dailyTotal}, Requested: ${amount}`,
        { limit: dailyLimit, used: dailyTotal, amount, remaining: Math.max(0, dailyLimit - dailyTotal) }
      );
    }
  }

  // Monthly limit check
  if (monthlyLimit != null) {
    const monthlyTotal = await getMonthlyTotal(userId);
    if (monthlyTotal + amount > monthlyLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.INVALID_AMOUNT,
        `Donation would exceed monthly limit of ${monthlyLimit}. Used: ${monthlyTotal}, Requested: ${amount}`,
        { limit: monthlyLimit, used: monthlyTotal, amount, remaining: Math.max(0, monthlyLimit - monthlyTotal) }
      );
    }
  }
}

/**
 * Get remaining daily and monthly limits for a user
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
  const dailyLimit = user.daily_limit != null ? user.daily_limit : (globalDailyMax > 0 ? globalDailyMax : null);
  const monthlyLimit = user.monthly_limit != null ? user.monthly_limit : null;

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
 * Set per-wallet donation limits for a user
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

module.exports = { checkLimits, getRemainingLimits, setWalletLimits, getDailyTotal, getMonthlyTotal };
