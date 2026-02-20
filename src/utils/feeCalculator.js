/**
 * Fee Calculator Utility
 * Calculates optional analytics fees for donations
 * Note: Fees are calculated but NOT deducted on-chain
 */

const DEFAULT_FEE_PERCENTAGE = 0.02; // 2% default fee
const MIN_FEE = 0.01; // Minimum fee amount
const MAX_FEE_PERCENTAGE = 0.05; // Maximum 5% fee cap

/**
 * Calculate analytics fee for a donation
 * @param {number} amount - The donation amount
 * @param {number} feePercentage - Optional custom fee percentage (default: 2%)
 * @returns {Object} Fee calculation details
 */
function calculateAnalyticsFee(amount, feePercentage = DEFAULT_FEE_PERCENTAGE) {
  if (typeof amount !== 'number' || amount <= 0) {
    throw new Error('Amount must be a positive number');
  }

  if (feePercentage < 0 || feePercentage > MAX_FEE_PERCENTAGE) {
    throw new Error(`Fee percentage must be between 0 and ${MAX_FEE_PERCENTAGE * 100}%`);
  }

  const calculatedFee = amount * feePercentage;
  const fee = Math.max(calculatedFee, MIN_FEE);

  return {
    fee: parseFloat(fee.toFixed(2)),
    feePercentage: feePercentage,
    originalAmount: amount,
    totalWithFee: parseFloat((amount + fee).toFixed(2))
  };
}

module.exports = {
  calculateAnalyticsFee,
  DEFAULT_FEE_PERCENTAGE,
  MIN_FEE,
  MAX_FEE_PERCENTAGE
};
