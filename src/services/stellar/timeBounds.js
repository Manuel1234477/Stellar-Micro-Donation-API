const { BusinessLogicError, ERROR_CODES } = require('../../utils/errors');
const log = require('../../utils/log');

const DEFAULT_TX_TIMEOUT_SECONDS = 30;
const MAX_TX_TIMEOUT_SECONDS = 3600;

/**
 * Transaction validity window, in seconds, applied to every transaction built by
 * the Stellar services. Configured with STELLAR_TX_TIMEOUT_SECONDS (default 30,
 * integer between 1 and 3600). Invalid values fall back to the default.
 *
 * @param {object} [env=process.env]
 * @returns {number}
 */
function getTxTimeoutSeconds(env = process.env) {
  const raw = env.STELLAR_TX_TIMEOUT_SECONDS;
  if (raw === undefined || raw === '') {
    return DEFAULT_TX_TIMEOUT_SECONDS;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TX_TIMEOUT_SECONDS) {
    log.warn('STELLAR_TIME_BOUNDS', 'Invalid STELLAR_TX_TIMEOUT_SECONDS, using default', {
      value: raw,
      default: DEFAULT_TX_TIMEOUT_SECONDS,
    });
    return DEFAULT_TX_TIMEOUT_SECONDS;
  }
  return parsed;
}

/**
 * Throws when a signed envelope's maxTime has passed. Such an envelope can never be
 * accepted by the network, so it must be rebuilt and re-signed rather than resubmitted.
 * Envelopes with no upper bound (maxTime 0) are never considered expired.
 *
 * @param {object} transaction - Stellar SDK Transaction
 * @param {number} [nowSeconds=Date.now()/1000]
 * @throws {BusinessLogicError} when the envelope is past its maxTime
 */
function assertWithinTimeBounds(transaction, nowSeconds = Math.floor(Date.now() / 1000)) {
  const maxTime = parseInt(transaction?.timeBounds?.maxTime ?? '0', 10);
  if (maxTime > 0 && nowSeconds > maxTime) {
    throw new BusinessLogicError(
      ERROR_CODES.TRANSACTION_FAILED,
      `Transaction expired at ${maxTime} (time bounds passed); rebuild and re-sign before submitting`
    );
  }
}

module.exports = {
  DEFAULT_TX_TIMEOUT_SECONDS,
  MAX_TX_TIMEOUT_SECONDS,
  getTxTimeoutSeconds,
  assertWithinTimeBounds,
};
