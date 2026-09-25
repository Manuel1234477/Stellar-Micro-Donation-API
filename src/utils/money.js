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
 * Serialise a stroop amount as an exact decimal string.
 *
 * Unlike `fromStroops`, this does not force a fixed 7-decimal display and does
 * not require a BigInt: it accepts BigInt, number, or numeric string and returns
 * the exact decimal representation as a string. This is the canonical way to
 * serialise leaderboard totals (`totalDonated`, `totalReceived`) so values above
 * `Number.MAX_SAFE_INTEGER` stroops are not silently coerced to lossy JS numbers.
 *
 * @param {(bigint|number|string)} stroops - stroop amount
 * @returns {string} exact decimal string of the stroop amount
 * @throws {Error} if the value is not a valid integer amount
 */
function stroopsToString(stroops) {
  if (typeof stroops === 'bigint') {
    return stroops.toString();
  }
  if (typeof stroops === 'number') {
    if (!Number.isFinite(stroops) || !Number.isInteger(stroops)) {
      throw new Error(`Invalid stroop amount: ${stroops}`);
    }
    return BigInt(stroops).toString();
  }
  const str = String(stroops).trim();
  if (!/^-?\d+$/.test(str)) {
    throw new Error(`Invalid stroop amount: ${stroops}`);
  }
  return BigInt(str).toString();
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
  toStroops,
  fromStroops,
  stroopsToString,
  calcFee,
  addStroops,
  subtractStroops,
};
