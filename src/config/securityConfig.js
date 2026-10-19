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
const { unwrapEncryptionKey } = require('../utils/kms');

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
    validator: (value, env = process.env) => {
      try {
        if (!value || !value.trim()) return null;
        const url = new URL(value.trim());
        // Only allow HTTPS in production
        if (env.NODE_ENV === 'production' && url.protocol !== 'https:') {
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
      // Stellar secret keys must start with 'S', be exactly 56 characters,
      // and contain only uppercase letters A-Z and digits 2-7 (base32 alphabet).
      // This matches the isValidStellarSecretKey() pattern used elsewhere in
      // the codebase (src/utils/validators.js) and rejects keys that merely
      // start with 'S' and are >= 56 chars — an overly permissive check that
      // would accept invalid characters or incorrect lengths beyond 56.
      const stellarSecretKeyRegex = /^S[A-Z2-7]{55}$/;
      if (stellarSecretKeyRegex.test(trimmed)) {
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
 * Load and validate security configuration with safe defaults.
 *
 * Pure function of the supplied env object: no reads or writes of the global
 * `process.env`, so it can be exercised directly in tests without module cache
 * tricks. Defaults to `process.env` for production callers.
 */
function loadSecurityConfig(env = process.env) {
  const config = {};
  const misconfigurations = [];
  const isProduction = env.NODE_ENV === 'production';

  log.info('SECURITY_CONFIG', 'Loading security configuration', { 
    environment: env.NODE_ENV || 'development' 
  });

  if (env.KMS_KEY_ID && !env.ENCRYPTED_ENCRYPTION_KEY && !env.ENCRYPTION_KEY) {
    throw new Error('KMS_KEY_ID is set, but ENCRYPTED_ENCRYPTION_KEY is missing. Use the KMS wrapping script before startup.');
  }

  if (env.KMS_KEY_ID && env.ENCRYPTED_ENCRYPTION_KEY && !env.ENCRYPTION_KEY) {
    try {
      env.ENCRYPTION_KEY = unwrapEncryptionKey();
    } catch (error) {
      throw new Error(`KMS key unwrapping failed at startup: ${error.message}`);
    }
  }

  Object.entries(SECURITY_CONFIGS).forEach(([key, configDef]) => {
    const envValue = env[key];
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
      const validatedValue = configDef.validator(envValue, env);
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

    // ENCRYPTION_KEY must always be explicitly set — never auto-generate.
    // In production this is a fatal misconfiguration (fail fast); in dev/test we
    // throw a catchable error instead of killing the process/worker.
    if (key === 'ENCRYPTION_KEY' && !finalValue) {
      log.error('SECURITY_CONFIG', 'ENCRYPTION_KEY is not set. Run `npm run generate-key` to create one, then add it to your .env file.');
      if (isProduction) {
        process.exit(1);
      }
      throw new Error('ENCRYPTION_KEY is not set');
    }

    config[key] = finalValue;

    // Log con

/* … truncated 2928 chars — edit only what you need near the top … */
