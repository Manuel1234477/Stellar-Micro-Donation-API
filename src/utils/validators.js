/**
 * Validation utilities for API requests
 * Cleaned up to remove unused functions and dependencies
 */

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
const sanitizeString = (str) => {
  if (typeof str !== 'string') return '';
  return str.trim();
};

module.exports = {
  isValidStellarPublicKey,
  isValidStellarSecretKey,
  isValidAmount,
  isValidDate,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString
};
