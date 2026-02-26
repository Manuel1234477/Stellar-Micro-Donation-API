/**
 * Stellar Configuration - Blockchain Configuration Layer
 * 
 * RESPONSIBILITY: Stellar network configuration and service initialization
 * OWNER: Blockchain Team
 * DEPENDENCIES: ServiceContainer, environment validation, logger
 * 
 * Configures Stellar network settings (testnet/mainnet), Horizon URLs, and initializes
 * Stellar service instances. Uses ServiceContainer for dependency injection.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');

// External modules
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

// Internal modules
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
  getStellarService
};
