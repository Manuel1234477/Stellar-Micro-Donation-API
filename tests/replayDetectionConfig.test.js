/**
 * Unit tests for replay detection configuration module
 * Tests configuration loading, validation, and default value handling
 */

describe('Replay Detection Configuration', () => {
  let originalEnv;
  let log;

  beforeAll(() => {
    // Mock the logger module before any imports
    jest.mock('../src/utils/log', () => ({
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
  });

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Set required env vars for main config
    process.env.NODE_ENV = 'test';
    process.env.API_KEYS = 'test-key';
    
    // Clear replay detection environment variables
    delete process.env.REPLAY_THRESHOLD;
    delete process.env.REPLAY_WINDOW_SECONDS;
    delete process.env.REPLAY_CLEANUP_INTERVAL_SECONDS;
    
    // Clear module cache to reload config with new env vars
    jest.resetModules();
    
    // Re-require the mocked log module
    log = require('../src/utils/log');
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Default Values', () => {
    test('should use default values when environment variables are not set', () => {
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(config.windowSeconds).toBe(60);
      expect(config.cleanupIntervalSeconds).toBe(60);
    });

    test('should use default values when environment variables are empty strings', () => {
      process.env.REPLAY_THRESHOLD = '';
      process.env.REPLAY_WINDOW_SECONDS = '';
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(config.windowSeconds).toBe(60);
      expect(config.cleanupIntervalSeconds).toBe(60);
    });
  });

  describe('Valid Configuration', () => {
    test('should load valid threshold value', () => {
      process.env.REPLAY_THRESHOLD = '5';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(5);
    });

    test('should load valid window seconds value', () => {
      process.env.REPLAY_WINDOW_SECONDS = '120';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(120);
    });

    test('should load valid cleanup interval value', () => {
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '300';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.cleanupIntervalSeconds).toBe(300);
    });

    test('should load all valid values together', () => {
      process.env.REPLAY_THRESHOLD = '4';
      process.env.REPLAY_WINDOW_SECONDS = '90';
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '180';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(4);
      expect(config.windowSeconds).toBe(90);
      expect(config.cleanupIntervalSeconds).toBe(180);
    });

    test('should accept minimum valid threshold (2)', () => {
      process.env.REPLAY_THRESHOLD = '2';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(2);
    });

    test('should accept minimum valid window (10 seconds)', () => {
      process.env.REPLAY_WINDOW_SECONDS = '10';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(10);
    });
  });

  describe('Invalid Configuration - Threshold', () => {
    test('should use default and log warning when threshold is below minimum (< 2)', () => {
      process.env.REPLAY_THRESHOLD = '1';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(log.warn).toHaveBeenCalledWith(
        'REPLAY_DETECTION_CONFIG',
        'Invalid REPLAY_THRESHOLD, using default 3',
        expect.objectContaining({
          providedValue: 1,
          minimumRequired: 2
        })
      );
    });

    test('should use default and log warning when threshold is 0', () => {
      process.env.REPLAY_THRESHOLD = '0';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(log.warn).toHaveBeenCalled();
    });

    test('should use default and log warning when threshold is negative', () => {
      process.env.REPLAY_THRESHOLD = '-5';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(log.warn).toHaveBeenCalled();
    });

    test('should use default and log warning when threshold is not a number', () => {
      process.env.REPLAY_THRESHOLD = 'invalid';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(log.warn).toHaveBeenCalledWith(
        'REPLAY_DETECTION_CONFIG',
        'Invalid REPLAY_THRESHOLD, using default 3',
        expect.objectContaining({
          providedValue: 'invalid',
          reason: 'not a valid integer'
        })
      );
    });

    test('should use default and log warning when threshold is a float', () => {
      process.env.REPLAY_THRESHOLD = '3.5';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
    });
  });

  describe('Invalid Configuration - Window Seconds', () => {
    test('should use default and log warning when window is below minimum (< 10)', () => {
      process.env.REPLAY_WINDOW_SECONDS = '5';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalledWith(
        'REPLAY_DETECTION_CONFIG',
        'Invalid REPLAY_WINDOW_SECONDS, using default 60',
        expect.objectContaining({
          providedValue: 5,
          minimumRequired: 10
        })
      );
    });

    test('should use default and log warning when window is 0', () => {
      process.env.REPLAY_WINDOW_SECONDS = '0';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalled();
    });

    test('should use default and log warning when window is negative', () => {
      process.env.REPLAY_WINDOW_SECONDS = '-10';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalled();
    });

    test('should use default and log warning when window is not a number', () => {
      process.env.REPLAY_WINDOW_SECONDS = 'abc';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.windowSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalledWith(
        'REPLAY_DETECTION_CONFIG',
        'Invalid REPLAY_WINDOW_SECONDS, using default 60',
        expect.objectContaining({
          providedValue: 'abc',
          reason: 'not a valid integer'
        })
      );
    });
  });

  describe('Invalid Configuration - Cleanup Interval', () => {
    test('should use default and log warning when cleanup interval is not a number', () => {
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = 'invalid';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.cleanupIntervalSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalledWith(
        'REPLAY_DETECTION_CONFIG',
        'Invalid REPLAY_CLEANUP_INTERVAL_SECONDS, using default 60',
        expect.objectContaining({
          providedValue: 'invalid',
          reason: 'not a valid integer'
        })
      );
    });

    test('should accept cleanup interval of 1 (no minimum constraint)', () => {
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '1';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.cleanupIntervalSeconds).toBe(1);
    });
  });

  describe('Mixed Valid and Invalid Configuration', () => {
    test('should use defaults only for invalid values', () => {
      process.env.REPLAY_THRESHOLD = '5'; // valid
      process.env.REPLAY_WINDOW_SECONDS = '5'; // invalid (< 10)
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '120'; // valid
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(5);
      expect(config.windowSeconds).toBe(60); // default
      expect(config.cleanupIntervalSeconds).toBe(120);
      expect(log.warn).toHaveBeenCalledTimes(1);
    });

    test('should handle all invalid values', () => {
      process.env.REPLAY_THRESHOLD = '1'; // invalid (< 2)
      process.env.REPLAY_WINDOW_SECONDS = 'abc'; // invalid (not a number)
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = 'xyz'; // invalid (not a number)
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(3);
      expect(config.windowSeconds).toBe(60);
      expect(config.cleanupIntervalSeconds).toBe(60);
      expect(log.warn).toHaveBeenCalledTimes(3);
    });
  });

  describe('Edge Cases', () => {
    test('should handle very large valid values', () => {
      process.env.REPLAY_THRESHOLD = '1000';
      process.env.REPLAY_WINDOW_SECONDS = '86400'; // 1 day
      process.env.REPLAY_CLEANUP_INTERVAL_SECONDS = '3600'; // 1 hour
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(1000);
      expect(config.windowSeconds).toBe(86400);
      expect(config.cleanupIntervalSeconds).toBe(3600);
    });

    test('should handle whitespace in values', () => {
      process.env.REPLAY_THRESHOLD = '  5  ';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(5);
    });

    test('should handle values with leading zeros', () => {
      process.env.REPLAY_THRESHOLD = '005';
      
      const config = require('../src/config/replayDetection');
      
      expect(config.threshold).toBe(5);
    });
  });

  describe('Module Exports', () => {
    test('should export configuration object', () => {
      const config = require('../src/config/replayDetection');
      
      expect(config).toHaveProperty('threshold');
      expect(config).toHaveProperty('windowSeconds');
      expect(config).toHaveProperty('cleanupIntervalSeconds');
    });

    test('should export loadConfig function for testing', () => {
      const module = require('../src/config/replayDetection');
      
      expect(typeof module.loadConfig).toBe('function');
    });

    test('should export DEFAULTS constant', () => {
      const module = require('../src/config/replayDetection');
      
      expect(module.DEFAULTS).toEqual({
        threshold: 3,
        windowSeconds: 60,
        cleanupIntervalSeconds: 60
      });
    });

    test('should export MINIMUMS constant', () => {
      const module = require('../src/config/replayDetection');
      
      expect(module.MINIMUMS).toEqual({
        threshold: 2,
        windowSeconds: 10
      });
    });
  });
});
