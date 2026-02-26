/**
 * Security Configuration - Security Settings Layer
 * 
 * RESPONSIBILITY: Security-sensitive configuration with safe defaults and validation
 * OWNER: Security Team
 * DEPENDENCIES: Logger, crypto
 * 
 * Provides secure default values for API keys, encryption, and security settings.
 * Logs misconfigurations while ensuring the application runs safely in all environments.
 */

const log = require('../utils/log');
const crypto = require('crypto');

/**
 * Security-sensitive environment variables and their safe defaults
 */
const SECURITY_CONFIGS = {
  // API Authentication
  API_KEYS: {
    required: true,
    safeDefault: [], // Empty array = no API access, must be explicitly configured
    validator: (value) => {
      const keys = value.split(',').map(k => k.trim()).filter(Boolean);
      return keys.length > 0 ? keys : null;
    },
    description: 'Comma-separated list of API keys for authentication'
  },

  // Data Encryption
  ENCRYPTION_KEY: {
    required: false, // Only required in production
    safeDefault: null, // Will generate a development key
    validator: (value) => value && value.trim().length > 0 ? value.trim() : null,
    description: 'Encryption key for sensitive data storage'
  },

  // Debug Mode Security
  DEBUG_MODE: {
    required: false,
    safeDefault: 'false', // Always disabled by default for security
    validator: (value) => {
      const normalized = value?.toLowerCase().trim();
      return ['true', 'false'].includes(normalized) ? normalized : 'false';
    },
    description: 'Enable debug logging (NEVER enable in production)'
  },

  // Stellar Network Security
  STELLAR_NETWORK: {
    required: false,
    safeDefault: 'testnet', // Safest network for development
    validator: (value) => {
      const normalized = value?.toLowerCase().trim();
      const validNetworks = ['testnet', 'mainnet', 'futurenet'];
      return validNetworks.includes(normalized) ? normalized : 'testnet';
    },
    description: 'Stellar blockchain network (testnet, mainnet, futurenet)'
  },

  // Mock Stellar for Security
  MOCK_STELLAR: {
    required: false,
    safeDefault: 'true', // Use mock by default to prevent accidental mainnet usage
    validator: (value) => {
      const normalized = value?.toLowerCase().trim();
      return ['true', 'false'].includes(normalized) ? normalized : 'true';
    },
    description: 'Use mock Stellar service instead of live network'
  },

  // Rate Limiting Security
  RATE_LIMIT: {
    required: false,
    safeDefault: '100', // Conservative rate limiting
    validator: (value) => {
      const num = parseInt(value, 10);
      return (!isNaN(num) && num > 0 && num <= 10000) ? num.toString() : '100';
    },
    description: 'Maximum requests per minute per IP'
  },

  // Custom Horizon URL Security
  HORIZON_URL: {
    required: false,
    safeDefault: null, // Use network defaults
    validator: (value) => {
      try {
        if (!value || !value.trim()) return null;
        const url = new URL(value.trim());
        // Only allow HTTPS in production
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
          log.warn('SECURITY_CONFIG', 'Insecure Horizon URL protocol detected, using default', {
            url: value.trim(),
            protocol: url.protocol
          });
          return null;
        }
        return url.toString();
      } catch (error) {
        log.warn('SECURITY_CONFIG', 'Invalid Horizon URL format, using default', { 
          url: value, 
          error: error.message 
        });
        return null;
      }
    },
    description: 'Custom Stellar Horizon endpoint URL (HTTPS required in production)'
  },

  // Service Secret Keys
  SERVICE_SECRET_KEY: {
    required: false,
    safeDefault: null, // No service operations by default
    validator: (value) => {
      if (!value || !value.trim()) return null;
      const trimmed = value.trim();
      // Basic Stellar secret key validation
      if (trimmed.startsWith('S') && trimmed.length >= 56) {
        return trimmed;
      }
      log.warn('SECURITY_CONFIG', 'Invalid Stellar secret key format, ignoring', {
        keyPrefix: trimmed.substring(0, 10) + '...'
      });
      return null;
    },
    description: 'Stellar secret key for service operations'
  },

  STELLAR_SECRET: {
    required: false,
    safeDefault: null, // Alias for SERVICE_SECRET_KEY
    validator: (value) => SECURITY_CONFIGS.SERVICE_SECRET_KEY.validator(value),
    description: 'Alias for SERVICE_SECRET_KEY'
  }
};

/**
 * Generate a secure development encryption key
 */
function generateDevEncryptionKey() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Load and validate security configuration with safe defaults
 */
