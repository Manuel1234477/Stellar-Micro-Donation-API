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
 * Convert a stored stroops value (INTEGER column) to BigInt.
 * Accepts null/undefined (no limit) or a numeric/string value.
 * @param {number|string|bigint|null|undefined} value - Limit in stroops
 * @returns {bigint|null} Limit in stroops as BigInt, or null when unset
 */
function toStroopsBigInt(value) {
  if (value === null || value === undefined) return null;
  try {
    return BigInt(value);
  } catch (err) {
    return null;
  }
}

/**
 * Normalize a limit value to stroops.
 * Accepts null/undefined (no limit) or a numeric amount in XLM.
 * @param {number|null|undefined} value - Limit in XLM
 * @returns {bigint|null} Limit in stroops, or null when unset
 */
function normalizeLimit(value) {
  if (value === null || value === undefined) return null;
  const stroops = toStroops(value);
  return Number.isFinite(stroops) ? BigInt(stroops) : null;
}

/**
 * Get the daily donation total for a user (UTC day), in stroops
 * @param {number} userId - User ID
 * @returns {Promise<bigint>} Total amount donated today in stroops
 */
async function getDailyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount_stroops), 0) as total
     FROM transactions
     WHERE senderId = ? AND date(timestamp) = date('now')`,
    [userId]
  );
  return row ? toStroopsBigInt(row.total) || 0n : 0n;
}

/**
 * Get the monthly donation total for a user (UTC month), in stroops
 * @param {number} userId - User ID
 * @returns {Promise<bigint>} Total amount donated this month in stroops
 */
async function getMonthlyTotal(userId) {
  const row = await Database.get(
    `SELECT COALESCE(SUM(amount_stroops), 0) as total
     FROM transactions
     WHERE senderId = ? AND strftime('%Y-%m', timestamp) = strftime('%Y-%m', 'now')`,
    [userId]
  );
  return row ? toStroopsBigInt(row.total) || 0n : 0n;
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
    'SELECT daily_limit_stroops, monthly_limit_stroops, per_transaction_limit_stroops FROM users WHERE id = ?',
    [userId]
  );

  if (!user) return;

  const amountStroops = BigInt(toStroops(amount));

  // Resolve effective limits: per-wallet overrides global when set
  const globalMax = config.donations.maxAmount;
  const globalDailyMax = config.donations.maxDailyPerDonor;

  const perTxLimit = user.per_transaction_limit_stroops != null
    ? toStroopsBigInt(user.per_transaction_limit_stroops)
    : normalizeLimit(globalMax);
  const dailyLimit = user.daily_limit_stroops != null
    ? toStroopsBigInt(user.daily_limit_stroops)
    : (globalDailyMax > 0 ? normalizeLimit(globalDailyMax) : null);
  const monthlyLimit = user.monthly_limit_stroops != null
    ? toStroopsBigInt(user.monthly_limit_stroops)
    : null;

  // Per-transaction check
  if (perTxLimit != null && amountStroops > perTxLimit) {
    throw new BusinessLogicError(
      ERROR_CODES.DONATION_LIMIT_EXCEEDED,
      `Donation amount ${amount} exceeds per-transaction limit of ${perTxLimit} stroops`,
      { limit: perTxLimit.toString(), amount: amountStroops.toString(), limitType: 'per_transaction' }
    );
  }

  // Daily limit check
  if (dailyLimit != null) {
    const dailyTotal = await getDailyTotal(userId);
    if (dailyTotal + amountStroops > dailyLimit) {
      throw new BusinessLogicError(
        ERROR_CODES.DONATION_LIMIT_EXCEEDED,
        `Donation would exceed daily limit of ${dailyLimit} stroops. Used: ${dailyTotal}, Requested: ${amountStroops}`,
        {
          limit: dailyLimit.toString(),
          used: dailyTotal.toString(),
          amount: amountStroops.toString(),
          remaining: (dailyLimit > dailyTotal ? dailyLimit - dailyTotal : 0n).toString(),
          limitType: 'daily'
        }
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
        {
          limit: monthlyLimit.toString(),
          used: monthlyTotal.toString(),
          amount: amountStroops.toString(),
          remaining: (monthlyLimit > monthlyTotal ? monthlyLimit - monthlyTotal : 0n).toString(),
          limitType: 'monthly'
        }
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
    'SELECT daily_limit_stroops, monthly_limit_stroops FROM users WHERE id = ?',
    [userId]
  );

  if (!user) return { dailyRemaining: null, monthlyRemaining: null };

  const globalDailyMax = config.donations.maxDailyPerDonor;
  const dailyLimit = user.daily_limit_stroops != null
    ? toStroopsBigInt(user.daily_limit_stroops)
    : (globalDailyMax > 0 ? normalizeLimit(globalDailyMax) : null);
  const monthlyLimit = user.monthly_limit_stroops != null
    ? toStroopsBigInt(user.monthly_limit_stroops)
    : null;

  let dailyRemaining = null;
  let monthlyRemaining = null;

  if (dailyLimit != null) {
    const dailyTotal = await getDailyTotal(userId);
    dailyRemaining = dailyLimit > dailyTotal ? dailyLimit - dailyTotal : 0n;
  }

  if (monthlyLimit != null) {
    const monthlyTotal = await getMonthlyTotal(userId);
    monthlyRemaining = monthlyLimit > monthlyTotal ? monthlyLimit - monthlyTotal : 0n;
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
    `UPDATE users SET daily_limit_stroops = ?, monthly_limit_stroops = ?, per_transaction_limit_stroops = ? WHERE id = ?`,
    [
      daily_limit !== undefined ? normalizeLimit(daily_limit) : null,
      monthly_limit !== undefined ? normalizeLimit(monthly_limit) : null,
      per_transaction_limit !== undefined ? normalizeLimit(per_transaction_limit) : null,
      userId
    ]
  );
}

module.exports = { checkLimits, getRemainingLimits, setWalletLimits, getDailyTotal, getMonthlyTotal, normalizeLimit };
