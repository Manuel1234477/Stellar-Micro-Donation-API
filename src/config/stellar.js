/**
 * Stellar Configuration
 * Handles both real and mock Stellar service initialization
 * Supports easy network switching via STELLAR_NETWORK environment variable
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const { validateEnvironment } = require('./envValidation');
const { STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');
const log = require('../utils/log');

validateEnvironment();

const StellarService = require('../services/StellarService');
const MockStellarService = require('../services/MockStellarService');

// Network presets for easy switching
const NETWORK_PRESETS = {
  [STELLAR_NETWORKS.TESTNET]: {
    network: STELLAR_NETWORKS.TESTNET,
    horizonUrl: HORIZON_URLS.TESTNET,
  },
  [STELLAR_NETWORKS.MAINNET]: {
    network: STELLAR_NETWORKS.MAINNET,
    horizonUrl: HORIZON_URLS.MAINNET,
  },
  [STELLAR_NETWORKS.FUTURENET]: {
    network: STELLAR_NETWORKS.FUTURENET,
    horizonUrl: HORIZON_URLS.FUTURENET,
  },
};

const useMockStellar = process.env.MOCK_STELLAR === 'true';

/**
 * Get network configuration based on STELLAR_NETWORK env variable
 * Defaults to testnet if not specified or invalid
 */
const getNetworkConfig = () => {
  const networkName = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();

  // If custom HORIZON_URL is provided, use it with the specified network
  if (process.env.HORIZON_URL) {
    log.debug('STELLAR_CONFIG', 'Using custom Horizon URL', {
      network: networkName,
      horizonUrl: process.env.HORIZON_URL
    });
    return {
      network: networkName,
      horizonUrl: process.env.HORIZON_URL,
    };
  }

  // Use preset or default to testnet
  return NETWORK_PRESETS[networkName] || NETWORK_PRESETS.testnet;
};

/**
 * Get Stellar service instance
 * Returns mock service if MOCK_STELLAR=true, otherwise real service
 */
const getStellarService = () => {
  if (useMockStellar) {
    log.info('STELLAR_CONFIG', 'Using mock Stellar service');
    return new MockStellarService();
  }
  const networkConfig = getNetworkConfig();
  log.info('STELLAR_CONFIG', 'Using real Stellar service', { 
    network: networkConfig.network.toUpperCase(),
    horizonUrl: networkConfig.horizonUrl
  });

  return new StellarService({
    network: networkConfig.network,
    horizonUrl: networkConfig.horizonUrl,
    // Support both STELLAR_SECRET and SERVICE_SECRET_KEY for flexibility
    serviceSecretKey: process.env.STELLAR_SECRET || process.env.SERVICE_SECRET_KEY,
  });
};

module.exports = {
  getStellarService,
  useMockStellar,
  port: process.env.PORT || 3000,
  network: getNetworkConfig().network,
  horizonUrl: getNetworkConfig().horizonUrl,
  dbPath: process.env.DB_JSON_PATH || path.join(__dirname, '../../data/donations.json'),
};
