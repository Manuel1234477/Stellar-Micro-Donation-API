/**
 * Centralized Configuration Module Tests
 * Tests for the new config module that replaces direct process.env access
 */

const { createIsolatedEnvironment } = require('./helpers/testIsolation');

describe('Centralized Configuration Module', () => {
  let cleanup;
  let config;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  describe('Configuration Loading', () => {
    it('should load default configuration values', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.server.port).toBe(3000);
      expect(config.server.env).toBe('test');
      expect(config.stellar.network).toBe('testnet');
      expect(config.donations.minAmount).toBe(0.01);
      expect(config.donations.maxAmount).toBe(10000);
    });

    it('should load custom configuration from environment', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'dev-key',
        PORT: '4000',
        STELLAR_NETWORK: 'mainnet',
        MIN_DONATION_AMOUNT: '1.0',
        MAX_DONATION_AMOUNT: '5000'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.server.port).toBe(4000);
      expect(config.stellar.network).toBe('mainnet');
      expect(config.donations.minAmount).toBe(1.0);
      expect(config.donations.maxAmount).toBe(5000);
    });

    it('should skip validation in test environment', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test'
        // Intentionally missing API_KEYS
      });

      delete require.cache[require.resolve('../src/config')];
      
      expect(() => {
        config = require('../src/config');
      }).not.toThrow();
    });
  });

  describe('Server Configuration', () => {
    it('should provide server configuration', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'test-key',
        PORT: '3500',
        API_PREFIX: '/api/v2'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.server).toMatchObject({
        port: 3500,
        env: 'development',
        isProduction: false,
        isDevelopment: true,
        isTest: false,
        apiPrefix: '/api/v2'
      });
    });

    it('should detect production environment', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'production',
        API_KEYS: 'prod-key',
        ENCRYPTION_KEY: 'prod-encryption-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.server.isProduction).toBe(true);
      expect(config.server.isDevelopment).toBe(false);
    });
  });

  describe('Stellar Configuration', () => {
    it('should provide stellar configuration with defaults', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.stellar).toMatchObject({
        network: 'testnet',
        mockEnabled: false,
        serviceSecretKey: null
      });
      expect(config.stellar.horizonUrl).toContain('testnet');
    });

    it('should support custom horizon URL', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        HORIZON_URL: 'https://custom-horizon.example.com'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.stellar.horizonUrl).toBe('https://custom-horizon.example.com');
    });

    it('should enable mock mode when configured', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        MOCK_STELLAR: 'true'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.stellar.mockEnabled).toBe(true);
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should provide rate limit defaults', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.rateLimit).toMatchObject({
        maxRequests: 100,
        windowMs: 60000,
        cleanupIntervalMs: 300000
      });
    });

    it('should parse custom rate limit values', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        RATE_LIMIT_MAX_REQUESTS: '200',
        RATE_LIMIT_WINDOW_MS: '120000'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.rateLimit.maxRequests).toBe(200);
      expect(config.rateLimit.windowMs).toBe(120000);
    });
  });

  describe('Donation Limits Configuration', () => {
    it('should provide donation limit defaults', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.donations).toMatchObject({
        minAmount: 0.01,
        maxAmount: 10000,
        maxDailyPerDonor: 0
      });
    });

    it('should parse custom donation limits', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        MIN_DONATION_AMOUNT: '0.5',
        MAX_DONATION_AMOUNT: '1000',
        MAX_DAILY_DONATION_PER_DONOR: '100'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.donations.minAmount).toBe(0.5);
      expect(config.donations.maxAmount).toBe(1000);
      expect(config.donations.maxDailyPerDonor).toBe(100);
    });
  });

  describe('Logging Configuration', () => {
    it('should provide logging defaults', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.logging).toMatchObject({
        toFile: false,
        verbose: false,
        debugMode: false
      });
      expect(config.logging.directory).toContain('logs');
    });

    it('should parse logging flags', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        LOG_TO_FILE: 'true',
        LOG_VERBOSE: 'true',
        DEBUG_MODE: 'true'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.logging.toFile).toBe(true);
      expect(config.logging.verbose).toBe(true);
      expect(config.logging.debugMode).toBe(true);
    });
  });

  describe('API Keys Configuration', () => {
    it('should parse legacy API keys', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'key1,key2,key3'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.apiKeys.legacy).toEqual(['key1', 'key2', 'key3']);
    });

    it('should handle empty API keys', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: ''
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.apiKeys.legacy).toEqual([]);
    });
  });

  describe('Encryption Configuration', () => {
    it('should provide encryption config', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key',
        ENCRYPTION_KEY: 'test-encryption-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.encryption.key).toBe('test-encryption-key');
      expect(config.encryption.requireInProduction).toBe(false);
    });

    it('should require encryption key in production', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'production',
        API_KEYS: 'prod-key',
        ENCRYPTION_KEY: 'prod-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.encryption.requireInProduction).toBe(true);
    });
  });

  describe('Validation', () => {
    it('should validate PORT range', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'test-key',
        PORT: '99999'
      });

      delete require.cache[require.resolve('../src/config')];
      
      expect(() => {
        config = require('../src/config');
      }).toThrow(/PORT must be <= 65535/);
    });

    it('should validate STELLAR_NETWORK values', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'test-key',
        STELLAR_NETWORK: 'invalid-network'
      });

      delete require.cache[require.resolve('../src/config')];
      
      expect(() => {
        config = require('../src/config');
      }).toThrow(/STELLAR_NETWORK must be one of/);
    });

    it('should validate boolean flags', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'test-key',
        MOCK_STELLAR: 'maybe'
      });

      delete require.cache[require.resolve('../src/config')];
      
      expect(() => {
        config = require('../src/config');
      }).toThrow(/MOCK_STELLAR must be either "true" or "false"/);
    });

    it('should validate HORIZON_URL format', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'development',
        API_KEYS: 'test-key',
        HORIZON_URL: 'not-a-valid-url'
      });

      delete require.cache[require.resolve('../src/config')];
      
      expect(() => {
        config = require('../src/config');
      }).toThrow(/HORIZON_URL must be a valid URL/);
    });
  });

  describe('Application Metadata', () => {
    it('should provide app metadata', () => {
      cleanup = createIsolatedEnvironment({
        NODE_ENV: 'test',
        API_KEYS: 'test-key'
      });

      delete require.cache[require.resolve('../src/config')];
      config = require('../src/config');

      expect(config.app.name).toBe('stellar-micro-donation-api');
      expect(config.app.version).toBeDefined();
    });
  });
});
