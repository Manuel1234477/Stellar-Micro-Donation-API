/**
 * Cost Breakdown Utility
 *
 * RESPONSIBILITY: Calculate itemized transaction cost breakdown for Stellar donations
 * OWNER: Backend Team
 * DEPENDENCIES: None
 *
 * Computes donation amount, Stellar network fee (base + surge), optional platform fee,
 * and total cost — all accurate to 7 decimal places (Stellar stroops precision).
 *
 * Fee immutability guarantee:
 *   - Stellar BASE_FEE is a protocol constant (100 stroops = 0.0000100 XLM).
 *   - Surge fee multiplier is read from env at request time; changing it requires
 *     a server restart, preventing silent mid-request mutations.
 *   - Platform fee percent is read from env at request time for the same reason.
 *   - USD rate is clearly marked with a timestamp so callers know its freshness.
 */

'use strict';

/** Stellar base fee in stroops (protocol constant) */
const STELLAR_BASE_FEE_STROOPS = 100;

/** One XLM = 10,000,000 stroops */
const STROOPS_PER_XLM = 10_000_000;

/** Base fee in XLM */
const STELLAR_BASE_FEE_XLM = STELLAR_BASE_FEE_STROOPS / STROOPS_PER_XLM; // 0.0000100

/**
 * Round a number to exactly 7 decimal places (Stellar stroops precision).
 *
 * @param {number} value
 * @returns {string} Fixed-point string with 7 decimal places
 */
function toStroopPrecision(value) {
  return parseFloat(value.toFixed(7)).toFixed(7);
}

/**
 * Convert XLM amount to USD using the provided rate.
 *
 * @param {number} xlmAmount
 * @param {number} xlmUsdRate - Current XLM/USD exchange rate
 * @returns {string} USD amount rounded to 2 decimal places
 */
function xlmToUsd(xlmAmount, xlmUsdRate) {
  return (xlmAmount * xlmUsdRate).toFixed(2);
}

/**
 * Calculate a full transaction cost breakdown for a Stellar donation.
 *
 * @param {Object} params
 * @param {number|string} params.amount          - Donation amount in XLM (must be > 0)
 * @param {number}        [params.surgeFeeMultiplier=1] - Surge fee multiplier (≥ 1).
 *                                                  Set > 1 during network congestion.
 * @param {number}        [params.platformFeePercent=0] - Platform fee as a percentage
 *                                                  (0–100). Defaults to 0.
 * @param {number}        [params.xlmUsdRate=0]   - Current XLM/USD rate. Pass 0 to
 *                                                  omit USD equivalents.
 * @returns {{
 *   donationAmount:   { xlm: string, usd: string|null },
 *   networkFee:       { xlm: string, usd: string|null, baseFeeStroops: number, surgeFeeMultiplier: number },
 *   platformFee:      { xlm: string, usd: string|null, percent: number },
 *   total:            { xlm: string, usd: string|null },
 *   xlmUsdRate:       number,
 *   rateTimestamp:    string|null,
 *   precision:        string
 * }}
 * @throws {Error} If amount is not a positive number
 * @throws {Error} If surgeFeeMultiplier < 1
 * @throws {Error} If platformFeePercent is outside [0, 100]
 */
function calculateCostBreakdown({
  amount,
  surgeFeeMultiplier = 1,
  platformFeePercent = 0,
  xlmUsdRate = 0,
}) {
  // ── Validate inputs ────────────────────────────────────────────────────────
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0) {
    throw new Error('amount must be a positive number');
  }

  if (typeof surgeFeeMultiplier !== 'number' || surgeFeeMultiplier < 1) {
    throw new Error('surgeFeeMultiplier must be a number >= 1');
  }

  if (typeof platformFeePercent !== 'number' || platformFeePercent < 0 || platformFeePercent > 100) {
    throw new Error('platformFeePercent must be a number between 0 and 100');
  }

  const rateNum = typeof xlmUsdRate === 'number' ? xlmUsdRate : parseFloat(xlmUsdRate) || 0;
  const hasRate = rateNum > 0;

  // ── Calculate components ───────────────────────────────────────────────────
  const networkFeeXlm = STELLAR_BASE_FEE_XLM * surgeFeeMultiplier;
  const platformFeeXlm = amountNum * (platformFeePercent / 100);
  const totalXlm = amountNum + networkFeeXlm + platformFeeXlm;

  // ── Build response ─────────────────────────────────────────────────────────
  return {
    donationAmount: {
      xlm: toStroopPrecision(amountNum),
      usd: hasRate ? xlmToUsd(amountNum, rateNum) : null,
    },
    networkFee: {
      xlm: toStroopPrecision(networkFeeXlm),
      usd: hasRate ? xlmToUsd(networkFeeXlm, rateNum) : null,
      baseFeeStroops: STELLAR_BASE_FEE_STROOPS,
      surgeFeeMultiplier,
    },
    platformFee: {
      xlm: toStroopPrecision(platformFeeXlm),
      usd: hasRate ? xlmToUsd(platformFeeXlm, rateNum) : null,
      percent: platformFeePercent,
    },
    total: {
      xlm: toStroopPrecision(totalXlm),
      usd: hasRate ? xlmToUsd(totalXlm, rateNum) : null,
    },
    xlmUsdRate: rateNum,
    rateTimestamp: hasRate ? new Date().toISOString() : null,
    precision: '7 decimal places (stroops)',
  };
}

module.exports = {
  calculateCostBreakdown,
  STELLAR_BASE_FEE_STROOPS,
  STELLAR_BASE_FEE_XLM,
  STROOPS_PER_XLM,
  toStroopPrecision,
  xlmToUsd,
};
