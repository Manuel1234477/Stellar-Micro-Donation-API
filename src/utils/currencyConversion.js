'use strict';

/**
 * Currency Conversion Utility — single rounding policy (#1159)
 *
 * ROUNDING POLICY
 * ───────────────
 * Direction  : Round-half-even (banker's rounding) implemented via the
 *              ROUND_HALF_EVEN helper below.  This minimises cumulative
 *              drift when many conversions are summed (e.g. reports,
 *              reconciliation).
 * Precision  : 7 decimal places (1 stroop = 0.0000001 XLM).  The same
 *              cap is enforced by validateXLMAmount at the input boundary.
 * Timing     : Conversion happens once at write time, using the rate
 *              that was current at that moment.  Both the source amount
 *              and the rate (plus its timestamp) are stored alongside the
 *              converted value so every figure is reproducible from
 *              stored inputs:
 *
 *                convertedXLM = round(sourceAmount / rateXLMperUnit, 7)
 *
 * Reproducibility guarantee
 * ─────────────────────────
 * Given storedSourceAmount, storedCurrency, storedRateXLMperUnit, and
 * storedRateTimestamp you can always re-derive the stored XLM amount:
 *
 *   roundHalfEven(storedSourceAmount / storedRateXLMperUnit, 7)
 *
 * IMPORTANT: Do not change the rounding direction without a migration that
 * recalculates all existing converted values and a version-bump in
 * ROUNDING_POLICY_VERSION.
 */

const STROOPS_PER_XLM       = 10_000_000;
const XLM_DECIMAL_PLACES    = 7;

/** Increment this whenever the policy changes so callers can detect drift. */
const ROUNDING_POLICY_VERSION = 1;

/**
 * Round-half-even (banker's rounding) to `dp` decimal places.
 *
 * Unlike Math.round (which always rounds 0.5 up), this rounds 0.5 to the
 * nearest even digit, eliminating systematic bias over large data sets.
 *
 * @param {number} value
 * @param {number} dp     - Decimal places (default 7 for XLM)
 * @returns {number}
 */
function roundHalfEven(value, dp = XLM_DECIMAL_PLACES) {
  const factor = Math.pow(10, dp);
  const shifted = value * factor;
  const floor   = Math.floor(shifted);
  const diff    = shifted - floor;

  let rounded;
  if (diff < 0.5) {
    rounded = floor;
  } else if (diff > 0.5) {
    rounded = floor + 1;
  } else {
    // Exactly halfway — round to even
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }

  return rounded / factor;
}

/**
 * Convert a fiat amount to XLM and return full provenance metadata.
 *
 * The caller is expected to persist ALL returned fields alongside the
 * transaction so the conversion is always reproducible from stored data.
 *
 * @param {number} sourceAmount   - Amount in the source currency
 * @param {string} sourceCurrency - ISO currency code, e.g. "USD"
 * @param {number} rateXLMperUnit - How many XLM 1 unit of sourceCurrency buys.
 *                                  e.g. if 1 USD = 10 XLM, pass 10.
 *                                  (= 1 / price_of_1_XLM_in_sourceCurrency)
 * @param {string} [rateTimestamp] - ISO timestamp when the rate was fetched
 *                                   (defaults to now)
 * @returns {{
 *   xlm: number,
 *   stroops: number,
 *   sourceAmount: number,
 *   sourceCurrency: string,
 *   rateXLMperUnit: number,
 *   rateTimestamp: string,
 *   roundingPolicy: string,
 *   policyVersion: number,
 * }}
 */
function convertToXLMWithMeta(sourceAmount, sourceCurrency, rateXLMperUnit, rateTimestamp) {
  if (typeof sourceAmount !== 'number' || !Number.isFinite(sourceAmount) || sourceAmount < 0) {
    throw new TypeError('sourceAmount must be a non-negative finite number');
  }
  if (typeof rateXLMperUnit !== 'number' || !Number.isFinite(rateXLMperUnit) || rateXLMperUnit <= 0) {
    throw new TypeError('rateXLMperUnit must be a positive finite number');
  }

  const xlm     = roundHalfEven(sourceAmount * rateXLMperUnit, XLM_DECIMAL_PLACES);
  const stroops = Math.round(xlm * STROOPS_PER_XLM);

  return {
    xlm,
    stroops,
    sourceAmount,
    sourceCurrency: (sourceCurrency || 'XLM').toUpperCase(),
    rateXLMperUnit,
    rateTimestamp: rateTimestamp || new Date().toISOString(),
    roundingPolicy: 'ROUND_HALF_EVEN',
    policyVersion: ROUNDING_POLICY_VERSION,
  };
}

module.exports = {
  roundHalfEven,
  convertToXLMWithMeta,
  STROOPS_PER_XLM,
  XLM_DECIMAL_PLACES,
  ROUNDING_POLICY_VERSION,
};
