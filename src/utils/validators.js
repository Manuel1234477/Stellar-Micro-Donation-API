/**
 * Validation utilities for API requests
 */

const Transaction = require('../routes/models/transaction');
const User = require('../routes/models/user');

/**
 * Validate Stellar public key format
 * Stellar public keys start with 'G' and are 56 characters long (base32 encoded)
 */
const isValidStellarPublicKey = (key) => {
  if (typeof key !== 'string') return false;
  
  // Stellar public keys: start with 'G', 56 chars, alphanumeric
  const stellarPublicKeyRegex = /^G[A-Z2-7]{55}$/;
  return stellarPublicKeyRegex.test(key);
};

/**
 * Validate Stellar secret key format
 * Stellar secret keys start with 'S' and are 56 characters long (base32 encoded)
 */
const isValidStellarSecretKey = (key) => {
  if (typeof key !== 'string') return false;
  
  // Stellar secret keys: start with 'S', 56 chars, alphanumeric
  const stellarSecretKeyRegex = /^S[A-Z2-7]{55}$/;
  return stellarSecretKeyRegex.test(key);
};

/**
 * Validate amount is a positive number
 */
const isValidAmount = (amount) => {
  const num = parseFloat(amount);
  return !isNaN(num) && num > 0 && isFinite(num);
};

/**
 * Validate wallet ID exists in database
 */
const walletExists = (walletId) => {
  if (!walletId) return false;
  const user = User.getById(walletId);
  return !!user;
};

/**
 * Validate wallet address exists in database
 */
const walletAddressExists = (walletAddress) => {
  if (!walletAddress) return false;
  const user = User.getByWallet(walletAddress);
  return !!user;
};

/**
 * Validate transaction ID exists
 */
const transactionExists = (transactionId) => {
  if (!transactionId) return false;
  const transaction = Transaction.getById(transactionId);
  return !!transaction;
};

/**
 * Validate date string format
 */
const isValidDate = (dateString) => {
  const date = new Date(dateString);
  return !isNaN(date.getTime());
};

/**
 * Validate date range
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
 */
const isValidTransactionHash = (hash) => {
  if (typeof hash !== 'string') return false;
  const txHashRegex = /^[a-f0-9]{64}$/i;
  return txHashRegex.test(hash);
};

/**
 * Sanitize string input
 */

module.exports = {
  isValidStellarPublicKey,
  isValidStellarSecretKey,
  isValidAmount,
  walletExists,
  walletAddressExists,
  transactionExists,
  isValidDate,
  isValidDateRange,
  isValidTransactionHash,
};
