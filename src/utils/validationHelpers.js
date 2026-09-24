'use strict';

/**
 * Shared validation helpers for donation amount inputs.
 *
 * Stellar amounts are int64 stroops (1 XLM = 10^7 stroops) with at most 7
 * decimal places. The maximum representable amount is therefore
 * 922,337,203,685.4775807 XLM. Amounts must be strictly positive.
 *
 * These helpers intentionally validate amounts as strings so that extreme
 * numeric inputs (Number.MAX_VALUE, Number.MIN_VALUE, 1e-8, Infinity, NaN)
 * and JSON numbers that cannot be represented exactly are rejected instead of
 * silently overflowing int64 or rounding to zero stroops.
 */

// int64 max stroops: 9223372036854775807
const MAX_STROOPS = 9223372036854775807n;
const STROOPS_PER_XLM = 10000000n;

// Strict decimal string: optional leading zeros, integer part, optional
// fractional part with at most 7 digits. No signs, exponents, or whitespace.
const AMOUNT_REGEX = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/;

/**
 * Convert a validated decimal amount string to stroops (BigInt).
 * Assumes the input already passed {@link isValidDonationAmount}.
 *
 * @param {string} amount
 * @returns {bigint}
 */
function amountToStroops(amount) {
  const [whole, fraction = ''] = String(amount).split('.');
  const paddedFraction = (fraction + '0000000').slice(0, 7);
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(paddedFraction);
}

/**
 * Validate a donation amount.
 *
 * Accepts only decimal strings (or numbers that are safe, finite integers or
 * exact decimals) that:
 *   - are strictly greater than zero,
 *   - have at most 7 fractional digits,
 *   - do not exceed the int64 stroop maximum.
 *
 * Rejects Number.MAX_VALUE, Number.MIN_VALUE, 1e-8, Infinity, NaN, negative
 * values, zero, and anything above the int64 stroop maximum.
 *
 * @param {string|number} amount
 * @returns {boolean}
 */
function isValidDonationAmount(amount) {
  if (amount === null || amount === undefined) {
    return false;
  }

  if (typeof amount === 'number') {
    // Reject non-finite values and values that cannot be represented exactly.
    if (!Number.isFinite(amount) || !Number.isSafeInteger(amount)) {
      return false;
    }
    amount = String(amount);
  }

  if (typeof amount !== 'string') {
    return false;
  }

  const trimmed = amount.trim();
  if (trimmed.length === 0 || !AMOUNT_REGEX.test(trimmed)) {
    return false;
  }

  const stroops = amountToStroops(trimmed);
  return stroops > 0n && stroops <= MAX_STROOPS;
}

/**
 * Validate a donation amount and return a normalized error message when
 * invalid. Intended for API handlers that must respond with HTTP 400.
 *
 * @param {string|number} amount
 * @returns {{ valid: boolean, error?: string }}
 */
function validateDonationAmount(amount) {
  if (isValidDonationAmount(amount)) {
    return { valid: true };
  }
  return {
    valid: false,
    error:
      'Invalid donation amount: must be a positive decimal with at most 7 ' +
      'fractional digits and no more than 922337203685.4775807 XLM',
  };
}

module.exports = {
  MAX_STROOPS,
  STROOPS_PER_XLM,
  amountToStroops,
  isValidDonationAmount,
  validateDonationAmount,
};
