/**
 * @fileoverview Stellar environment presets providing auto-configuration defaults 
 * for testnet and mainnet deployments dynamically.
 */

const environments = {
  testnet: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    baseReserve: '0.5',
    feeMultiplier: 100,
  },
  mainnet: {
    network: 'mainnet',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    baseReserve: '0.5',
    feeMultiplier: 100,
  }
};

/**
 * Retrieves the currently configured Stellar environmental variables securely overriding 
 * preset rules where locally prioritized. Blocks mainnet on `NODE_ENV=test`.
 * 
 * @returns {object} The dynamically formatted environment parameters
 */
function getActiveEnvironment() {
  const rawEnv = process.env.STELLAR_ENVIRONMENT || 'testnet';
  const envName = rawEnv.toLowerCase();
  
  if (!['testnet', 'mainnet'].includes(envName)) {
    throw new Error(`Invalid STELLAR_ENVIRONMENT provided: '${envName}'. Must be strictly 'testnet' or 'mainnet'.`);
  }

  if (envName === 'mainnet' && process.env.NODE_ENV === 'test') {
    throw new Error('SECURITY BLOCK: Mainnet operations are explicitly prevented when NODE_ENV is set to "test".');
  }

  const preset = environments[envName];

  return {
    environment: envName,
    network: process.env.STELLAR_NETWORK || preset.network,
    horizonUrl: process.env.HORIZON_URL || preset.horizonUrl,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || preset.networkPassphrase,
    baseReserve: process.env.STELLAR_BASE_RESERVE || preset.baseReserve,
    feeMultiplier: parseInt(process.env.STELLAR_FEE_MULTIPLIER || preset.feeMultiplier.toString(), 10)
  };
}

module.exports = {
  environments,
  getActiveEnvironment
};
