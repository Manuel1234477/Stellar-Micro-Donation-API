// @ts-check

/**
 * Fee Calculator Utility
 *
 * All arithmetic is done in integer stroops via the money utility.
 * Rounding: floor (BigInt division truncates toward zero) — platform's favor.
 *
 * Fee rates are in basis points (1 bps = 0.01%).
 *   DEFAULT_FEE_BPS  = 200  → 2 %
 *   MAX_FEE_BPS      = 500  → 5 %
 *   MIN_FEE_STROOPS  = 100_000  → 0.01 XLM
 */

const { toStroops, fromStroops, calcFee } = require('./money');

const DEFAULT_FEE_BPS = 200n;   // 2 %
const MAX_FEE_BPS = 500n;        // 5 %
const MIN_FEE_STROOPS = 100_000n; // 0.01 XLM

/**
 * Calculate analytics fee for a donation.
 * Accepts an XLM string or number; returns amounts as XLM display strings plus
 * the raw BigInt stroop values for internal use.
 *
 * @param {string|number} amount - Donation amount in XLM
 * @param {bigint|number} [feeBps=DEFAULT_FEE_BPS] - Fee rate in basis points
 * @returns {{
 *   fee: string,
 *   feeStroops: bigint,
 *   feePercentage: number,
 *   originalAmount: string,
 *   totalWithFee: string
 * }}
 */
function calculateAnalyticsFee(amount, feeBps = DEFAULT_FEE_BPS) {
  const bps = BigInt(feeBps);
  if (bps < 0n || bps > MAX_FEE_BPS) {
    throw new Error(`Fee bps must be between 0 and ${MAX_FEE_BPS} (${Number(MAX_FEE_BPS) / 100}%)`);
  }

  const amountStroops = toStroops(amount);
  if (amountStroops <= 0n) {
    throw new Error('Amount must be a positive value');
  }

  const feeStroops = calcFee(amountStroops, bps, { minFeeStroops: MIN_FEE_STROOPS });
  const totalStroops = amountStroops + feeStroops;

  return {
    fee: fromStroops(feeStroops),
    feeStroops,
    feePercentage: Number(bps) / 100,
    originalAmount: fromStroops(amountStroops),
    totalWithFee: fromStroops(totalStroops),
  };
}

module.exports = {
  calculateAnalyticsFee,
  DEFAULT_FEE_BPS,
  MIN_FEE_STROOPS,
  MAX_FEE_BPS,
  // Legacy float-equivalent constants for callers that only need the numeric value
  DEFAULT_FEE_PERCENTAGE: Number(DEFAULT_FEE_BPS) / 10000,
  MIN_FEE: Number(MIN_FEE_STROOPS) / 10_000_000,
  MAX_FEE_PERCENTAGE: Number(MAX_FEE_BPS) / 10000,
};
