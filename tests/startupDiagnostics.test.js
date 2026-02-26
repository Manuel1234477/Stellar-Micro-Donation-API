/**
 * Tests for Startup Diagnostics Module
 * Verifies startup logging, data sanitization, and configuration reporting
 */

const startupDiagnostics = require('../src/utils/startupDiagnostics');
const config = require('../src/config');
const log = require('../src/utils/log');

// Mock the log module to capture log calls
jest.mock('../src/utils/log', () => ({
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

// Mock the database module
jest.mock('../src/utils/database', () => ({
  get: jest.fn()
}));

describe('Startup Diagnostics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock config to avoid environment dependencies
    jest.doMock('../src/config', () => ({
      server: {
        env: 'test',
        isProduction: false,
        isDevelopment: true,
        isTest: true,
        port: 3001,
        apiPrefix: '/api/v1'
      },
      stellar: {
        network: 'testnet',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        mockEnabled: true
      },
      database: {
        type: 'sqlite',
        path: './test.db'
      },
      apiKeys: {
        legacy: ['test-key-1', 'test-key-2']
      },
      rateLimit: {
        maxRequests: 100,
        windowMs: 60000
      },
      donations: {
        minAmount: 0.01,
        maxAmount: 1000,
        maxDailyPerDonor: 100
      },
      logging: {
        debugMode: true,
        verbose: false,
        toFile: false
      },
      encryption: {
        key: 'test-key',
        requireInProduction: false
      },
      app: {
        name: 'stellar-micro-donation-api',
        version: '1.0.0-test'
      }
    }));
  });

  afterEach(() => {
    jest.resetModules();
  });

  describe('getEnvironmentInfo', () => {
    test('should return safe environment information', () => {
      const envInfo = startupDiagnostics.getEnvironmentInfo();
      
      expect(envInfo).toHaveProperty('mode');
      expect(envInfo).toHaveProperty('port');
      expect(envInfo).toHaveProperty('version');
      expect(envInfo).toHaveProperty('isProduction');
      expect(envInfo).toHaveProperty('isDevelopment');
      expect(envInfo).toHaveProperty('isTest');
      
      // Should not contain sensitive data
      expect(envInfo).not.toHaveProperty('apiKeys');
      expect(envInfo).not.toHaveProperty('secrets');
    });
  });

  describe('getFeaturesInfo', () => {
    test('should return enabled features information', () => {
      const features = startupDiagnostics.getFeaturesInfo();
      
      expect(features).toHaveProperty('mockStellar');
      expect(features).toHaveProperty('debugMode');
      expect(features).toHaveProperty('verboseLogging');
      expect(features).toHaveProperty('fileLogging');
      expect(features).toHaveProperty('rateLimiting');
      expect(features).toHaveProperty('encryption');
      
      expect(features.rateLimiting).toHaveProperty('enabled');
      expect(features.rateLimiting).toHaveProperty('maxRequests');
      expect(features.rateLimiting).toHaveProperty('windowMs');
    });
  });

  describe('getNetworkInfo', () => {
    test('should return sanitized network information', () => {
      const network = startupDiagnostics.getNetworkInfo();
      
      expect(network).toHaveProperty('stellar');
      expect(network).toHaveProperty('database');
      
      expect(network.stellar).toHaveProperty('network');
      expect(network.stellar).toHaveProperty('horizonUrl');
      expect(network.stellar).toHaveProperty('mode');
      
      expect(network.database).toHaveProperty('type');
      expect(network.database).toHaveProperty('path');
      
      // Should sanitize URLs and paths
      expect(network.stellar.horizonUrl).not.toContain('secret');
      expect(network.stellar.horizonUrl).not.toContain('token');
    });
  });

  describe('getServicesInfo', () => {
    test('should return services information', () => {
      const services = startupDiagnostics.getServicesInfo();
      
      expect(services).toHaveProperty('apiKeys');
      expect(services).toHaveProperty('donationLimits');
      
      expect(services.apiKeys).toHaveProperty('configured');
      expect(services.apiKeys).toHaveProperty('count');
      
      expect(services.donationLimits).toHaveProperty('minAmount');
      expect(services.donationLimits).toHaveProperty('maxAmount');
      expect(services.donationLimits).toHaveProperty('maxDailyPerDonor');
      
      // Count should be safe to log
      expect(typeof services.apiKeys.count).toBe('number');
    });
  });

  describe('getSystemHealth', () => {
    test('should return system health information', () => {
      const health = startupDiagnostics.getSystemHealth();
      
      expect(health).toHaveProperty('nodeVersion');
      expect(health).toHaveProperty('platform');
      expect(health).toHaveProperty('arch');
      expect(health).toHaveProperty('memory');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('database');
      
      expect(health.memory).toHaveProperty('used');
      expect(health.memory).toHaveProperty('total');
      
      expect(health.database).toHaveProperty('status');
      expect(health.database).toHaveProperty('type');
    });
  });

  describe('logStartupDiagnostics', () => {
    test('should log startup diagnostics successfully', async () => {
      const Database = require('../src/utils/database');
      Database.get.mockResolvedValue({ ok: 1 });

      await startupDiagnostics.logStartupDiagnostics();

      // Should log startup messages
      expect(log.info).toHaveBeenCalledWith(
        'STARTUP',
        '🚀 Stellar Micro Donation API starting',
        expect.any(Object)
      );

      // Should log either detailed or production configuration based on environment
      expect(log.info).toHaveBeenCalledWith(
        'STARTUP',
        expect.stringMatching(/📋 (Configuration summary|Production configuration)/),
        expect.any(Object)
      );

      expect(log.info).toHaveBeenCalledWith(
        'STARTUP',
        '✅ Database connection successful'
      );

      expect(log.info).toHaveBeenCalledWith(
        'STARTUP',
        '🎉 Startup complete',
        expect.any(Object)
      );
    });

    test('should log database failures during startup diagnostics', async () => {
      jest.resetModules();

      const mockInfo = jest.fn();
      const mockError = jest.fn();
      const mockDebug = jest.fn();

      jest.doMock('../src/utils/log', () => ({
        info: mockInfo,
        error: mockError,
        debug: mockDebug
      }));

      jest.doMock('../src/utils/database', () => ({
        get: jest.fn().mockRejectedValue(new Error('Database unavailable'))
      }));

      const isolatedStartupDiagnostics = require('../src/utils/startupDiagnostics');
      await isolatedStartupDiagnostics.logStartupDiagnostics();

      expect(mockError).toHaveBeenCalledWith(
        'STARTUP',
        expect.stringMatching(/Database connection failed/),
        expect.objectContaining({
          error: 'Database unavailable',
          type: expect.any(String)
        })
      );

      expect(mockInfo).toHaveBeenCalledWith(
        'STARTUP',
        '🎉 Startup complete',
        expect.any(Object)
      );
    });
  });

  describe('logShutdownDiagnostics', () => {
    test('should log shutdown diagnostics', () => {
      startupDiagnostics.logShutdownDiagnostics('SIGTERM');

      expect(log.info).toHaveBeenCalledWith(
        'SHUTDOWN',
        '🛑 Stellar Micro Donation API shutting down',
        expect.objectContaining({
          reason: 'SIGTERM',
          uptime: expect.any(String),
          timestamp: expect.any(String)
        })
      );
    });

    test('should use default reason if not provided', () => {
      startupDiagnostics.logShutdownDiagnostics();

      expect(log.info).toHaveBeenCalledWith(
        'SHUTDOWN',
        '🛑 Stellar Micro Donation API shutting down',
        expect.objectContaining({
          reason: 'SIGINT'
        })
      );
    });
  });

  describe('Data Sanitization', () => {
    test('should sanitize URLs with credentials', () => {
      // Create a fresh config mock for this test
      jest.doMock('../src/config', () => ({
        server: {
          env: 'test',
          isProduction: false,
          isDevelopment: true,
          isTest: true,
          port: 3001,
          apiPrefix: '/api/v1'
        },
        stellar: {
          network: 'testnet',
          horizonUrl: 'https://user:secret@horizon.stellar.org/path?token=abc123',
          mockEnabled: true
        },
        database: {
          type: 'sqlite',
          path: './test.db'
        },
        apiKeys: {
          legacy: ['test-key-1']
        },
        rateLimit: {
          maxRequests: 100,
          windowMs: 60000
        },
        donations: {
          minAmount: 0.01,
          maxAmount: 1000
        },
        logging: {
          debugMode: true,
          verbose: false,
          toFile: false
        },
        encryption: {
          key: 'test-key',
          requireInProduction: false
        },
        app: {
          name: 'stellar-micro-donation-api',
          version: '1.0.0-test'
        }
      }));

      // Re-import to get fresh config
      const freshStartupDiagnostics = require('../src/utils/startupDiagnostics');
      const network = freshStartupDiagnostics.getNetworkInfo();
      
      expect(network.stellar.horizonUrl).toBe('https://horizon.stellar.org/path');
      expect(network.stellar.horizonUrl).not.toContain('user:secret');
      expect(network.stellar.horizonUrl).not.toContain('token=abc123');
    });

    test('should sanitize file paths', () => {
      // Create a fresh config mock for this test
      jest.doMock('../src/config', () => ({
        server: {
          env: 'test',
          isProduction: false,
          isDevelopment: true,
          isTest: true,
          port: 3001,
          apiPrefix: '/api/v1'
        },
        stellar: {
          network: 'testnet',
          horizonUrl: 'https://horizon-testnet.stellar.org',
          mockEnabled: true
        },
        database: {
          type: 'sqlite',
          path: '/very/long/path/to/the/database/donations.db'
        },
        apiKeys: {
          legacy: ['test-key-1']
        },
        rateLimit: {
          maxRequests: 100,
          windowMs: 60000
        },
        donations: {
          minAmount: 0.01,
          maxAmount: 1000
        },
        logging: {
          debugMode: true,
          verbose: false,
          toFile: false
        },
        encryption: {
          key: 'test-key',
          requireInProduction: false
        },
        app: {
          name: 'stellar-micro-donation-api',
          version: '1.0.0-test'
        }
      }));

      // Re-import to get fresh config
      const freshStartupDiagnostics = require('../src/utils/startupDiagnostics');
      const network = freshStartupDiagnostics.getNetworkInfo();
      
      expect(network.database.path).toBe('.../database/donations.db');
      expect(network.database.path).not.toContain('/very/long/path/to/the');
    });
  });

  describe('Utility Functions', () => {
    test('should format bytes correctly', () => {
      const health = startupDiagnostics.getSystemHealth();
      const memoryUsed = health.memory.used;
      
      // Should format bytes with appropriate units
      expect(typeof memoryUsed).toBe('string');
      expect(memoryUsed).toMatch(/\d+(\.\d+)? (B|KB|MB|GB)/);
    });

    test('should format uptime correctly', () => {
      const health = startupDiagnostics.getSystemHealth();
      const uptime = health.uptime;
      
      // Should format uptime as hours and minutes or just minutes
      expect(typeof uptime).toBe('string');
      expect(uptime).toMatch(/\d+h \d+m|\d+m/);
    });
  });
});
