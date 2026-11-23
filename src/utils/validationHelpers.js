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
// eslint-disable-next-line security/detect-unsafe-regex -- anchored; repeated groups are separated by a literal delimiter, so matching is linear
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

function isStrictIntegerString(value) {
  if (typeof value !== 'string') return false;

  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  let startIndex = 0;
  if (trimmed[0] === '-') {
    if (trimmed.length === 1) return false;
    startIndex = 1;
  }

  for (let i = startIndex; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

/**
 * Validate and parse integer with range check
 * @param {*} value - Value to parse
 * @param {Object} options - Validation options
 * @param {number} options.min - Minimum value (inclusive)
 * @param {number} options.max - Maximum value (inclusive)
 * @param {number} options.default - Default value if parsing fails
 * @returns {{valid: boolean, value?: number, error?: string}}
 */
function validateInteger(value, options = {}) {
  const { min, max, default: defaultValue } = options;

  const isMissing = value === undefined || value === null || value === '';
  if (isMissing && defaultValue !== undefined) {
    return { valid: true, value: defaultValue };
  }

  let parsed;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      return { valid: false, error: 'Must be a valid integer' };
    }
    parsed = value;
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!isStrictIntegerString(trimmed)) {
      return { valid: false, error: 'Must be a valid integer' };
    }
    parsed = Number(trimmed);
  } else {
    return { valid: false, error: 'Must be a valid integer' };
  }

  if (min !== undefined && parsed < min) {
    return { valid: false, error: `Must be at least ${min}` };
  }

  if (max !== undefined && parsed > max) {
    return { valid: false, error: `Must be at most ${max}` };
  }

  return { valid: true, value: parsed };
}

/**
 * Validate value is in allowed list
 * @param {*} value - Value to validate
 * @param {Array} allowedValues - Array of allowed values
 * @param {Object} options - Validation options
 * @param {boolean} options.caseInsensitive - Perform case-insensitive comparison for strings
 * @returns {{valid: boolean, value?: *, error?: string}}
 */
function validateEnum(value, allowedValues, options = {}) {
  const { caseInsensitive = false } = options;

  if (!value) {
    return { valid: false, error: 'Value is required' };
  }

  let normalizedValue = value;
  let normalizedAllowed = allowedValues;

  if (caseInsensitive && typeof value === 'string') {
    normalizedValue = value.toLowerCase();
    normalizedAllowed = allowedValues.map(v =>
      typeof v === 'string' ? v.toLowerCase() : v
    );
  }

  if (!normalizedAllowed.includes(normalizedValue)) {
    return {
      valid: false,
      error: `Must be one of: ${allowedValues.join(', ')}`
    };
  }

  return {
    valid: true,
    value: caseInsensitive && typeof value === 'string' ? normalizedValue : value
  };
}

module.exports = {
  MAX_STROOPS,
  STROOPS_PER_XLM,
  amountToStroops,
  isValidDonationAmount,
  validateDonationAmount,
  isStrictIntegerString,
  validateInteger,
  validateEnum,
};
