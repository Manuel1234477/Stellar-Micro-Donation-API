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

const { toStroops, fromStroops } = require('./money');

/** Stellar base fee in stroops (protocol constant) */
const STELLAR_BASE_FEE_STROOPS = 100;

/** One XLM = 10,000,000 stroops */
const STROOPS_PER_XLM = 10_000_000;

/** Base fee in XLM */
const STELLAR_BASE_FEE_XLM = STELLAR_BASE_FEE_STROOPS / STROOPS_PER_XLM; // 0.0000100

/**
 * Round a number to exactly 7 decimal places (Stellar stroops precision).
 *
 * @param {number|string} value
 * @returns {string} Fixed-point string with 7 decimal places
 */
function toStroopPrecision(value) {
  return fromStroops(toStroops(value));
}

function decimalFraction(value) {
  const stringValue = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(stringValue)) {
    throw new Error(`Invalid decimal value: ${stringValue}`);
  }
  const [whole, fraction = ''] = stringValue.split('.');
  const denominator = 10n ** BigInt(fraction.length);
  return {
    numerator: BigInt(`${whole}${fraction}`),
    denominator,
  };
}

/**
 * Convert XLM amount to USD using the provided rate.
 *
 * @param {number|string} xlmAmount
 * @param {number} xlmUsdRate - Current XLM/USD exchange rate
 * @returns {string} USD amount rounded to 2 decimal places
 */
function xlmToUsd(xlmAmount, xlmUsdRate) {
  const { numerator, denominator } = decimalFraction(xlmUsdRate);
  const amountStroops = toStroops(xlmAmount);
  const usdCentsNumerator = amountStroops * numerator * 100n;
  const usdCentsDenominator = BigInt(STROOPS_PER_XLM) * denominator;
  const usdCents = (usdCentsNumerator + usdCentsDenominator / 2n) / usdCentsDenominator;
  return `${usdCents / 100n}.${String(usdCents % 100n).padStart(2, '0')}`;
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
  let amountStroops;
  try {
    amountStroops = toStroops(amount);
  } catch {
    throw new Error('amount must be a positive number');
  }
  if (amountStroops <= 0n) {
    throw new Error('amount must be a positive number');
  }

  if (typeof surgeFeeMultiplier !== 'number' || surgeFeeMultiplier < 1) {
    throw new Error('surgeFeeMultiplier must be a number >= 1');
  }

  if (typeof platformFeePercent !== 'number' || platformFeePercent < 0 || platformFeePercent > 100) {
    throw new Error('platformFeePercent must be a number between 0 and 100');
  }

  const rateNum = typeof xlmUsdRate === 'number' ? xlmUsdRate : Number(xlmUsdRate) || 0;
  const hasRate = rateNum > 0 && Number.isFinite(rateNum);
  const surgeMultiplier = decimalFraction(surgeFeeMultiplier);
  const platformPercent = decimalFraction(platformFeePercent);

  // ── Calculate components ───────────────────────────────────────────────────
  const networkFeeStroops = BigInt(STELLAR_BASE_FEE_STROOPS) * surgeMultiplier.numerator / surgeMultiplier.denominator;
  const platformFeeStroops = amountStroops * platformPercent.numerator / (platformPercent.denominator * 100n);
  const totalStroops = amountStroops + networkFeeStroops + platformFeeStroops;
  const donationXlm = fromStroops(amountStroops);
  const networkFeeXlm = fromStroops(networkFeeStroops);
  const platformFeeXlm = fromStroops(platformFeeStroops);
  const totalXlm = fromStroops(totalStroops);

  // ── Build response ─────────────────────────────────────────────────────────
  return {
    donationAmount: {
      xlm: donationXlm,
      usd: hasRate ? xlmToUsd(donationXlm, String(xlmUsdRate)) : null,
    },
    networkFee: {
      xlm: networkFeeXlm,
      usd: hasRate ? xlmToUsd(networkFeeXlm, String(xlmUsdRate)) : null,
      baseFeeStroops: STELLAR_BASE_FEE_STROOPS,
      surgeFeeMultiplier,
    },
    platformFee: {
      xlm: platformFeeXlm,
      usd: hasRate ? xlmToUsd(platformFeeXlm, String(xlmUsdRate)) : null,
      percent: platformFeePercent,
    },
    total: {
      xlm: totalXlm,
      usd: hasRate ? xlmToUsd(totalXlm, String(xlmUsdRate)) : null,
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
