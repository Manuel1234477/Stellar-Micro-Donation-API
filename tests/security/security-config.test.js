/**
 * Security Configuration Tests
 * Tests safe defaults, validation, and misconfiguration handling
 */

const { securityConfig, loadSecurityConfig, getSecuritySummary, SECURITY_CONFIGS } = require('../../src/config/securityConfig');

describe('Security Configuration', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear security-related environment variables
    const securityVars = Object.keys(SECURITY_CONFIGS);
    securityVars.forEach(varName => {
      delete process.env[varName];
    });
    // Always set a fixed test key so loadSecurityConfig() doesn't exit
    process.env.ENCRYPTION_KEY = 'test_encryption_key_fixed_32bytes_hex_value_here_00';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Safe Defaults', () => {
    test('should provide safe defaults when no environment variables are set', () => {
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual([]);
      expect(config.DEBUG_MODE).toBe('false');
      expect(config.STELLAR_NETWORK).toBe('testnet');
      expect(config.MOCK_STELLAR).toBe('true');
      expect(config.RATE_LIMIT).toBe('100');
      expect(config.ENCRYPTION_KEY).toBe(process.env.ENCRYPTION_KEY); // Must be explicitly set
      expect(config.HORIZON_URL).toBeNull();
      expect(config.SERVICE_SECRET_KEY).toBeNull();
      expect(config.STELLAR_SECRET).toBeNull();
    });

    test('should use the provided ENCRYPTION_KEY without modification', () => {
      const config = loadSecurityConfig();
      
      expect(config.ENCRYPTION_KEY).toBeTruthy();
      expect(typeof config.ENCRYPTION_KEY).toBe('string');
      expect(config.ENCRYPTION_KEY.length).toBeGreaterThanOrEqual(32);
    });

    test('should use testnet as safe default when Stellar network', () => {
      delete process.env.STELLAR_NETWORK;
      const config = loadSecurityConfig();
      
      expect(config.STELLAR_NETWORK).toBe('testnet');
    });

    test('should enable mock Stellar by default when safety', () => {
      delete process.env.MOCK_STELLAR;
      const config = loadSecurityConfig();
      
      expect(config.MOCK_STELLAR).toBe('true');
    });

    test('should disable debug mode by default when security', () => {
      delete process.env.DEBUG_MODE;
      const config = loadSecurityConfig();
      
      expect(config.DEBUG_MODE).toBe('false');
    });
  });

  describe('Configuration Validation', () => {
    test('should validate API keys format', () => {
      process.env.API_KEYS = 'key1,key2, key3 ,';
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual(['key1', 'key2', 'key3']);
    });

    test('should reject empty API keys', () => {
      process.env.API_KEYS = ', , ,';
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual([]);
    });

    test('should validate Stellar network values', () => {
      process.env.STELLAR_NETWORK = 'MAINNET';
      const config = loadSecurityConfig();
      
      expect(config.STELLAR_NETWORK).toBe('mainnet');
    });

    test('should fallback to testnet when invalid Stellar network', () => {
      process.env.STELLAR_NETWORK = 'invalid-network';
      const config = loadSecurityConfig();
      
      expect(config.STELLAR_NETWORK).toBe('testnet');
    });

    test('should validate boolean values', () => {
      process.env.DEBUG_MODE = 'TRUE';
      process.env.MOCK_STELLAR = 'FALSE';
      const config = loadSecurityConfig();
      
      expect(config.DEBUG_MODE).toBe('true');
      expect(config.MOCK_STELLAR).toBe('false');
    });

    test('should normalize boolean values', () => {
      process.env.DEBUG_MODE = 'True';
      process.env.MOCK_STELLAR = 'False';
      const config = loadSecurityConfig();
      
      expect(config.DEBUG_MODE).toBe('true');
      expect(config.MOCK_STELLAR).toBe('false');
    });

    test('should validate rate limit values', () => {
      process.env.RATE_LIMIT = '500';
      const config = loadSecurityConfig();
      
      expect(config.RATE_LIMIT).toBe('500');
    });

    test('should fallback to default when invalid rate limit', () => {
      process.env.RATE_LIMIT = '-100';
      const config = loadSecurityConfig();
      
      expect(config.RATE_LIMIT).toBe('100');
    });

    test('should validate Horizon URL format', () => {
      process.env.HORIZON_URL = 'https://custom.example.com';
      const config = loadSecurityConfig();
      
      expect(config.HORIZON_URL).toBe('https://custom.example.com/');
    });

    test('should reject invalid Horizon URL', () => {
      process.env.HORIZON_URL = 'not-a-url';
      const config = loadSecurityConfig();
      
      expect(config.HORIZON_URL).toBeNull();
    });

    test('should require HTTPS when Horizon URL in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.HORIZON_URL = 'http://insecure.example.com';
      const config = loadSecurityConfig();
      
      expect(config.HORIZON_URL).toBeNull();
    });

    test('should validate Stellar secret key format', () => {
      process.env.SERVICE_SECRET_KEY = 'S' + 'A'.repeat(55);
      const config = loadSecurityConfig();
      
      expect(config.SERVICE_SECRET_KEY).toBe(process.env.SERVICE_SECRET_KEY);
    });

    test('should reject invalid Stellar secret key', () => {
      process.env.SERVICE_SECRET_KEY = 'invalid-key';
      const config = loadSecurityConfig();
      
      expect(config.SERVICE_SECRET_KEY).toBeNull();
    });
  });

  describe('Production Requirements', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    test('should exit when ENCRYPTION_KEY is not set', () => {
      const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {});
      delete process.env.ENCRYPTION_KEY;
      
      loadSecurityConfig();
      
      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });

    test('should accept valid encryption key in production', () => {
      process.env.ENCRYPTION_KEY = 'valid-production-key';
      const config = loadSecurityConfig();
      
      expect(config.ENCRYPTION_KEY).toBe('valid-production-key');
    });
  });

  describe('Security Summary', () => {
    test('should provide safe summary when logging', () => {
      process.env.API_KEYS = 'secret-key-1,secret-key-2';
      process.env.ENCRYPTION_KEY = 'secret-encryption-key';
      process.env.SERVICE_SECRET_KEY = 'S' + 'A'.repeat(55);
      
      const summary = getSecuritySummary();
      
      expect(summary.API_KEYS).toBe('[CONFIGURED]');
      expect(summary.ENCRYPTION_KEY).toBe('[CONFIGURED]');
      expect(summary.SERVICE_SECRET_KEY).toBe('[CONFIGURED]');
      expect(summary.STELLAR_SECRET).toBe('[NOT SET]');
      expect(summary.DEBUG_MODE).toBe('false');
      expect(summary.STELLAR_NETWORK).toBe('testnet');
    });

    test('should show CONFIGURED when encryption key is set and NOT SET when missing secrets', () => {
      // Clear API keys and secrets to test NOT SET behavior
      process.env.API_KEYS = '';
      delete process.env.SERVICE_SECRET_KEY;
      delete process.env.STELLAR_SECRET;
      // ENCRYPTION_KEY is set in beforeEach
      
      const summary = getSecuritySummary();
      
      expect(summary.ENCRYPTION_KEY).toBe('[CONFIGURED]');
      expect(summary.SERVICE_SECRET_KEY).toBe('[NOT SET]');
      expect(summary.STELLAR_SECRET).toBe('[NOT SET]');
    });
  });

  describe('Configuration Constants', () => {
    test('should expose security configuration definitions', () => {
      expect(SECURITY_CONFIGS).toBeDefined();
      expect(SECURITY_CONFIGS.API_KEYS).toBeDefined();
      expect(SECURITY_CONFIGS.ENCRYPTION_KEY).toBeDefined();
      expect(SECURITY_CONFIGS.DEBUG_MODE).toBeDefined();
      expect(SECURITY_CONFIGS.STELLAR_NETWORK).toBeDefined();
      expect(SECURITY_CONFIGS.MOCK_STELLAR).toBeDefined();
      expect(SECURITY_CONFIGS.RATE_LIMIT).toBeDefined();
      expect(SECURITY_CONFIGS.HORIZON_URL).toBeDefined();
      expect(SECURITY_CONFIGS.SERVICE_SECRET_KEY).toBeDefined();
      expect(SECURITY_CONFIGS.STELLAR_SECRET).toBeDefined();
    });

    test('should have proper configuration structure', () => {
      Object.values(SECURITY_CONFIGS).forEach(config => {
        expect(config).toHaveProperty('required');
        expect(config).toHaveProperty('safeDefault');
        expect(config).toHaveProperty('validator');
        expect(config).toHaveProperty('description');
        expect(typeof config.validator).toBe('function');
      });
    });
  });

  describe('Edge Cases', () => {
    test('should handle null and undefined values gracefully', () => {
      process.env.API_KEYS = null;
      // ENCRYPTION_KEY is set in beforeEach; keep it so the server doesn't exit
      
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual([]);
      expect(config.ENCRYPTION_KEY).toBeTruthy();
    });

    test('should handle whitespace-only values', () => {
      process.env.API_KEYS = '   ';
      process.env.DEBUG_MODE = '   true   ';
      
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual([]);
      expect(config.DEBUG_MODE).toBe('true');
    });

    test('should handle empty string values', () => {
      process.env.API_KEYS = '';
      // ENCRYPTION_KEY is set in beforeEach; keep it so the server doesn't exit
      
      const config = loadSecurityConfig();
      
      expect(config.API_KEYS).toEqual([]);
      expect(config.ENCRYPTION_KEY).toBeTruthy();
    });
  });
});
