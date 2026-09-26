// @ts-check

/**
 * Validation utilities for API requests
 * Cleaned up to remove unused functions and dependencies
 */

const StellarSdk = require('stellar-sdk');

/**
 * Maximum donation amount in XLM.
 * Stellar amounts are int64 stroops (1 XLM = 10^7 stroops), so the largest
 * representable amount is 9223372036854775807 / 10^7 = 922337203685.4775807 XLM.
 */
const MAX_AMOUNT_XLM = 922337203685.4775807;

/**
 * Validate amount is a positive number within Stellar int64 stroop bounds.
 *
 * Accepts numeric strings (preferred) and JSON numbers that can be represented
 * exactly. Rejects NaN, Infinity, Number.MAX_VALUE, Number.MIN_VALUE, values
 * with more than 7 fractional digits, zero/negative amounts, and amounts that
 * would overflow int64 stroops.
 *
 * @param {unknown} amount - Value to validate as positive amount
 * @returns {boolean} True if valid positive amount
 */
const isValidAmount = (amount) => {
  if (typeof amount === 'number') {
    // Reject non-finite values and JSON numbers that cannot be represented
    // exactly (e.g. Number.MAX_VALUE, Number.MIN_VALUE, 1e-8).
    if (!Number.isFinite(amount)) return false;
    if (!Number.isSafeInteger(amount * 1e7)) return false;
    amount = String(amount);
  }

  if (typeof amount !== 'string') return false;

  const trimmed = amount.trim();
  // Require a plain decimal string: optional integer part, optional fraction
  // with at most 7 digits. Rejects exponent notation, signs, and whitespace.
  if (!/^\d+(\.\d{1,7})?$/.test(trimmed)) return false;

  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (num > MAX_AMOUNT_XLM) return false;

  return true;
};

/**
 * Validate date string format
 * @param {unknown} dateString - Value to validate as date string
 * @returns {boolean} True if valid date format
 */
const isValidDate = (dateString) => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/**
 * Validate date range
 * @typedef {object} DateRangeResult
 * @prop {boolean} valid - Whether the date range is valid
 * @prop {string} [error] - Error message if invalid
 *
 * @param {unknown} startDate - Start date to validate
 * @param {unknown} endDate - End date to validate
 * @returns {DateRangeResult} Validation result with optional error message
 */
const isValidDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Invalid date format' };
  }

  if (start > end) {
    return { valid: false, error: 'startDate must be before endDate' };
  }

  return { valid: true };
};

/**
 * Validate transaction hash format
 * Stellar transaction hashes are 64 character hex strings
 * @param {unknown} hash - Value to validate as transaction hash
 * @returns {boolean} True if valid transaction hash format
 */
const isValidTransactionHash = (hash) => {
  if (typeof hash !== 'string') return false;
  const txHashRegex = /^[a-f0-9]{64}$/i;
  return txHashRegex.test(hash);
};

/**
 * Sanitize string input
 * @param {unknown} str - Value to sanitize as string
 * @returns {string} Trimmed string or empty string if not a string
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim();
};

/**
 * Check if a wallet/user exists by ID (async)
 * @param {unknown} id - User ID to check
 * @returns {Promise<boolean>} True if user exists
 */
const walletExists = async (id) => {
  if (!id && id !== 0) return false;
  const User = require('../models/user');
  const user = await User.getById(id);
  return user !== null && user !== undefined;
};

/**
 * Check if a wallet address exists (async)
 * @param {unknown} address - Wallet address to check
 * @returns {Promise<boolean>} True if wallet address exists
 */
const walletAddressExists = async (address) => {
  if (!address) return false;
  const User = require('../models/user');
  const user = await User.getByWallet(address);
  return user !== null && user !== undefined;
};

/**
 * Check if a transaction exists by ID
 * @param {unknown} id - Transaction ID to check
 * @returns {boolean} True if transaction exists
 */
const transactionExists = (id) => {
  if (!id && id !== 0) return false;
  if (id === 0) return false;
  const Transaction = require('../models/transaction');
  const tx = Transaction.getById(id);
  return tx !== null && tx !== undefined;
};

module.exports = {
  isValidStellarSecretKey,
  isValidAmount,
  isValidDate,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString,
  walletExists,
  walletAddressExists,
  transactionExists,
};
