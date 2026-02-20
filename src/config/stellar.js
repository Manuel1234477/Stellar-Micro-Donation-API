/**
 * Stellar Configuration
 * Handles both real and mock Stellar service initialization
 * Supports easy network switching via STELLAR_NETWORK environment variable
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const StellarService = require('../services/StellarService');
const MockStellarService = require('../services/MockStellarService');

// Network presets for easy switching
const NETWORK_PRESETS = {
  testnet: {
    network: 'testnet',
    horizonUrl: 'https://horizon-testnet.stellar.org',
  },
  mainnet: {
    network: 'mainnet',
    horizonUrl: 'https://horizon.stellar.org',
  },
  futurenet: {
    network: 'futurenet',
    horizonUrl: 'https://horizon-futurenet.stellar.org',
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
    console.log('[Stellar Config] Using MOCK Stellar service');
    return new MockStellarService();
  }
  
  const networkConfig = getNetworkConfig();
  console.log(`[Stellar Config] Using REAL Stellar service on ${networkConfig.network.toUpperCase()}`);
  console.log(`[Stellar Config] Horizon URL: ${networkConfig.horizonUrl}`);
  
  return new StellarService({
    network: networkConfig.network,
    horizonUrl: networkConfig.horizonUrl,
    serviceSecretKey: process.env.SERVICE_SECRET_KEY,
  });
};

module.exports = {
  getStellarService,
  useMockStellar,
  port: process.env.PORT || 3000,
  network: getNetworkConfig().network,
  horizonUrl: getNetworkConfig().horizonUrl,
};