function loadSecurityConfig() {
  const config = {};
  const misconfigurations = [];
  const isProduction = process.env.NODE_ENV === 'production';

  log.info('SECURITY_CONFIG', 'Loading security configuration', { 
    environment: process.env.NODE_ENV || 'development' 
  });

  Object.entries(SECURITY_CONFIGS).forEach(([key, configDef]) => {
    const envValue = process.env[key];
    let finalValue;

    // Check if required in production
    if (isProduction && configDef.required && !envValue) {
      misconfigurations.push({
        config: key,
        issue: 'Required in production but not set',
        severity: 'ERROR'
      });
      // For critical configs, use safe default but log error
      if (key === 'API_KEYS') {
        finalValue = configDef.safeDefault;
        log.error('SECURITY_CONFIG', 'CRITICAL: API_KEYS required in production but not found', {
          config: key,
          safeDefault: finalValue
        });
      }
    } else if (envValue) {
      // Validate provided value
      const validatedValue = configDef.validator(envValue);
      if (validatedValue === null || validatedValue === undefined) {
        misconfigurations.push({
          config: key,
          issue: `Invalid value: "${envValue}"`,
          severity: 'WARNING',
          usedDefault: true
        });
        finalValue = configDef.safeDefault;
      } else {
        finalValue = validatedValue;
      }
    } else {
      // Use safe default
      finalValue = configDef.safeDefault;
      if (envValue !== undefined) {
        misconfigurations.push({
          config: key,
          issue: 'Empty or invalid value, using safe default',
          severity: 'INFO',
          usedDefault: true,
          defaultValue: finalValue
        });
      }
    }

    // Special handling for encryption key
    if (key === 'ENCRYPTION_KEY' && !finalValue && !isProduction) {
      finalValue = generateDevEncryptionKey();
      misconfigurations.push({
        config: key,
        issue: 'Generated development encryption key',
        severity: 'INFO',
        usedDefault: true,
        isGenerated: true
      });
      log.info('SECURITY_CONFIG', 'Generated development encryption key', {
        config: key,
        keyLength: finalValue.length
      });
    }

    config[key] = finalValue;

    // Log configuration loading (without sensitive values)
    const logValue = key.includes('KEY') || key.includes('SECRET') 
      ? '[REDACTED]' 
      : finalValue;
    
    log.debug('SECURITY_CONFIG', `Loaded ${key}`, {
      value: logValue,
      source: envValue ? 'environment' : 'default'
    });
  });

  // Log misconfigurations
  if (misconfigurations.length > 0) {
    log.warn('SECURITY_CONFIG', 'Security configuration issues detected', {
      count: misconfigurations.length,
      issues: misconfigurations.map(m => ({
        config: m.config,
        issue: m.issue,
        severity: m.severity
      }))
    });

    // Check for critical issues
    const criticalIssues = misconfigurations.filter(m => m.severity === 'ERROR');
    if (criticalIssues.length > 0 && isProduction) {
      log.error('SECURITY_CONFIG', 'CRITICAL security misconfigurations in production', {
        issues: criticalIssues
      });
    }
  }

  // Security recommendations
  logSecurityRecommendations(config, isProduction);

  return config;
}

/**
 * Log security recommendations based on current configuration
 */
function logSecurityRecommendations(config, isProduction) {
  const recommendations = [];

  if (isProduction) {
    if (config.DEBUG_MODE === 'true') {
      recommendations.push('Disable DEBUG_MODE in production');
    }
    if (config.MOCK_STELLAR === 'true') {
      recommendations.push('Consider disabling MOCK_STELLAR in production');
    }
    if (!config.ENCRYPTION_KEY) {
      recommendations.push('Set ENCRYPTION_KEY in production');
    }
    if (!config.SERVICE_SECRET_KEY && !config.STELLAR_SECRET) {
      recommendations.push('Consider setting SERVICE_SECRET_KEY for service operations');
    }
  } else {
    if (config.STELLAR_NETWORK === 'mainnet') {
      recommendations.push('Avoid using mainnet in development environments');
    }
    if (config.RATE_LIMIT === '100') {
      recommendations.push('Consider adjusting RATE_LIMIT for development testing');
    }
  }

  if (recommendations.length > 0) {
    log.info('SECURITY_CONFIG', 'Security recommendations', {
      environment: isProduction ? 'production' : 'development',
      recommendations
    });
  }
}

/**
 * Get security configuration summary (safe for logging)
 */
function getSecuritySummary() {
  const config = loadSecurityConfig();
  const summary = {};

  Object.entries(config).forEach(([key, value]) => {
    if (key.includes('KEY') || key.includes('SECRET')) {
      summary[key] = value ? '[CONFIGURED]' : '[NOT SET]';
    } else if (key === 'API_KEYS') {
      summary[key] = Array.isArray(value) && value.length > 0 ? '[CONFIGURED]' : '[NOT SET]';
    } else {
      summary[key] = value;
    }
  });

  return summary;
}

// Load configuration at module initialization
const securityConfig = loadSecurityConfig();

module.exports = {
  securityConfig,
  loadSecurityConfig,
  getSecuritySummary,
  SECURITY_CONFIGS
};
