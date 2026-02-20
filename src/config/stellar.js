/**
 * Stellar Configuration
 * Handles both real and mock Stellar service initialization
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const StellarService = require('../services/StellarService');
const MockStellarService = require('../services/MockStellarService');

const useMockStellar = process.env.MOCK_STELLAR === 'true';

/**
 * Get Stellar service instance
 * Returns mock service if MOCK_STELLAR=true, otherwise real service
 */
const getStellarService = () => {
  if (useMockStellar) {
    console.log('[Stellar Config] Using MOCK Stellar service');
    return new MockStellarService();
  }
  
  console.log('[Stellar Config] Using REAL Stellar service');
  return new StellarService({
    network: process.env.STELLAR_NETWORK || 'testnet',
    horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
    serviceSecretKey: process.env.SERVICE_SECRET_KEY,
  });
};

module.exports = {
  getStellarService,
  useMockStellar,
  port: process.env.PORT || 3000,
  network: process.env.STELLAR_NETWORK || 'testnet',
  dbPath: process.env.DB_PATH || './data/donations.json'
};
