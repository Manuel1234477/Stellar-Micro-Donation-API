/**
 * Stellar Environments Configuration
 * 
 * RESPONSIBILITY: Provide clean and secure pre-configured settings for Stellar networks
 * OWNER: Blockchain Team
 * 
 * Defines the default settings for different Stellar environments (testnet, mainnet).
 * Used by the main configuration module to set up appropriate connections and fees.
 */

const { HORIZON_URLS } = require('../constants');

/**
 * Default fee in stroops (1 stroop = 0.0000001 XLM)
 */
const DEFAULT_BASE_FEE = 100;

/**
 * Pre-configured Stellar environments
 */
const STELLAR_ENVIRONMENTS = {
  testnet: {
    name: 'testnet',
    horizonUrl: HORIZON_URLS.TESTNET,
    networkPassphrase: 'Test SDF Network ; September 2015',
    baseFee: DEFAULT_BASE_FEE
  },
  mainnet: {
    name: 'mainnet',
    horizonUrl: HORIZON_URLS.MAINNET,
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
    baseFee: DEFAULT_BASE_FEE
  }
};

/**
 * Get environment configuration by name
 * 
 * @param {string} envName - The name of the environment ('testnet' or 'mainnet')
 * @returns {Object} Environment configuration object
 */
const getStellarEnvironment = (envName) => {
  const env = (envName || 'testnet').toLowerCase();
  
  if (!STELLAR_ENVIRONMENTS[env]) {
    // Fallback to testnet if an invalid environment is provided
    return STELLAR_ENVIRONMENTS.testnet;
  }
  
  return STELLAR_ENVIRONMENTS[env];
};

module.exports = {
  STELLAR_ENVIRONMENTS,
  getStellarEnvironment,
  DEFAULT_BASE_FEE
};
