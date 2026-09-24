// @ts-check

/**
 * Money Utility - Integer Stroop Arithmetic
 *
 * All monetary values are represented as BigInt stroops (1 XLM = 10,000,000 stroops).
 * Fee rates are expressed in basis points (1 bps = 0.01%). Integer division always
 * floors (truncates toward zero), rounding in the platform's favor for fees.
 *
 * Rounding rule: floor (BigInt division truncates). This is documented and consistent —
 * a fee is never rounded up against the donor.
 */

/**
 * @typedef {object} FeeOptions
 * @prop {bigint} [minFeeStroops] - minimum fee clamp (default 0n)
 * @prop {bigint} [maxFeeStroops] - maximum fee clamp (default unbounded)
 * @prop {(bigint|number)} [surgeMultiplierBps] - surge multiplier in bps (e.g. 15000 = 1.5×)
 */

/** @type {bigint} */
const STROOPS_PER_XLM = 10_000_000n;

/** @type {bigint} */
const BPS_DIVISOR = 10_000n;

/**
 * Maximum valid amount in stroops: int64 max (922,337,203,685.4775807 XLM).
 * @type {bigint}
 */
const MAX_STROOPS = 9223372036854775807n;

/**
 * Matches a strictly positive decimal XLM amount with at most 7 fractional digits.
 * Rejects signs, exponents, whitespace, and empty strings.
 * @type {RegExp}
 */
const AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;

/**
 * Validate an XLM donation amount and return its BigInt stroop value.
 *
 * This is the single source of truth for donation amount validation. It accepts
 * only strings (or numbers that are exactly representable as a decimal string),
 * enforces a strictly positive value with at most 7 fractional digits, and caps
 * the result at the int64 stroop maximum.
 *
 * Rejects: Number.MAX_VALUE, Number.MIN_VALUE, 1e-8, Infinity, NaN, 0, negatives,
 * and any value above int64 max stroops.
 *
 * @param {(string|number)} xlm - XLM amount as string or number
 * @returns {bigint} BigInt stroops
 * @throws {Error} if the amount is invalid, non-positive, or out of range
 */
function validateAmount(xlm) {
  if (typeof xlm === 'number') {
    if (!Number.isFinite(xlm)) {
      throw new Error(`Invalid XLM amount: ${xlm}`);
    }
    // Reject JSON numbers that cannot be represented exactly as a decimal string
    // (e.g. Number.MIN_VALUE -> "5e-324", Number.MAX_VALUE -> "1.7976931348623157e+308").
    const asString = String(xlm);
    if (asString.includes('e') || asString.includes('E')) {
      throw new Error(`Invalid XLM amount: ${xlm}`);
    }
    xlm = asString;
  }

  if (typeof xlm !== 'string') {
    throw new Error(`Invalid XLM amount: ${xlm}`);
  }

  const str = xlm.trim();
  if (!AMOUNT_REGEX.test(str)) {
    throw new Error(`Invalid XLM amount: ${xlm}`);
  }

  const [whole, frac = ''] = str.split('.');
  const fracPadded = frac.padEnd(7, '0');
  const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);

  if (stroops <= 0n) {
    throw new Error(`Amount must be greater than zero: ${xlm}`);
  }
  if (stroops > MAX_STROOPS) {
    throw new Error(`Amount exceeds maximum: ${xlm}`);
  }

  return stroops;
}

/**
 * Convert an XLM string or number to BigInt stroops.
 * Accepts: "1.234567", 1.234567, "5", 5
 * Throws for non-finite or negative input.
 * @param {(string|number)} xlm - XLM amount as string or number
 * @returns {bigint} BigInt stroops
 * @throws {Error} if amount is invalid or negative
 */
function toStroops(xlm) {
  // Normalise to string for exact decimal handling
  const str = String(xlm).trim();
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error(`Invalid XLM amount: ${xlm}`);
  }
  if (str.startsWith('-')) {
    throw new Error(`Amount must be non-negative: ${xlm}`);
  }
  const [whole, frac = ''] = str.split('.');
  // Pad / truncate fractional part to exactly 7 digits
  const fracPadded = frac.padEnd(7, '0').slice(0, 7);
  const stroops = BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
  if (stroops < 0n) {
    throw new Error(`Amount must be non-negative: ${xlm}`);
  }
  return stroops;
}

/**
 * Convert BigInt stroops to a 7-decimal XLM display string.
 * @param {bigint} stroops - BigInt stroops amount
 * @returns {string} XLM amount as string (e.g. "1.2345670")
 * @throws {Error} if stroops is not a BigInt
 */
function fromStroops(stroops) {
  if (typeof stroops !== 'bigint') {
    throw new Error('fromStroops expects a BigInt');
  }
  const abs = stroops < 0n ? -stroops : stroops;
  const sign = stroops < 0n ? '-' : '';
  const whole = abs / STROOPS_PER_XLM;
  const frac = abs % STROOPS_PER_XLM;
  return `${sign}${whole}.${String(frac).padStart(7, '0')}`;
}

/**
 * Calculate a fee in stroops using basis points (integer math, floors in platform's favor).
 * feeStroops = floor(amountStroops * bps / 10000)
 *
 * @param {bigint} amountStroops - amount in stroops
 * @param {(bigint|number)} bps - fee rate in basis points (e.g. 200 = 2%)
 * @param {FeeOptions} [opts] - optional fee calculation settings
 * @returns {bigint} calculated fee in stroops
 * @throws {Error} if amountStroops is not a BigInt or bps is negative
 */
function calcFee(amountStroops, bps, opts = {}) {
  if (typeof amountStroops !== 'bigint') {
    throw new Error('calcFee: amountStroops must be BigInt');
  }
  const bpsBig = BigInt(bps);
  if (bpsBig < 0n) {
    throw new Error('calcFee: bps must be non-negative');
  }

  let effectiveBps = bpsBig;

  // Apply surge multiplier if provided (surge is also in bps; e.g. 15000n = 1.5×)
  if (opts.surgeMultiplierBps !== undefined) {
    const surgeBps = BigInt(opts.surgeMultiplierBps);
    // effectiveBps = floor(bps * surgeMultiplierBps / 10000)
    effectiveBps = bpsBig * surgeBps / BPS_DIVISOR;
  }

  // floor division (BigInt division truncates toward zero, which equals floor for positives)
  let fee = amountStroops * effectiveBps / BPS_DIVISOR;

  const minFee = opts.minFeeStroops !== undefined ? BigInt(opts.minFeeStroops) : 0n;
  if (fee < minFee) fee = minFee;

  if (opts.maxFeeStroops !== undefined) {
    const maxFee = BigInt(opts.maxFeeStroops);
    if (fee > maxFee) fee = maxFee;
  }

  return fee;
}

/**
 * Add two BigInt stroop values.
 * @param {(bigint|number|string)} a - first stroop amount
 * @param {(bigint|number|string)} b - second stroop amount
 * @returns {bigint} sum of stroops
 */
function addStroops(a, b) {
  return BigInt(a) + BigInt(b);
}

/**
 * Subtract two BigInt stroop values.
 * @param {(bigint|number|string)} a - stroop amount to subtract from
 * @param {(bigint|number|string)} b - stroop amount to subtract
 * @returns {bigint} difference in stroops
 */
function subtractStroops(a, b) {
  return BigInt(a) - BigInt(b);
}

module.exports = {
  STROOPS_PER_XLM,
  BPS_DIVISOR,
  MAX_STROOPS,
  validateAmount,
  toStroops,
  fromStroops,
  calcFee,
  addStroops,
  subtractStroops,
};
