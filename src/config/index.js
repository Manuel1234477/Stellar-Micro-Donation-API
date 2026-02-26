/**
 * Configuration Module - Application Configuration Layer
 * 
 * RESPONSIBILITY: Centralized environment variable management and configuration validation
 * OWNER: Platform Team
 * DEPENDENCIES: dotenv, constants
 * 
 * Single source of truth for all environment variables and application configuration.
 * Loads, validates, and provides type-safe access to configuration with sensible defaults.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const path = require('path');
const { VALID_STELLAR_NETWORKS, HORIZON_URLS } = require('../constants');

/**
 * Configuration error class for clear error messages
 */
class ConfigurationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.details = details;
  }
}

/**
 * Parse boolean environment variable
 */
const parseBoolean = (value, defaultValue = false) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return value === 'true';
};

/**
 * Parse integer environment variable with validation
 */
const parseInteger = (value, defaultValue, min = null, max = null, varName = '') => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  const parsed = parseInt(value, 10);
  
  if (isNaN(parsed)) {
    throw new ConfigurationError(
      `${varName} must be a valid integer. Received: "${value}"`
    );
  }
  
  if (min !== null && parsed < min) {
    throw new ConfigurationError(
      `${varName} must be >= ${min}. Received: ${parsed}`
    );
  }
  
  if (max !== null && parsed > max) {
    throw new ConfigurationError(
      `${varName} must be <= ${max}. Received: ${parsed}`
    );
  }
  
  return parsed;
};

/**
 * Parse float environment variable with validation
 */
const parseFloat = (value, defaultValue, min = null, max = null, varName = '') => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  const parsed = Number.parseFloat(value);
  
  if (isNaN(parsed)) {
    throw new ConfigurationError(
      `${varName} must be a valid number. Received: "${value}"`
    );
  }
  
  if (min !== null && parsed < min) {
    throw new ConfigurationError(
      `${varName} must be >= ${min}. Received: ${parsed}`
    );
  }
  
  if (max !== null && parsed > max) {
    throw new ConfigurationError(
      `${varName} must be <= ${max}. Received: ${parsed}`
    );
  }
  
  return parsed;
};

/**
 * Validate URL format
 */
const validateUrl = (value, varName) => {
  try {
    new URL(value);
    return value;
  } catch (error) {
    throw new ConfigurationError(
      `${varName} must be a valid URL. Received: "${value}"`
    );
  }
};

/**
 * Load and validate configuration
 */
const loadConfig = () => {
  const errors = [];
  const env = process.env.NODE_ENV || 'development';
  const isProduction = env === 'production';
  const isTest = env === 'test';

  // Skip validation in test environment
  if (isTest) {
    return buildConfig(env, isProduction, isTest);
  }

  // Validate required variables
  if (!process.env.API_KEYS || !process.env.API_KEYS.trim()) {
    errors.push('API_KEYS is required but was not set.');
  } else {
    const keys = process.env.API_KEYS.split(',')
      .map(key => key.trim())
      .filter(Boolean);
    
    if (keys.length === 0) {
      errors.push('API_KEYS must contain at least one non-empty key.');
    }
  }

  if (isProduction && (!process.env.ENCRYPTION_KEY || !process.env.ENCRYPTION_KEY.trim())) {
    errors.push('ENCRYPTION_KEY is required in production but was not set.');
  }

  // Validate PORT
  if (process.env.PORT) {
    try {
      parseInteger(process.env.PORT, 3000, 1, 65535, 'PORT');
    } catch (error) {
      errors.push(error.message);
    }
  }

  // Validate STELLAR_NETWORK
  if (process.env.STELLAR_NETWORK) {
    const network = process.env.STELLAR_NETWORK.toLowerCase();
    if (!VALID_STELLAR_NETWORKS.includes(network)) {
      errors.push(
        `STELLAR_NETWORK must be one of: ${VALID_STELLAR_NETWORKS.join(', ')}. Received: "${process.env.STELLAR_NETWORK}".`
      );
    }
  }

  // Validate HORIZON_URL if provided
  if (process.env.HORIZON_URL) {
    try {
      validateUrl(process.env.HORIZON_URL, 'HORIZON_URL');
    } catch (error) {
      errors.push(error.message);
    }
  }

  // Validate boolean flags
  const booleanVars = ['MOCK_STELLAR', 'DEBUG_MODE', 'LOG_TO_FILE', 'LOG_VERBOSE'];
  for (const varName of booleanVars) {
    if (process.env[varName] && process.env[varName] !== 'true' && process.env[varName] !== 'false') {
      errors.push(`${varName} must be either "true" or "false". Received: "${process.env[varName]}".`);
    }
  }

  if (errors.length > 0) {
    const errorMessage = [
      'Configuration validation failed:',
      ...errors.map(err => `  - ${err}`),
      '',
      'Required environment variables:',
      '  - API_KEYS',
      isProduction ? '  - ENCRYPTION_KEY (in production)' : '',
      '',
      'Please check your .env file or environment variables.'
    ].filter(Boolean).join('\n');

    throw new ConfigurationError(errorMessage, errors);
  }

  return buildConfig(env, isProduction, isTest);
};

