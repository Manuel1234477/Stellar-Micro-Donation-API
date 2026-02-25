/**
 * Stellar Configuration
 * Now uses centralized ServiceContainer for dependency injection
 * This file is kept for backward compatibility
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const { validateEnvironment } = require('./envValidation');
const log = require('../utils/log');

validateEnvironment();

const serviceContainer = require('./serviceContainer');

/**
 * Get Stellar service instance from container
 */
const getStellarService = () => {
  const service = serviceContainer.getStellarService();
  const network = service.getNetwork ? service.getNetwork() : 'testnet';
  log.info('STELLAR_CONFIG', 'Using Stellar service from container', { network });
  return service;
};

module.exports = {
  getStellarService,
  useMockStellar: process.env.USE_MOCK_STELLAR === 'true',
  port: process.env.PORT || 3000,
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.HORIZON_URL,
  dbPath: process.env.DB_JSON_PATH || path.join(__dirname, '../../data/donations.json'),
};
