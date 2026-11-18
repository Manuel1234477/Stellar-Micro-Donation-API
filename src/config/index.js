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
const {
  VALID_STELLAR_NETWORKS,
  MS_PER_MINUTE,
  DEFAULT_API_KEY_EXPIRY_WARN_DAYS,
  DEFAULT_API_KEY_EXPIRED_WINDOW_DAYS,
  DEFAULT_API_KEY_HEADER_WINDOW_DAYS,
  DEFAULT_WEBHOOK_TIMEOUT_MS,
  DEFAULT_TX_SYNC_INTERVAL_MS,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_RETENTION_SCHEDULE,
} = require('../constants');
const { getActiveEnvironment } = require('./stellarEnvironments');
const { validateEnv } = require('./env');

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
 * Validate IP address or CIDR range
 */
const isValidIPOrCIDR = (ip) => {
  // Fixed {3} repetition with no nested unbounded quantifiers — linear, not ReDoS-prone.
  // eslint-disable-next-line security/detect-unsafe-regex
  const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  // eslint-disable-next-line security/detect-unsafe-regex
  const cidrRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/[0-9]{1,2}$/;

  if (ipRegex.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255);
  }

  if (cidrRegex.test(ip)) {
    const [ipPart, mask] = ip.split('/');
    const maskNum = parseInt(mask);
    const parts = ipPart.split('.').map(Number);
    return parts.every(part => part >= 0 && part <= 255) && maskNum >= 0 && maskNum <= 32;
  }

  return false;
};

/**
 * Load and validate configuration
 */
const loadConfig = () => {
  const errors = [];
  const env = process.env.NODE_ENV || 'development';
  const isProduction = env === 'production';
  const isTest = env === 'test';

  // Prevent mainnet operations in test environment
  const currentStellarEnv = (process.env.STELLAR_ENVIRONMENT || process.env.STELLAR_NETWORK || 'testnet').toLowerCase();
  if (isTest && currentStellarEnv === 'mainnet') {
    throw new ConfigurationError('CRITICAL: Mainnet operations are strictly prevented when NODE_ENV=test.');
  }

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

  // Validate STELLAR_NETWORK (Legacy) or STELLAR_ENVIRONMENT (New)
  const stellarEnvRaw = process.env.STELLAR_ENVIRONMENT || process.env.STELLAR_NETWORK;
  if (stellarEnvRaw) {
    const network = stellarEnvRaw.toLowerCase();
    if (!['testnet', 'mainnet'].includes(network) && !VALID_STELLAR_NETWORKS.includes(network)) {
      errors.push(
        `Environment must be one of: testnet, mainnet. Received: "${stellarEnvRaw}".`
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

  // Validate geo-blocking configuration
  if (process.env.GEO_BLOCKED_COUNTRIES) {
    const countries = process.env.GEO_BLOCKED_COUNTRIES.split(',').map(c => c.trim().toUpperCase());
    const invalidCountries = countries.filter(c => !/^[A-Z]{2}$/.test(c));
    if (invalidCountries.length > 0) {
      errors.push(`GEO_BLOCKED_COUNTRIES contains invalid country codes: ${invalidCountries.join(', ')}`);
    }
  }

  if (process.env.GEO_ALLOWED_COUNTRIES) {
    const countries = process.env.GEO_ALLOWED_COUNTRIES.split(',').map(c => c.trim().toUpperCase());
    const invalidCountries = countries.filter(c => !/^[A-Z]{2}$/.test(c));
    if (invalidCountries.length > 0) {
      errors.push(`GEO_ALLOWED_COUNTRIES contains invalid country codes: ${invalidCountries.join(', ')}`);
    }
  }

  if (process.env.GEO_ALLOWED_IPS) {
    const ips = process.env.GEO_ALLOWED_IPS.split(',').map(ip => ip.trim());
    const invalidIPs = ips.filter(ip => !isValidIPOrCIDR(ip));
    if (invalidIPs.length > 0) {
      errors.push(`GEO_ALLOWED_IPS contains invalid IP addresses/CIDR ranges: ${invalidIPs.join(', ')}`);
    }
  }

  // Type/range/enum checks for every variable declared in envSchema.js (#1784).
  // Skip names already reported by the specific checks above.
  for (const schemaError of validateEnv(process.env)) {
    const name = schemaError.split(' ')[0];
    if (!errors.some((e) => e.startsWith(name + ' '))) errors.push(schemaError);
  }

  if (errors.length > 0) {
    const errorMessage = [
      'Configuration validation failed:',
      ...errors.map(err => `  - ${err}`),
      '',
      'Required environment variables:',
      '  - API_KEYS: Comma-separated list of valid API keys',
      '  - ENCRYPTION_KEY: Secret key for encryption (production only)',
      '',
      'Optional environment variables:',
      '  - PORT: Server port (default: 3000)',
      '  - STELLAR_NETWORK: testnet or mainnet (default: testnet)',
      '  - HORIZON_URL: Stellar Horizon API URL',
      '  - MOCK_STELLAR: true or false (default: false)',
      '  - DEBUG_MODE: true or false (default: false)',
      '  - LOG_TO_FILE: true or false (default: false)',
      '  - LOG_VERBOSE: true or false (default: false)',
      '  - RETENTION_TRANSACTION_DAYS: Days to retain transaction memos/identifiers (default: 365)',
    ].join('\n');

    throw new ConfigurationError(errorMessage, errors);
  }

  return buildConfig(env, isProduction, isTest);
};

/**
 * Build configuration object from environment variables
 */
const buildConfig = (env, isProduction, isTest) => {
  const config = {
    env,
    isProduction,
    isTest,
    port: parseInteger(process.env.PORT, 3000, 1, 65535, 'PORT'),
    apiKeys: (process.env.API_KEYS || '')
      .split(',')
      .map(key => key.trim())
      .filter(Boolean),
    encryptionKey: process.env.ENCRYPTION_KEY || '',
    stellar: {
      network: (process.env.STELLAR_ENVIRONMENT || process.env.STELLAR_NETWORK || 'testnet').toLowerCase(),
      horizonUrl: process.env.HORIZON_URL || 'https://horizon-testnet.stellar.org',
      mock: parseBoolean(process.env.MOCK_STELLAR, false),
    },
    debugMode: parseBoolean(process.env.DEBUG_MODE, false),
    logToFile: parseBoolean(process.env.LOG_TO_FILE, false),
    logVerbose: parseBoolean(process.env.LOG_VERBOSE, false),
    retention: {
      days: parseInteger(process.env.RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 1, null, 'RETENTION_DAYS'),
      schedule: process.env.RETENTION_SCHEDULE || DEFAULT_RETENTION_SCHEDULE,
      transactionDays: parseInteger(
        process.env.RETENTION_TRANSACTION_DAYS,
        DEFAULT_RETENTION_DAYS,
        1,
        null,
        'RETENTION_TRANSACTION_DAYS'
      ),
    },
  };

  return config;
};

/**
 * Singleton configuration instance
 */
let configInstance = null;

/**
 * Get configuration instance (lazy-loaded singleton)
 */
const getConfig = () => {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
};

/**
 * Reset configuration (useful for testing)
 */
const resetConfig = () => {
  configInstance = null;
};

module.exports = {
  getConfig,
  resetConfig,
  ConfigurationError,
  parseBoolean,
  parseInteger,
  parseFloat,
  validateUrl,
  isValidIPOrCIDR,
  loadConfig,
  buildConfig,
};
