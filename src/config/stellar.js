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

require('./env'); // loads the repository .env (#2112)
const log = require('../utils/log');
const { isMockStellarEnabled } = require('./stellarMode');

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

const { getActiveEnvironment } = require('./stellarEnvironments');
const activeEnv = getActiveEnvironment();

module.exports = {
  getStellarService,
  useMockStellar: isMockStellarEnabled(),
  port: process.env.PORT || 3000,
  ...activeEnv,
};
