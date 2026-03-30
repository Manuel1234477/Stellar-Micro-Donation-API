/**
 * Replay Detection Configuration Module
 * Loads and validates replay detection settings from environment variables
 * 
 * This module:
 * - Loads REPLAY_THRESHOLD, REPLAY_WINDOW_SECONDS, and REPLAY_CLEANUP_INTERVAL_SECONDS
 * - Validates minimum values (threshold >= 2, window >= 10)
 * - Returns default values for invalid or missing configuration
 * - Logs warnings when invalid values are provided
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
 */

const log = require('../utils/log');

/**
 * Default configuration values
 */
const DEFAULTS = {
  threshold: 3,
  windowSeconds: 60,
  cleanupIntervalSeconds: 60
};

/**
 * Minimum allowed values for validation
 */
const MINIMUMS = {
  threshold: 2,
  windowSeconds: 10
};

/**
 * Parse and validate an integer environment variable
 * @param {string} value - Raw environment variable value
 * @param {number} defaultValue - Default value to use if invalid or missing
 * @param {number|null} minValue - Minimum allowed value (null for no minimum)
 * @param {string} varName - Variable name for logging
 * @returns {number} Validated integer value
 */
function parseAndValidateInt(value, defaultValue, minValue, varName) {
  // Use default if not provided
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = parseInt(value, 10);

  // Check if parsing failed
  if (isNaN(parsed)) {
    log.warn('REPLAY_DETECTION_CONFIG', `Invalid ${varName}, using default ${defaultValue}`, {
      providedValue: value,
      reason: 'not a valid integer'
    });
    return defaultValue;
  }

  // Check minimum constraint
  if (minValue !== null && parsed < minValue) {
    log.warn('REPLAY_DETECTION_CONFIG', `Invalid ${varName}, using default ${defaultValue}`, {
      providedValue: parsed,
      minimumRequired: minValue,
      reason: `value must be >= ${minValue}`
    });
    return defaultValue;
  }

  return parsed;
}

/**
 * Load and validate replay detection configuration from environment variables
 * @returns {Object} Configuration object with validated values
 */
function loadConfig() {
  const config = {
    threshold: parseAndValidateInt(
      process.env.REPLAY_THRESHOLD,
      DEFAULTS.threshold,
      MINIMUMS.threshold,
      'REPLAY_THRESHOLD'
    ),
    windowSeconds: parseAndValidateInt(
      process.env.REPLAY_WINDOW_SECONDS,
      DEFAULTS.windowSeconds,
      MINIMUMS.windowSeconds,
      'REPLAY_WINDOW_SECONDS'
    ),
    cleanupIntervalSeconds: parseAndValidateInt(
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS,
      DEFAULTS.cleanupIntervalSeconds,
      null, // No minimum for cleanup interval
      'REPLAY_CLEANUP_INTERVAL_SECONDS'
    )
  };

  return config;
}

// Load configuration once at module initialization
const config = loadConfig();

module.exports = config;

// Export for testing
module.exports.loadConfig = loadConfig;
module.exports.DEFAULTS = DEFAULTS;
module.exports.MINIMUMS = MINIMUMS;
