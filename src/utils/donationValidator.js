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
    const isProduction = process.env.NODE_ENV === 'production';

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
      const errorResponse = {
        valid: false,
        error: isProduction 
          ? 'Amount is below the minimum allowed'
          : `Amount must be at least ${this.minAmount} XLM`,
        code: 'AMOUNT_BELOW_MINIMUM',
      };
      
      // Only expose limits in development
      if (!isProduction) {
        errorResponse.minAmount = this.minAmount;
      }
      
      return errorResponse;
    }

    // Check maximum amount
    if (amount > this.maxAmount) {
      const errorResponse = {
        valid: false,
        error: isProduction
          ? 'Amount exceeds the maximum allowed'
          : `Amount cannot exceed ${this.maxAmount} XLM`,
        code: 'AMOUNT_EXCEEDS_MAXIMUM',
      };
      
      // Only expose limits in development
      if (!isProduction) {
        errorResponse.maxAmount = this.maxAmount;
      }
      
      return errorResponse;
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
    const isProduction = process.env.NODE_ENV === 'production';

    // If no daily limit is set, allow all donations
    if (this.maxDailyPerDonor === 0) {
      return { valid: true };
    }

    const newTotal = dailyTotal + amount;

    if (newTotal > this.maxDailyPerDonor) {
      const errorResponse = {
        valid: false,
        error: isProduction
          ? 'Daily donation limit exceeded'
          : `Daily donation limit exceeded. Maximum ${this.maxDailyPerDonor} XLM per day`,
        code: 'DAILY_LIMIT_EXCEEDED',
      };

      // Only expose limit details in development
      if (!isProduction) {
        errorResponse.maxDailyAmount = this.maxDailyPerDonor;
        errorResponse.currentDailyTotal = dailyTotal;
        errorResponse.remainingDaily = Math.max(0, this.maxDailyPerDonor - dailyTotal);
      }

      return errorResponse;
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
