/**
 * Donation Validation Utility
 * Validates donation amounts against configurable limits
 */

const config = require('../config');

class DonationValidator {
  constructor() {
    this.minAmount = config.donations.minAmount;
    this.maxAmount = config.donations.maxAmount;
    this.maxDailyPerDonor = config.donations.maxDailyPerDonor;
  }

  /**
   * Validate donation amount against configured limits
   * @param {number} amount - Donation amount to validate
   * @returns {{valid: boolean, error?: string}}
   */
  validateAmount(amount) {
    // Check if amount is a valid finite number
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      return {
        valid: false,
        error: 'Amount must be a valid finite number',
        code: 'INVALID_AMOUNT_TYPE',
      };
    }

    // Check for excessive decimal places (Stellar maximum precision is 7)
    const decimals = amount.toString().split('.')[1];
    if (decimals && decimals.length > 7) {
      return {
        valid: false,
        error: 'Amount cannot have more than 7 decimal places (Stellar precision limit)',
        code: 'INVALID_AMOUNT_PRECISION',
      };
    }

    // Check if amount is positive
    if (amount <= 0) {
      return {
        valid: false,
        error: 'Amount must be greater than zero',
        code: 'AMOUNT_TOO_LOW',
      };
    }

    // Check minimum amount
    if (amount < this.minAmount) {
      return {
        valid: false,
        error: `Amount must be at least ${this.minAmount} XLM`,
        code: 'AMOUNT_BELOW_MINIMUM',
        minAmount: this.minAmount,
      };
    }

    // Check maximum amount
    if (amount > this.maxAmount) {
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
