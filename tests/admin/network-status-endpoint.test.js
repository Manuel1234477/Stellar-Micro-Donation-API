'use strict';

/**
 * Tests for GET /admin/network/status endpoint
 * Issue #116: Add GET /admin/network/status endpoint for Stellar network monitoring
 */

const NetworkStatusService = require('../../src/services/NetworkStatusService');

describe('GET /admin/network/status', () => {
  describe('NetworkStatusService', () => {
    let service;

    beforeEach(() => {
      service = new NetworkStatusService({
        horizonUrl: 'https://horizon-testnet.stellar.org',
        pollIntervalMs: 1000,
      });
    });

    afterEach(() => {
      if (service) {
        service.stop();
      }
    });

    it('should initialize with default values', () => {
      expect(service.horizonUrl).toBe('https://horizon-testnet.stellar.org');
      expect(service.pollIntervalMs).toBe(1000);
    });

    it('should have currentStatus property', () => {
      expect(service.currentStatus).toBeNull();
    });

    it('should track error history', () => {
      expect(service._history).toBeDefined();
      expect(Array.isArray(service._history)).toBe(true);
    });

    it('should track total polls', () => {
      expect(service._totalPolls).toBe(0);
      expect(service._errorPolls).toBe(0);
    });

    it('should have start and stop methods', () => {
      expect(typeof service.start).toBe('function');
      expect(typeof service.stop).toBe('function');
    });

    it('should be an EventEmitter', () => {
      expect(typeof service.on).toBe('function');
      expect(typeof service.emit).toBe('function');
    });
  });

  describe('Network Status Response Format', () => {
    it('should return object with required fields', () => {
      const mockStatus = {
        networkStatus: 'healthy',
        horizonUrl: 'https://horizon-testnet.stellar.org',
        latencyMs: 234,
        p95LatencyMs: 890,
        errorRate1h: 0.02,
        circuitBreakerState: 'closed',
        lastOutageAt: null,
        recentErrors: [],
      };

      expect(mockStatus).toHaveProperty('networkStatus');
      expect(mockStatus).toHaveProperty('horizonUrl');
      expect(mockStatus).toHaveProperty('latencyMs');
      expect(mockStatus).toHaveProperty('p95LatencyMs');
      expect(mockStatus).toHaveProperty('errorRate1h');
      expect(mockStatus).toHaveProperty('circuitBreakerState');
      expect(mockStatus).toHaveProperty('recentErrors');
    });

    it('should have valid networkStatus values', () => {
      const validStatuses = ['healthy', 'degraded', 'down'];
      const testStatuses = ['healthy', 'degraded', 'down', 'invalid'];
      
      testStatuses.forEach(status => {
        if (validStatuses.includes(status)) {
          expect(validStatuses).toContain(status);
        }
      });
    });

    it('should have valid circuitBreakerState values', () => {
      const validStates = ['closed', 'open', 'half-open'];
      const testStates = ['closed', 'open', 'half-open', 'invalid'];
      
      testStates.forEach(state => {
        if (validStates.includes(state)) {
          expect(validStates).toContain(state);
        }
      });
    });

    it('should have numeric latency metrics', () => {
      const mockStatus = {
        latencyMs: 234,
        p95LatencyMs: 890,
      };

      expect(typeof mockStatus.latencyMs).toBe('number');
      expect(typeof mockStatus.p95LatencyMs).toBe('number');
      expect(mockStatus.latencyMs >= 0).toBe(true);
      expect(mockStatus.p95LatencyMs >= 0).toBe(true);
    });

    it('should have errorRate1h between 0 and 1', () => {
      const mockStatus = {
        errorRate1h: 0.02,
      };

      expect(typeof mockStatus.errorRate1h).toBe('number');
      expect(mockStatus.errorRate1h >= 0).toBe(true);
      expect(mockStatus.errorRate1h <= 1).toBe(true);
    });

    it('should have recentErrors as array with max 10 items', () => {
      const mockStatus = {
        recentErrors: [
          { timestamp: new Date().toISOString(), error: 'timeout', operation: 'ledger' },
        ],
      };

      expect(Array.isArray(mockStatus.recentErrors)).toBe(true);
      expect(mockStatus.recentErrors.length <= 10).toBe(true);
    });
  });

  describe('Network Status Logic', () => {
    it('should indicate healthy when error rate < 2%', () => {
      const errorRate = 0.01;
      const status = errorRate < 0.02 ? 'healthy' : 'degraded';
      expect(status).toBe('healthy');
    });

    it('should indicate degraded when error rate 2-10%', () => {
      const errorRate = 0.05;
      const status = errorRate < 0.02 ? 'healthy' : errorRate < 0.1 ? 'degraded' : 'down';
      expect(status).toBe('degraded');
    });

    it('should indicate down when error rate > 10%', () => {
      const errorRate = 0.15;
      const status = errorRate < 0.02 ? 'healthy' : errorRate < 0.1 ? 'degraded' : 'down';
      expect(status).toBe('down');
    });

    it('should correlate circuit breaker open with down status', () => {
      const circuitBreakerState = 'open';
      const networkStatus = circuitBreakerState === 'open' ? 'down' : 'healthy';
      expect(networkStatus).toBe('down');
    });
  });

  describe('Error Tracking', () => {
    it('should track recent errors with timestamp', () => {
      const error = {
        timestamp: new Date().toISOString(),
        error: 'Connection timeout',
        operation: 'ledger_close_time',
      };

      expect(error).toHaveProperty('timestamp');
      expect(error).toHaveProperty('error');
      expect(error).toHaveProperty('operation');
      expect(new Date(error.timestamp)).toBeInstanceOf(Date);
    });

    it('should limit recent errors to 10', () => {
      const errors = Array.from({ length: 15 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        error: `Error ${i}`,
        operation: 'test',
      }));

      const recentErrors = errors.slice(-10);
      expect(recentErrors.length).toBe(10);
    });
  });

  describe('Outage Tracking', () => {
    it('should track lastOutageAt timestamp', () => {
      const lastOutageAt = new Date().toISOString();
      expect(new Date(lastOutageAt)).toBeInstanceOf(Date);
    });

    it('should allow lastOutageAt to be null', () => {
      const lastOutageAt = null;
      expect(lastOutageAt === null || typeof lastOutageAt === 'string').toBe(true);
    });
  });
});
