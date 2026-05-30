/**
 * @fileoverview Stellar environment presets providing auto-configuration defaults 
 * for testnet, mainnet, and futurenet deployments dynamically.
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
  },
  futurenet: {
    network: 'futurenet',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
    networkPassphrase: 'Test SDF Future Network ; October 2022',
    baseReserve: '0.5',
    feeMultiplier: 100,
  },
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

  if (!Object.keys(environments).includes(envName)) {
    throw new Error(`Invalid STELLAR_ENVIRONMENT provided: '${envName}'. Must be one of: ${Object.keys(environments).join(', ')}.`);
  }

  if (envName === 'mainnet' && process.env.NODE_ENV === 'test') {
    throw new Error('SECURITY BLOCK: Mainnet operations are explicitly prevented when NODE_ENV is set to "test".');
  }

  // Resolve the active network — STELLAR_NETWORK overrides STELLAR_ENVIRONMENT
  const resolvedNetwork = (process.env.STELLAR_NETWORK || envName).toLowerCase();

  // Derive the expected Horizon URL from the resolved network
  const expectedHorizonUrl = (environments[resolvedNetwork] || environments[envName]).horizonUrl;

  // Use HORIZON_URL override if provided, otherwise default to the expected URL for the network
  const horizonUrl = process.env.HORIZON_URL || expectedHorizonUrl;

  // Warn if an explicit HORIZON_URL override doesn't match the expected URL for the network
  if (process.env.HORIZON_URL && process.env.HORIZON_URL !== expectedHorizonUrl) {
    console.warn(
      `[STELLAR_CONFIG] WARNING: HORIZON_URL "${process.env.HORIZON_URL}" does not match ` +
      `the expected URL for network "${resolvedNetwork}" ("${expectedHorizonUrl}"). ` +
      `Ensure this is intentional.`
    );
  }

  const preset = environments[envName];

  return {
    environment: envName,
    network: resolvedNetwork,
    horizonUrl,
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || preset.networkPassphrase,
    baseReserve: process.env.STELLAR_BASE_RESERVE || preset.baseReserve,
    feeMultiplier: parseInt(process.env.STELLAR_FEE_MULTIPLIER || preset.feeMultiplier.toString(), 10)
  };
}

module.exports = {
  environments,
  getActiveEnvironment
};
