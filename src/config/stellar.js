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
const { securityConfig } = require("./securityConfig");
const { STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');
const config = require('./index');
const log = require('../utils/log');

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

// Use security configuration for mock mode
const useMockStellar = securityConfig.MOCK_STELLAR === 'true';

/**
 * Get network configuration based on security configuration
 * Uses safe defaults with proper validation
 */
const getNetworkConfig = () => {
  const networkName = securityConfig.STELLAR_NETWORK;

  // If custom HORIZON_URL is provided from security config, use it
  if (securityConfig.HORIZON_URL) {
    log.info(
      "STELLAR_CONFIG",
      "Using custom Horizon URL from security config",
      {
        network: networkName,
        horizonUrl: securityConfig.HORIZON_URL,
      },
    );
    return {
      network: networkName,
      horizonUrl: securityConfig.HORIZON_URL,
    };
  }

  // Use preset or default to testnet
  const config = NETWORK_PRESETS[networkName] || NETWORK_PRESETS.testnet;

  log.info("STELLAR_CONFIG", "Using network preset", {
    network: config.network,
    horizonUrl: config.horizonUrl,
    source: networkName === config.network ? "security_config" : "default",
  });

  return config;
};;

/**
 * Get Stellar service instance with security configuration
 * Returns mock service if configured, otherwise real service
 */
const getStellarService = () => {
  if (useMockStellar) {
    log.info("STELLAR_CONFIG", "Using mock Stellar service", {
      mockStellar: securityConfig.MOCK_STELLAR,
      network: securityConfig.STELLAR_NETWORK,
    });
    return new MockStellarService();
  }

  const networkConfig = getNetworkConfig();
  const serviceSecretKey =
    securityConfig.SERVICE_SECRET_KEY || securityConfig.STELLAR_SECRET;
  
  log.info("STELLAR_CONFIG", "Using real Stellar service", {
    network: networkConfig.network.toUpperCase(),
    horizonUrl: networkConfig.horizonUrl,
    hasServiceKey: !!serviceSecretKey,
  });

  return new StellarService({
    network: networkConfig.network,
    horizonUrl: networkConfig.horizonUrl,
    serviceSecretKey: serviceSecretKey,
  });
};

/**
 * Get security configuration summary for Stellar
 */
const getStellarSecuritySummary = () => {
  return {
    network: securityConfig.STELLAR_NETWORK,
    mockStellar: useMockStellar,
    hasCustomHorizon: !!securityConfig.HORIZON_URL,
    hasServiceKey: !!(securityConfig.SERVICE_SECRET_KEY || securityConfig.STELLAR_SECRET),
    horizonUrl: securityConfig.HORIZON_URL || getNetworkConfig().horizonUrl
  };
};

module.exports = {
  getStellarService,
  useMockStellar: process.env.USE_MOCK_STELLAR === 'true',
  port: process.env.PORT || 3000,
  network: process.env.STELLAR_NETWORK || 'testnet',
  horizonUrl: process.env.HORIZON_URL,
  dbPath: process.env.DB_JSON_PATH || path.join(__dirname, '../../data/donations.json'),
  useMockStellar,
  getNetworkConfig,
  getStellarSecuritySummary,
  port: process.env.PORT || 3000,
  network: getNetworkConfig().network,
  horizonUrl: getNetworkConfig().horizonUrl,
  dbPath:
    process.env.DB_JSON_PATH ||
    path.join(__dirname, "../../data/donations.json"),
};
