/**
 * Donation Validation Utility
 * Validates donation amounts against configurable limits
 */

const config = require('../config');

// Stellar amounts are int64 stroops (1 XLM = 10^7 stroops).
// Maximum representable amount in XLM is 922,337,203,685.4775807.
const STROOPS_PER_XLM = 10000000n;
const MAX_STROOPS = 9223372036854775807n;
const MAX_AMOUNT_XLM = '9223372036854775807';

/**
 * Calculate the number of decimal places of a numeric value,
 * robustly handling scientific exponential notation (e.g., 1e-8).
 * @param {number} num
 * @returns {number}
 */
function getDecimalPlaces(num) {
  const str = num.toString();
  if (str.includes('e') || str.includes('E')) {
    const [base, expStr] = str.toLowerCase().split('e');
    const exp = parseInt(expStr, 10);
    if (exp < 0) {
      const baseDecimals = (base.split('.')[1] || '').length;
      return baseDecimals + Math.abs(exp);
    }
    const baseDecimals = (base.split('.')[1] || '').length;
    return Math.max(0, baseDecimals - exp);
  }
  const decimals = str.split('.')[1];
  return decimals ? decimals.length : 0;
}

/**
 * Parse a donation amount into integer stroops using exact decimal string
 * arithmetic. Returns null when the value cannot be represented exactly as
 * a positive int64 stroop amount (rejects NaN, Infinity, scientific
 * notation, > 7 fractional digits, zero, and values above int64 max).
 * @param {number|string} amount
 * @returns {bigint|null}
 */
function toStroops(amount) {
  let str;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) return null;
    // Reject JSON numbers that cannot be represented exactly as a decimal
    // string (e.g. Number.MIN_VALUE -> "5e-324", Number.MAX_VALUE -> "1.79...e+308").
    str = amount.toString();
    if (str.includes('e') || str.includes('E')) return null;
  } else if (typeof amount === 'string') {
    str = amount.trim();
  } else {
    return null;
  }

  // Strict decimal format: optional sign, digits, optional fraction.
  if (!/^[+-]?\d+(\.\d+)?$/.test(str)) return null;

  const negative = str.startsWith('-');
  const unsigned = str.replace(/^[+-]/, '');
  const [intPart, fracPart = ''] = unsigned.split('.');

  if (fracPart.length > 7) return null;

  const paddedFrac = (fracPart + '0000000').slice(0, 7);
  const stroops = BigInt(intPart) * STROOPS_PER_XLM + BigInt(paddedFrac);

  if (negative || stroops <= 0n) return null;
  if (stroops > MAX_STROOPS) return null;

  return stroops;
}

class DonationValidator {
  constructor() {
    this.minAmount = config.donations.minAmount;
    this.maxAmount = config.donations.maxAmount;
    this.maxDailyPerDonor = config.donations.maxDailyPerDonor;
  }

  /**
   * Validate donation amount against configured limits
   * @param {number|string} amount - Donation amount to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validateAmount(amount) {
    // Reject non-finite numbers, scientific notation, and any value that
    // cannot be represented exactly as a positive int64 stroop amount.
    const stroops = toStroops(amount);
    if (stroops === null) {
      return {
        valid: false,
        error: 'Amount must be a valid positive number with at most 7 decimal places',
        code: 'INVALID_AMOUNT',
      };
    }

    // Check for excessive decimal places (Stellar maximum precision is 7)
    if (typeof amount === 'number' && getDecimalPlaces(amount) > 7) {
      return {
        valid: false,
        error: 'Amount cannot have more than 7 decimal places (Stellar precision limit)',
        code: 'INVALID_AMOUNT_PRECISION',
      };
    }

    // Convert to a Number for range comparisons against configured limits.
    const numericAmount = Number(amount);

    // Check minimum amount
    if (numericAmount < this.minAmount) {
      return {
        valid: false,
        error: `Amount must be at least ${this.minAmount} XLM`,
        code: 'AMOUNT_BELOW_MINIMUM',
        minAmount: this.minAmount,
      };
    }

    // Check maximum amount (also bounded by int64 stroop maximum)
    if (numericAmount > this.maxAmount || numericAmount > Number(MAX_AMOUNT_XLM)) {
      return {
        valid: false,
        error: `Amount cannot exceed ${this.maxAmount} XLM`,
        code: 'AMOUNT_EXCEEDS_MAXIMUM',
        maxAmount: this.maxAmount,
      };
    }

    return { valid: true };
  }

  /**
   * Validate daily donation limit for a donor
   * @param {number} amount - Current donation amount
   * @param {number} dailyTotal - Total donated today by this donor
   * @returns {{valid: boolean, error?: string}}
   */
  validateDailyLimit(amount, dailyTotal) {
    // If no daily limit is set, allow all donations
    if (this.maxDailyPerDonor === 0) {
      return { valid: true };
    }

    const newTotal = dailyTotal + amount;

    if (newTotal > this.maxDailyPerDonor) {
      return {
        valid: false,
        error: `Daily donation limit exceeded. Maximum ${this.maxDailyPerDonor} XLM per day`,
        code: 'DAILY_LIMIT_EXCEEDED',
        maxDailyAmount: this.maxDailyPerDonor,
        currentDailyTotal: dailyTotal,
        remainingDaily: Math.max(0, this.maxDailyPerDonor - dailyTotal),
      };
    }

    return { valid: true };
  }

  /**
   * Get current validation limits
   * @returns {{minAmount: number, maxAmount: number, maxDailyPerDonor: number}}
   */
  getLimits() {
    return {
      minAmount: this.minAmount,
      maxAmount: this.maxAmount,
      maxDailyPerDonor: this.maxDailyPerDonor,
    };
  }

  /**
   * Check if amount is within valid range (quick check)
   * @param {number} amount
   * @returns {boolean}
   */
  isValidRange(amount) {
    return amount >= this.minAmount && amount <= this.maxAmount;
  }
}

module.exports = new DonationValidator();
// Expose the class for callers/tests that need their own instance via `new`.
module.exports.Class = DonationValidator;
// Expose the exact decimal parser for reuse by other amount validators.
module.exports.toStroops = toStroops;
