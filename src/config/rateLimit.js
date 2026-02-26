/**
 * Rate Limit Configuration
 * Uses centralized configuration module
 */

const config = require('./index');

/**
 * Validate rate limit configuration values
 * @param {Object} config - Configuration object to validate
 * @param {number} config.limit - Maximum requests per window
 * @param {number} config.windowMs - Time window in milliseconds
 * @param {number} config.cleanupIntervalMs - Cleanup interval in milliseconds
 * @returns {Object} Validation result with valid flag and errors array
 */
function validateRateLimitConfig(rateLimitConfig) {
  const errors = [];

  // Validate limit
  if (!Number.isInteger(rateLimitConfig.limit) || rateLimitConfig.limit <= 0) {
    errors.push('limit must be a positive integer');
  }

  // Validate windowMs (minimum 1 second)
  if (!Number.isInteger(rateLimitConfig.windowMs) || rateLimitConfig.windowMs < 1000) {
    errors.push('windowMs must be a positive integer >= 1000 (minimum 1 second)');
  }

  // Validate cleanupIntervalMs
  if (!Number.isInteger(rateLimitConfig.cleanupIntervalMs) || rateLimitConfig.cleanupIntervalMs <= 0) {
    errors.push('cleanupIntervalMs must be a positive integer');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Export configuration from centralized config
const rateLimitConfig = {
  limit: config.rateLimit.maxRequests,
  windowMs: config.rateLimit.windowMs,
  cleanupIntervalMs: config.rateLimit.cleanupIntervalMs
};

module.exports = {
  rateLimitConfig,
  validateRateLimitConfig
};
