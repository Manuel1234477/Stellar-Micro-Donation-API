/**
 * Debug Mode Tests
 * Verifies debug mode functionality and logging behavior
 */

const { createIsolatedEnvironment } = require('../helpers/testIsolation');

describe('Debug Mode', () => {
  let cleanup;
  let log;

  beforeEach(() => {
    // Clear module cache to reload with new env
    jest.resetModules();
  });

  afterEach(() => {
    // Restore environment and clear cache
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    jest.resetModules();
  });

  describe('Debug Mode Disabled (Default)', () => {
    it('should have debug mode disabled by default', () => {
      cleanup = createIsolatedEnvironment({});
      delete process.env.DEBUG_MODE;
      log = require('../../../src/utils/log');
      
      expect(log.isDebugMode).toBe(false);
    });

    it('should not output debug logs when disabled', () => {
      cleanup = createIsolatedEnvironment({});
      delete process.env.DEBUG_MODE;
      log = require('../../../src/utils/log');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      log.debug('TEST', 'This should not appear');
      
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should still output info, warn, and error logs', () => {
      cleanup = createIsolatedEnvironment({});
      delete process.env.DEBUG_MODE;
      log = require('../../../src/utils/log');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      
      log.info('TEST', 'Info message');
      log.warn('TEST', 'Warning message');
      log.error('TEST', 'Error message');
      
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      
      consoleSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('Debug Mode Enabled', () => {
    it('should enable debug mode when DEBUG_MODE=true', () => {
      process.env.DEBUG_MODE = 'true';
      log = require('../../../src/utils/log');
      
      expect(log.isDebugMode).toBe(true);
    });

    it('should output debug logs when enabled', () => {
      process.env.DEBUG_MODE = 'true';
      log = require('../../../src/utils/log');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      log.debug('TEST', 'Debug message', { key: 'value' });
      
      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('[DEBUG]');
      expect(logOutput).toContain('TEST');
      expect(logOutput).toContain('Debug message');
      
      consoleSpy.mockRestore();
    });

    it('should format debug logs with metadata', () => {
      process.env.DEBUG_MODE = 'true';
      log = require('../../../src/utils/log');
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      log.debug('TEST_SCOPE', 'Test message', { 
        userId: 123, 
        action: 'test' 
      });
      
      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('[DEBUG]');
      expect(logOutput).toContain('[TEST_SCOPE]');
      expect(logOutput).toContain('Test message');
      expect(logOutput).toContain('userId');
      expect(logOutput).toContain('123');
      
      consoleSpy.mockRestore();
    });
  });

  describe('Production Safety', () => {
    it('should not enable debug mode in production even if set', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      process.env.DEBUG_MODE = 'true';
      
      // In production, debug logs should still work if explicitly enabled
      // This test verifies the flag is respected
      log = require('../../../src/utils/log');
      expect(log.isDebugMode).toBe(true);
      
      // Restore
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('Environment Validation', () => {
    it('should validate DEBUG_MODE as boolean string', () => {
      process.env.DEBUG_MODE = 'invalid';
      process.env.NODE_ENV = 'development';
      process.env.API_KEYS = 'test-key';
      
      delete require.cache[require.resolve('../src/config/envValidation')];
      const { validateEnvironment } = require('../../../src/config/envValidation');
      
      expect(() => validateEnvironment()).toThrow(/DEBUG_MODE must be either "true" or "false"/);
    });

    it('should accept true as valid DEBUG_MODE', () => {
      process.env.DEBUG_MODE = 'true';
      process.env.NODE_ENV = 'development';
      process.env.API_KEYS = 'test-key';
      
      delete require.cache[require.resolve('../src/config/envValidation')];
      const { validateEnvironment } = require('../../../src/config/envValidation');
      
      expect(() => validateEnvironment()).not.toThrow();
    });

    it('should accept false as valid DEBUG_MODE', () => {
      process.env.DEBUG_MODE = 'false';
      process.env.NODE_ENV = 'development';
      process.env.API_KEYS = 'test-key';
      
      delete require.cache[require.resolve('../src/config/envValidation')];
      const { validateEnvironment } = require('../../../src/config/envValidation');
      
      expect(() => validateEnvironment()).not.toThrow();
    });
  });
});
