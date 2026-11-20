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
// eslint-disable-next-line security/detect-unsafe-regex -- anchored; repeated groups are separated by a literal delimiter, so matching is linear
const AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;

/**
 * Matches a non-negative decimal XLM amount with at most 7 fractional digits.
 * Rejects signs, exponents, whitespace, and empty strings.
 * @type {RegExp}
 */
const NON_NEGATIVE_AMOUNT_REGEX = /^\d+(\.\d{1,7})?$/;

/**
 * Convert a decimal XLM string to BigInt stroops using exact string arithmetic.
 *
 * Splits on '.', validates at most 7 fractional digits, pads the fractional part
 * to exactly 7 digits, and builds the stroop value with BigInt. Never uses
 * parseFloat/Number/toFixed, so 1 stroop ("0.0000001"), trailing zeros, and
 * large values round-trip exactly.
 *
 * @param {string} str - decimal XLM string (already trimmed, no sign/exponent)
 * @param {RegExp} regex - pattern the string must match
 * @param {(string|number)} original - original input for error messages
 * @returns {bigint} BigInt stroops
 * @throws {Error} if the string does not match the pattern
 */
function parseDecimalToStroops(str, regex, original) {
  if (!regex.test(str)) {
    throw new Error(`Invalid XLM amount: ${original}`);
  }
  const [whole, frac = ''] = str.split('.');
  const fracPadded = frac.padEnd(7, '0');
  return BigInt(whole) * STROOPS_PER_XLM + BigInt(fracPadded);
}

/**
 * Validate an XLM donation amount and return its BigInt stroop value.
 *
 * This is the single source of truth for donation amount validation. It accepts
 * only strings (or numbers that are exactly representable as a decimal string),
 * enforces a strictly positive value with at most 7 fractional digits, and caps
 * the result at the int64 stroop maximum.
 *
 * Rejects: Number.MAX_VALUE, Number.MIN_VALUE, 1e-8, Infinity, NaN, 0, negatives,
 * exponent notation, and any value above int64 max stroops.
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
  if (str.includes('e') || str.includes('E')) {
    throw new Error(`Invalid XLM amount (exponent notation not allowed): ${xlm}`);
  }

  const stroops = parseDecimalToStroops(str, AMOUNT_REGEX, xlm);

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
 * Throws for non-finite, negative, or exponent-notation input.
 * @param {(string|number)} xlm - XLM amount as string or number
 * @returns {bigint} BigInt stroops
 * @throws {Error} if amount is invalid or negative
 */
function toStroops(xlm) {
  if (typeof xlm === 'number' && !Number.isFinite(xlm)) {
    throw new Error(`Invalid XLM amount: ${xlm}`);
  }
  // Normalise to string for exact decimal handling
  const str = String(xlm).trim();
  if (str.includes('e') || str.includes('E')) {
    throw new Error(`Invalid XLM amount (exponent notation not allowed): ${xlm}`);
  }
  if (str.startsWith('-')) {
    throw new Error(`Amount must be non-negative: ${xlm}`);
  }
  const stroops = parseDecimalToStroops(str, NON_NEGATIVE_AMOUNT_REGEX, xlm);
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
 * Validate and normalise a stroop amount for storage in an INTEGER column.
 *
 * Accepts BigInt, integer number, or integer string. Rejects non-integers,
 * non-finite numbers, exponent notation, and values outside the int64 range
 * (SQLite INTEGER is signed 64-bit). Returns a BigInt so callers can keep exact
 * arithmetic; use `stroopsToDb` to get the value to bind to SQLite.
 *
 * @param {(bigint|number|string)} value - candidate stroop amount
 * @returns {bigint} validated stroop amount
 * @throws {Error} if the value is not an integer stroop amount or is out of range
 */
function validateStroops(value) {
  let stroops;
  if (typeof value === 'bigint') {
    stroops = value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`Invalid stroop amount (must be an integer): ${value}`);
    }
    stroops = BigInt(value);
  } else if (typeof value === 'string') {
    const str = value.trim();
    if (!/^-?\d+$/.test(str)) {
      throw new Error(`Invalid stroop amount (must be an integer): ${value}`);
    }
    stroops = BigInt(str);
  } else {
    throw new Error(`Invalid stroop amount: ${value}`);
  }

  if (stroops > MAX_STROOPS || stroops < -MAX_STROOPS - 1n) {
    throw new Error(`Stroop amount out of int64 range: ${stroops}`);
  }

  return stroops;
}