/**
 * Build configuration object with all settings
 */
const buildConfig = (env, isProduction, isTest) => {
  // Server configuration
  const server = {
    port: parseInteger(process.env.PORT, 3000, 1, 65535, 'PORT'),
    env,
    isProduction,
    isDevelopment: env === 'development',
    isTest,
    apiPrefix: process.env.API_PREFIX || '/api/v1',
  };

  // Stellar configuration
  const stellarNetwork = (process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
  const stellar = {
    network: stellarNetwork,
    horizonUrl: process.env.HORIZON_URL || HORIZON_URLS[stellarNetwork] || HORIZON_URLS.testnet,
    mockEnabled: parseBoolean(process.env.MOCK_STELLAR, false),
    serviceSecretKey: process.env.STELLAR_SECRET || process.env.SERVICE_SECRET_KEY || null,
  };

  // Database configuration
  const database = {
    type: process.env.DB_TYPE || 'sqlite',
    path: process.env.DB_PATH || './donations.db',
    jsonPath: process.env.DB_JSON_PATH || path.join(__dirname, '../../data/donations.json'),
  };

  // API Keys configuration
  const apiKeys = {
    legacy: process.env.API_KEYS 
      ? process.env.API_KEYS.split(',').map(key => key.trim()).filter(Boolean)
      : [],
  };

  // Rate limiting configuration
  const rateLimit = {
    maxRequests: parseInteger(process.env.RATE_LIMIT_MAX_REQUESTS, 100, 1, null, 'RATE_LIMIT_MAX_REQUESTS'),
    windowMs: parseInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000, 1000, null, 'RATE_LIMIT_WINDOW_MS'),
    cleanupIntervalMs: parseInteger(process.env.RATE_LIMIT_CLEANUP_INTERVAL_MS, 300000, 1, null, 'RATE_LIMIT_CLEANUP_INTERVAL_MS'),
  };

  // Donation limits configuration
  const donations = {
    minAmount: parseFloat(process.env.MIN_DONATION_AMOUNT, 0.01, 0, null, 'MIN_DONATION_AMOUNT'),
    maxAmount: parseFloat(process.env.MAX_DONATION_AMOUNT, 10000, 0, null, 'MAX_DONATION_AMOUNT'),
    maxDailyPerDonor: parseFloat(process.env.MAX_DAILY_DONATION_PER_DONOR, 0, 0, null, 'MAX_DAILY_DONATION_PER_DONOR'),
  };

  // Logging configuration
  const logging = {
    toFile: parseBoolean(process.env.LOG_TO_FILE, false),
    directory: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
    verbose: parseBoolean(process.env.LOG_VERBOSE, false),
    debugMode: parseBoolean(process.env.DEBUG_MODE, false),
  };

  // Encryption configuration
  const encryption = {
    key: process.env.ENCRYPTION_KEY || null,
    requireInProduction: isProduction,
  };

  // Application metadata
  const app = {
    name: 'stellar-micro-donation-api',
    version: process.env.npm_package_version || '1.0.0',
  };

  return {
    server,
    stellar,
    database,
    apiKeys,
    rateLimit,
    donations,
    logging,
    encryption,
    app,
  };
};

// Load configuration once at module initialization
let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error('\n' + error.message + '\n');
    process.exit(1);
  }
  throw error;
}

// Export configuration object
module.exports = config;

// Export ConfigurationError for testing
module.exports.ConfigurationError = ConfigurationError;
