'use strict';

/**
 * Single source of truth for Stellar mock mode and network mode (#1984).
 *
 * Only `MOCK_STELLAR` controls mock mode. `USE_MOCK_STELLAR` used to be a
 * second switch read by some modules and ignored by others; it is now
 * deprecated and ignored (startup warns when it is set).
 *
 * Mode values reported on `GET /health` (`stellarMode`) and as a metric label:
 *   - `mock`     MOCK_STELLAR=true; no Horizon calls, no on-chain transactions
 *   - `testnet`  real network, testnet (also used for futurenet and unknown values)
 *   - `public`   real network, mainnet
 *
 * Reads go through `readEnv` so changes to process.env (tests, runtime) are seen.
 */

const { readEnv } = require('./env');

/** @returns {boolean} true when mock Stellar mode is enabled */
function isMockStellarEnabled() {
  return readEnv('MOCK_STELLAR') === true;
}

/** @returns {boolean} true when NODE_ENV is production */
function isProductionEnv() {
  return (process.env.NODE_ENV || '').toLowerCase() === 'production';
}

/**
 * Explicit, deliberate override that lets mock mode start in production.
 * @returns {boolean}
 */
function isMockStellarAllowedInProduction() {
  return readEnv('ALLOW_MOCK_STELLAR_IN_PRODUCTION') === true;
}

/** @returns {'mock'|'testnet'|'public'} */
function getStellarMode() {
  if (isMockStellarEnabled()) return 'mock';
  const network = (process.env.STELLAR_NETWORK || process.env.STELLAR_ENVIRONMENT || 'testnet').toLowerCase();
  return network === 'mainnet' ? 'public' : 'testnet';
}

module.exports = {
  isMockStellarEnabled,
  isMockStellarAllowedInProduction,
  isProductionEnv,
  getStellarMode,
  STELLAR_MODES: ['mock', 'testnet', 'public'],
};