/**
 * Convert a stroop amount to a value safe to bind to a SQLite INTEGER column.
 *
 * SQLite INTEGER is signed 64-bit, but better-sqlite3 cannot bind BigInt by
 * default, so values within the JS safe-integer range are returned as `number`
 * and larger values as a decimal `string` (which SQLite stores exactly as an
 * INTEGER when the column has INTEGER affinity). Non-integer input is rejected.
 *
 * @param {(bigint|number|string)} value - stroop amount
 * @returns {(number|string)} value to bind to an INTEGER column
 * @throws {Error} if the value is not a valid integer stroop amount
 */
function stroopsToDb(value) {
  const stroops = validateStroops(value);
  const abs = stroops < 0n ? -stroops : stroops;
  if (abs <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(stroops);
  }
  return stroops.toString();
}

/**
 * Read a stroop value from a database row (INTEGER column) as BigInt.
 *
 * Accepts the `number` or decimal `string` forms produced by `stroopsToDb`,
 * as well as BigInt. `null`/`undefined` are rejected so callers must handle
 * NULLable columns explicitly.
 *
 * @param {(bigint|number|string|null|undefined)} value - raw column value
 * @returns {bigint} stroop amount
 * @throws {Error} if the value is null, non-integer, or out of range
 */
function stroopsFromDb(value) {
  if (value === null || value === undefined) {
    throw new Error('Invalid stroop amount: value is null or undefined');
  }
  return validateStroops(value);
}

/**
 * Convert a rational ratio (numerator/denominator) to basis points.
 *
 * Replaces REAL `match_ratio` arithmetic: ratios are stored as integer basis
 * points (1 bps = 0.01%). Division floors, so the resulting bps never exceeds
 * the true ratio (rounding in the platform's favor).
 *
 * @param {(bigint|number|string)} numerator - ratio numerator
 * @param {(bigint|number|string)} denominator - ratio denominator (must be > 0)
 * @returns {bigint} ratio in basis points
 * @throws {Error} if denominator is zero/negative or inputs are not integers
 */
function ratioToBps(numerator, denominator) {
  const num = validateStroops(numerator);
  const den = validateStroops(denominator);
  if (den <= 0n) {
    throw new Error('ratioToBps: denominator must be greater than zero');
  }
  return num * BPS_DIVISOR / den;
}

/**
 * Apply a basis-points ratio to a stroop amount.
 *
 * result = floor(amountStroops * bps / 10000). Used for corporate match caps and
 * other percentage-of-amount computations without floating point.
 *
 * @param {(bigint|number|string)} amountStroops - amount in stroops
 * @param {(bigint|number|string)} bps - ratio in basis points (must be >= 0)
 * @returns {bigint} resulting amount in stroops
 * @throws {Error} if bps is negative or inputs are not integers
 */
function applyRatioBps(amountStroops, bps) {
  const amount = validateStroops(amountStroops);
  const bpsBig = validateStroops(bps);
  if (bpsBig < 0n) {
    throw new Error('applyRatioBps: bps must be non-negative');
  }
  return amount * bpsBig / BPS_DIVISOR;
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
  stroopsToString,
  calcFee,
  validateStroops,
  stroopsToDb,
  stroopsFromDb,
  ratioToBps,
  applyRatioBps,
  addStroops,
  subtractStroops,
};
