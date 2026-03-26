const abuseDetector = require('../src/utils/abuseDetector');

describe('Abuse Detection', () => {
  beforeEach(() => {
    // Clear state
    abuseDetector.requestCounts.clear();
    abuseDetector.failureCounts.clear();
    abuseDetector.suspiciousIPs.clear();
  });

  afterAll(() => {
    abuseDetector.stop();
  });

  describe('Request Burst Detection', () => {
    it('should track requests from an IP', () => {
      const ip = '192.168.1.1';
      
      abuseDetector.trackRequest(ip);
      
      expect(abuseDetector.requestCounts.has(ip)).toBe(true);
      expect(abuseDetector.requestCounts.get(ip).count).toBe(1);
    });

    it('should flag IP after burst threshold', () => {
      const ip = '192.168.1.2';
      const threshold = abuseDetector.config.burstThreshold;
      
      // Simulate burst
      for (let i = 0; i <= threshold; i++) {
        abuseDetector.trackRequest(ip);
      }
      
      expect(abuseDetector.isSuspicious(ip)).toBe(true);
    });

    it('should reset count after window expires', () => {
      const ip = '192.168.1.3';
      
      abuseDetector.trackRequest(ip);
      const data = abuseDetector.requestCounts.get(ip);
      
      // Simulate window expiration
      data.windowStart = Date.now() - abuseDetector.config.burstWindow - 1000;
      
      abuseDetector.trackRequest(ip);
      
      expect(abuseDetector.requestCounts.get(ip).count).toBe(1);
    });
  });

  describe('Failure Detection', () => {
    it('should track failures from an IP', () => {
      const ip = '192.168.1.4';
      
      abuseDetector.trackFailure(ip, 'auth_failed');
      
      expect(abuseDetector.failureCounts.has(ip)).toBe(true);
      expect(abuseDetector.failureCounts.get(ip).count).toBe(1);
    });

    it('should flag IP after repeated failures', () => {
      const ip = '192.168.1.5';
      const threshold = abuseDetector.config.failureThreshold;
      
      // Simulate repeated failures
      for (let i = 0; i <= threshold; i++) {
        abuseDetector.trackFailure(ip, 'auth_failed');
      }
      
      expect(abuseDetector.isSuspicious(ip)).toBe(true);
    });

    it('should not double-flag already suspicious IP', () => {
      const ip = '192.168.1.6';
      
      abuseDetector.flagSuspicious(ip, 'test', {});
      const sizeBefore = abuseDetector.suspiciousIPs.size;
      
      abuseDetector.flagSuspicious(ip, 'test2', {});
      
      expect(abuseDetector.suspiciousIPs.size).toBe(sizeBefore);
    });
  });

  describe('Statistics', () => {
    it('should return current stats', () => {
      abuseDetector.trackRequest('192.168.1.7');
      abuseDetector.trackFailure('192.168.1.8', 'test');
      abuseDetector.flagSuspicious('192.168.1.9', 'manual', {});
      
      const stats = abuseDetector.getStats();
      
      expect(stats).toHaveProperty('suspiciousIPs');
      expect(stats).toHaveProperty('trackedIPs');
      expect(stats).toHaveProperty('failureTracking');
      expect(stats.suspiciousIPs).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    it('should remove old entries', () => {
      const ip = '192.168.1.10';
      
      abuseDetector.trackRequest(ip);
      const data = abuseDetector.requestCounts.get(ip);
      
      // Simulate old entry
      data.windowStart = Date.now() - abuseDetector.config.burstWindow * 3;
      
      abuseDetector.cleanup();
      
      expect(abuseDetector.requestCounts.has(ip)).toBe(false);
    });

    it('should keep recent entries', () => {
      const ip = '192.168.1.11';
      
      abuseDetector.trackRequest(ip);
      abuseDetector.cleanup();
      
      expect(abuseDetector.requestCounts.has(ip)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null IP gracefully', () => {
      expect(() => {
        abuseDetector.trackRequest(null);
        abuseDetector.trackFailure(null, 'test');
      }).not.toThrow();
    });

    it('should handle undefined IP gracefully', () => {
      expect(() => {
        abuseDetector.trackRequest(undefined);
        abuseDetector.trackFailure(undefined, 'test');
      }).not.toThrow();
    });
  });
});
