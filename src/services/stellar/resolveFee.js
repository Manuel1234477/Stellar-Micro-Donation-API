const StellarSdk = require('./sdk.js');
const log = require('../../utils/log');

/**
 * Single source of truth for the per-operation fee (in stroops) used when
 * building any Stellar transaction.
 *
 * The fee is the configured base fee (environment config, falling back to the
 * SDK default), raised to the current surge level reported by fee stats when
 * the network is congested. The returned value is a per-operation fee: the
 * Stellar SDK multiplies it by the operation count when the transaction is
 * built, so callers must not multiply it themselves.
 *
 * @param {object} service - StellarService instance (uses `baseFee` and `fees`)
 * @returns {Promise<string>} integer fee in stroops, as a string
 */
async function resolveFee(service) {
  const base = getConfiguredBaseFee(service);

  if (!service || !service.fees || typeof service.fees.estimateFee !== 'function') {
    return String(base);
  }

  try {
    const estimate = await service.fees.estimateFee(1);
    const surgeFee = parseInt(estimate.feeStroops, 10);
    return String(Number.isFinite(surgeFee) ? Math.max(base, surgeFee) : base);
  } catch (err) {
    log.warn('STELLAR_FEES', 'Surge fee lookup failed, using configured base fee', { error: err.message });
    return String(base);
  }
}

/**
 * Configured base fee in stroops, without any network access.
 * @param {object} service
 * @returns {number}
 */
function getConfiguredBaseFee(service) {
  const configured = parseInt(service?.baseFee ?? StellarSdk.BASE_FEE, 10);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return parseInt(StellarSdk.BASE_FEE, 10);
}

module.exports = { resolveFee, getConfiguredBaseFee };
