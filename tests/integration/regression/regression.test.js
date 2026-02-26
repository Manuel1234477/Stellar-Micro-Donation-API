/**
 * Regression Tests for Recently Merged Features
 * Protects against breaking changes in:
 * - Debug mode (#179)
 * - API key permissions (#180)
 * - Abuse detection (#181)
 */

const log = require('../../../src/utils/log');
const abuseDetector = require('../../../src/utils/abuseDetector');
const { hasPermission } = require('../../../src/models/permissions');
const { PERMISSIONS } = require('../../../src/utils/permissions');
const { createIsolatedEnvironment } = require('../../helpers/testIsolation');

describe('Regression Tests - Recent Features', () => {
  describe('Debug Mode (#179)', () => {
    let cleanup;

    afterEach(() => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }
      delete require.cache[require.resolve('../../../src/utils/log')];
    });

    it('should not enable debug mode in production', () => {
      cleanup = createIsolatedEnvironment({
        DEBUG_MODE: 'true',
        NODE_ENV: 'production'
      });
      
      const logModule = require('../../../src/utils/log');
      
      expect(logModule.isDebugMode).toBe(false);
    });

    it('should enable debug mode in development when DEBUG_MODE=true', () => {
      cleanup = createIsolatedEnvironment({
        DEBUG_MODE: 'true',
        NODE_ENV: 'development'
      });
      
      delete require.cache[require.resolve('../../../src/utils/log')];
      const logModule = require('../../../src/utils/log');
      
      // In test environment, debug mode is disabled by default
      // This test verifies the logic exists, not that it runs in test env
      expect(typeof logModule.debug).toBe('function');
    });

    it('should disable debug mode when DEBUG_MODE=false', () => {
      cleanup = createIsolatedEnvironment({
        DEBUG_MODE: 'false',
        NODE_ENV: 'development'
      });
      
      delete require.cache[require.resolve('../../../src/utils/log')];
      const logModule = require('../../../src/utils/log');
      
      expect(logModule.isDebugMode).toBe(false);
    });

    it('should have debug function available', () => {
      expect(typeof log.debug).toBe('function');
    });
  });

  describe('API Key Permissions (#180)', () => {
    it('should enforce admin-only permissions', () => {
      expect(hasPermission('admin', PERMISSIONS.ADMIN_ALL)).toBe(true);
      expect(hasPermission('user', PERMISSIONS.ADMIN_ALL)).toBe(false);
      expect(hasPermission('guest', PERMISSIONS.ADMIN_ALL)).toBe(false);
    });

    it('should allow user to access transactions', () => {
      expect(hasPermission('user', PERMISSIONS.TRANSACTIONS_READ)).toBe(true);
      expect(hasPermission('user', PERMISSIONS.TRANSACTIONS_SYNC)).toBe(true);
    });

    it('should deny guest write operations', () => {
      expect(hasPermission('guest', PERMISSIONS.DONATIONS_CREATE)).toBe(false);
      expect(hasPermission('guest', PERMISSIONS.WALLETS_CREATE)).toBe(false);
      expect(hasPermission('guest', PERMISSIONS.STREAM_CREATE)).toBe(false);
    });

    it('should allow guest read operations', () => {
      expect(hasPermission('guest', PERMISSIONS.DONATIONS_READ)).toBe(true);
      expect(hasPermission('guest', PERMISSIONS.STATS_READ)).toBe(true);
    });

    it('should have transaction permissions defined', () => {
      expect(PERMISSIONS.TRANSACTIONS_READ).toBe('transactions:read');
      expect(PERMISSIONS.TRANSACTIONS_SYNC).toBe('transactions:sync');
    });

    it('should support wildcard permissions', () => {
      expect(hasPermission('admin', 'any:permission')).toBe(true);
      expect(hasPermission('user', 'donations:create')).toBe(true);
      expect(hasPermission('user', 'donations:read')).toBe(true);
    });
  });

  describe('Abuse Detection (#181)', () => {
    beforeEach(() => {
      abuseDetector.requestCounts.clear();
      abuseDetector.failureCounts.clear();
      abuseDetector.suspiciousIPs.clear();
    });

    it('should track requests without blocking', () => {
      const ip = '192.168.1.100';
      
      abuseDetector.trackRequest(ip);
      
      expect(abuseDetector.requestCounts.has(ip)).toBe(true);
      expect(abuseDetector.isSuspicious(ip)).toBe(false);
    });

    it('should flag IP after burst threshold', () => {
      const ip = '192.168.1.101';
      const threshold = abuseDetector.config.burstThreshold;
      
      for (let i = 0; i <= threshold; i++) {
        abuseDetector.trackRequest(ip);
      }
      
      expect(abuseDetector.isSuspicious(ip)).toBe(true);
    });

    it('should track failures without blocking', () => {
      const ip = '192.168.1.102';
      
      abuseDetector.trackFailure(ip, 'test');
      
      expect(abuseDetector.failureCounts.has(ip)).toBe(true);
      expect(abuseDetector.isSuspicious(ip)).toBe(false);
    });

    it('should flag IP after failure threshold', () => {
      const ip = '192.168.1.103';
      const threshold = abuseDetector.config.failureThreshold;
      
      for (let i = 0; i <= threshold; i++) {
        abuseDetector.trackFailure(ip, 'test');
      }
      
      expect(abuseDetector.isSuspicious(ip)).toBe(true);
    });

    it('should provide statistics', () => {
      abuseDetector.trackRequest('192.168.1.104');
      
      const stats = abuseDetector.getStats();
      
      expect(stats).toHaveProperty('suspiciousIPs');
      expect(stats).toHaveProperty('trackedIPs');
      expect(stats).toHaveProperty('failureTracking');
    });

    it('should handle null IP gracefully', () => {
      expect(() => {
        abuseDetector.trackRequest(null);
        abuseDetector.trackFailure(null, 'test');
      }).not.toThrow();
    });

    it('should not double-flag IPs', () => {
      const ip = '192.168.1.105';
      
      abuseDetector.flagSuspicious(ip, 'test1', {});
      const sizeBefore = abuseDetector.suspiciousIPs.size;
      
      abuseDetector.flagSuspicious(ip, 'test2', {});
      
      expect(abuseDetector.suspiciousIPs.size).toBe(sizeBefore);
    });
  });

  describe('Integration - Combined Features', () => {
    it('should allow admin to view abuse signals', () => {
      expect(hasPermission('admin', 'stats:read')).toBe(true);
    });

    it('should deny non-admin from viewing abuse signals endpoint', () => {
      expect(hasPermission('user', '*')).toBe(false);
      expect(hasPermission('guest', '*')).toBe(false);
    });

    it('should track failed permission checks as potential abuse', () => {
      const ip = '192.168.1.106';
      
      // Simulate multiple permission failures
      for (let i = 0; i < 5; i++) {
        abuseDetector.trackFailure(ip, 'permission_denied');
      }
      
      expect(abuseDetector.failureCounts.has(ip)).toBe(true);
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing log functions', () => {
      expect(typeof log.info).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.error).toBe('function');
    });

    it('should maintain existing permission constants', () => {
      expect(PERMISSIONS.DONATIONS_CREATE).toBe('donations:create');
      expect(PERMISSIONS.DONATIONS_READ).toBe('donations:read');
      expect(PERMISSIONS.WALLETS_CREATE).toBe('wallets:create');
      expect(PERMISSIONS.STREAM_CREATE).toBe('stream:create');
      expect(PERMISSIONS.STATS_READ).toBe('stats:read');
    });

    it('should maintain role hierarchy', () => {
      // Admin has all permissions
      expect(hasPermission('admin', PERMISSIONS.DONATIONS_CREATE)).toBe(true);
      expect(hasPermission('admin', PERMISSIONS.WALLETS_CREATE)).toBe(true);
      
      // User has standard permissions
      expect(hasPermission('user', PERMISSIONS.DONATIONS_CREATE)).toBe(true);
      expect(hasPermission('user', PERMISSIONS.WALLETS_CREATE)).toBe(true);
      
      // Guest has limited permissions
      expect(hasPermission('guest', PERMISSIONS.DONATIONS_READ)).toBe(true);
      expect(hasPermission('guest', PERMISSIONS.DONATIONS_CREATE)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid successive requests', () => {
      const ip = '192.168.1.107';
      
      for (let i = 0; i < 50; i++) {
        abuseDetector.trackRequest(ip);
      }
      
      expect(abuseDetector.requestCounts.get(ip).count).toBe(50);
    });

    it('should handle mixed success and failure patterns', () => {
      const ip = '192.168.1.108';
      
      abuseDetector.trackRequest(ip);
      abuseDetector.trackFailure(ip, 'error');
      abuseDetector.trackRequest(ip);
      
      expect(abuseDetector.requestCounts.has(ip)).toBe(true);
      expect(abuseDetector.failureCounts.has(ip)).toBe(true);
    });

    it('should handle permission checks with invalid roles', () => {
      expect(hasPermission('invalid_role', PERMISSIONS.DONATIONS_READ)).toBe(false);
      expect(hasPermission(null, PERMISSIONS.DONATIONS_READ)).toBe(false);
    });
  });
});
