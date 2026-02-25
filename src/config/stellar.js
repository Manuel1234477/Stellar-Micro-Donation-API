/**
 * Stellar Configuration
 * Handles both real and mock Stellar service initialization
 * Supports easy network switching via STELLAR_NETWORK environment variable
 */

const config = require('./index');
const log = require('../utils/log');

const StellarService = require('../services/StellarService');
const MockStellarService = require('../services/MockStellarService');

/**
 * Get Stellar service instance
 * Returns mock service if MOCK_STELLAR=true, otherwise real service
 */
const getStellarService = () => {
  if (config.stellar.mockEnabled) {
    log.info('STELLAR_CONFIG', 'Using mock Stellar service');
    return new MockStellarService();
  }
  
  log.info('STELLAR_CONFIG', 'Using real Stellar service', { 
    network: config.stellar.network.toUpperCase(),
    horizonUrl: config.stellar.horizonUrl
  });

  return new StellarService({
    network: config.stellar.network,
    horizonUrl: config.stellar.horizonUrl,
    serviceSecretKey: config.stellar.serviceSecretKey,
  });
};

module.exports = {
  getStellarService,
  useMockStellar: config.stellar.mockEnabled,
  port: config.server.port,
  network: config.stellar.network,
  horizonUrl: config.stellar.horizonUrl,
  dbPath: config.database.jsonPath,
};
