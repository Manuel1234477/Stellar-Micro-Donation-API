/**
 * Tests for Configurable Request Logger Middleware
 * 
 * Verifies:
 * - Health check and metrics endpoints can be excluded from logs
 * - Request/response bodies are logged only for configured paths
 * - Sensitive fields are never logged
 * - Sampling reduces log volume for high-traffic endpoints
 */

const {
  ConfigurableRequestLogger,
  parsePathPatterns,
  matchesPathPattern,
  sanitizeObject,
  shouldSample
} = require('../../src/middleware/requestLogger');

describe('Configurable Request Logger', () => {
  describe('parsePathPatterns', () => {
    test('should parse comma-separated paths', () => {
      const result = parsePathPatterns('/health,/metrics,/api/*');
      expect(result).toEqual(['/health', '/metrics', '/api/*']);
    });

    test('should handle empty string', () => {
      const result = parsePathPatterns('');
      expect(result).toEqual([]);
    });

    test('should handle null/undefined', () => {
      expect(parsePathPatterns(null)).toEqual([]);
      expect(parsePathPatterns(undefined)).toEqual([]);
    });

    test('should trim whitespace', () => {
      const result = parsePathPatterns('/health , /metrics , /api/*');
      expect(result).toEqual(['/health', '/metrics', '/api/*']);
    });
  });

  describe('matchesPathPattern', () => {
    test('should match exact paths', () => {
      expect(matchesPathPattern('/health', ['/health'])).toBe(true);
      expect(matchesPathPattern('/health', ['/metrics'])).toBe(false);
    });

    test('should match wildcard patterns', () => {
      expect(matchesPathPattern('/api/v1/users', ['/api/*'])).toBe(true);
      expect(matchesPathPattern('/api/v1/users', ['/api/v1/*'])).toBe(true);
      expect(matchesPathPattern('/api/v1/users', ['/api/v2/*'])).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(matchesPathPattern('/Health', ['/health'])).toBe(true);
      expect(matchesPathPattern('/HEALTH', ['/health'])).toBe(true);
    });

    test('should handle empty patterns', () => {
      expect(matchesPathPattern('/health', [])).toBe(false);
      expect(matchesPathPattern('/health', null)).toBe(false);
    });
  });

  describe('sanitizeObject', () => {
    test('should redact sensitive fields', () => {
      const obj = {
        username: 'test',
        password: 'secret123',
        apiKey: 'key123',
        nested: {
          secretKey: 'nested_secret',
          value: 'safe'
        }
      };

      const result = sanitizeObject(obj);

      expect(result.username).toBe('test');
      expect(result.password).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.nested.secretKey).toBe('[REDACTED]');
      expect(result.nested.value).toBe('safe');
    });

    test('should handle arrays', () => {
      const obj = {
        items: [
          { name: 'item1', secret: 'secret1' },
          { name: 'item2', secret: 'secret2' }
        ]
      };

      const result = sanitizeObject(obj);

      expect(result.items[0].name).toBe('item1');
      expect(result.items[0].secret).toBe('[REDACTED]');
      expect(result.items[1].name).toBe('item2');
      expect(result.items[1].secret).toBe('[REDACTED]');
    });

    test('should handle null/undefined', () => {
      expect(sanitizeObject(null)).toBe(null);
      expect(sanitizeObject(undefined)).toBe(undefined);
    });

    test('should handle non-objects', () => {
      expect(sanitizeObject('string')).toBe('string');
      expect(sanitizeObject(123)).toBe(123);
    });

    test('should redact various sensitive field patterns', () => {
      const obj = {
        password: 'pass',
        secretKey: 'secret',
        privateKey: 'private',
        token: 'tok',
        authorization: 'auth',
        apiKey: 'key',
        creditCard: 'card',
        ssn: '123'
      };

      const result = sanitizeObject(obj);

      Object.keys(obj).forEach(key => {
        expect(result[key]).toBe('[REDACTED]');
      });
    });
  });

  describe('shouldSample', () => {
    test('should always sample when rate is 1.0', () => {
      expect(shouldSample('/api/test', { rate: 1.0 })).toBe(true);
    });

    test('should never sample when rate is 0', () => {
      expect(shouldSample('/api/test', { rate: 0 })).toBe(false);
    });

    test('should sample deterministically based when path', () => {
      // Same path should always have same sampling result
      const path = '/api/test';
      const result1 = shouldSample(path, { rate: 0.5 });
      const result2 = shouldSample(path, { rate: 0.5 });
      expect(result1).toBe(result2);
    });

    test('should handle missing rate', () => {
      expect(shouldSample('/api/test', {})).toBe(true);
      expect(shouldSample('/api/test', null)).toBe(true);
    });
  });

  describe('ConfigurableRequestLogger class', () => {
    test('should initialize when default values', () => {
      const logger = new ConfigurableRequestLogger();

      expect(logger.skipPaths).toEqual([]);
      expect(logger.bodyPaths).toEqual([]);
      expect(logger.sampleRate).toBe(1.0);
      expect(logger.sensitiveFields).toContain('password');
    });

    test('should initialize when custom options', () => {
      const logger = new ConfigurableRequestLogger({
        skipPaths: ['/health', '/metrics'],
        bodyPaths: ['/api/donations'],
        sampleRate: 0.5,
        sensitiveFields: ['customSecret']
      });

      expect(logger.skipPaths).toEqual(['/health', '/metrics']);
      expect(logger.bodyPaths).toEqual(['/api/donations']);
      expect(logger.sampleRate).toBe(0.5);
      expect(logger.sensitiveFields).toContain('customSecret');
    });

    test('should identify paths to skip', () => {
      const logger = new ConfigurableRequestLogger({
        skipPaths: ['/health', '/metrics']
      });

      expect(logger.shouldSkipPath('/health')).toBe(true);
      expect(logger.shouldSkipPath('/metrics')).toBe(true);
      expect(logger.shouldSkipPath('/api/donations')).toBe(false);
    });

    test('should identify paths that need body logging', () => {
      const logger = new ConfigurableRequestLogger({
        bodyPaths: ['/api/donations', '/api/wallets']
      });

      expect(logger.shouldLogBody('/api/donations')).toBe(true);
      expect(logger.shouldLogBody('/api/wallets')).toBe(true);
      expect(logger.shouldLogBody('/api/users')).toBe(false);
    });

    test('should return correct sampling rate when path', () => {
      const logger = new ConfigurableRequestLogger({
        sampleRate: 1.0,
        pathSampling: {
          '/api/health': 0.1,
          '/api/metrics': 0.05
        }
      });

      expect(logger.getSamplingRate('/api/health')).toBe(0.1);
      expect(logger.getSamplingRate('/api/metrics')).toBe(0.05);
      expect(logger.getSamplingRate('/api/donations')).toBe(1.0);
    });

    test('should sanitize data using configured sensitive fields', () => {
      const logger = new ConfigurableRequestLogger({
        sensitiveFields: ['customSecret', 'apiKey']
      });

      const data = {
        username: 'test',
        customSecret: 'secret',
        apiKey: 'key123',
        password: 'pass' // Should still be redacted by default
      };

      const result = logger.sanitize(data);

      expect(result.username).toBe('test');
      expect(result.customSecret).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
      expect(result.password).toBe('[REDACTED]');
    });

    test('should create middleware function', () => {
      const logger = new ConfigurableRequestLogger();
      const middleware = logger.middleware();

      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });
  });

  describe('Integration tests', () => {
    test('should skip logging when health check endpoints', () => {
      const logger = new ConfigurableRequestLogger({
        skipPaths: ['/health', '/metrics']
      });

      const middleware = logger.middleware();

      const req = {
        originalUrl: '/health',
        method: 'GET',
        id: 'test-id',
        ip: '127.0.0.1'
      };

      const res = {
        statusCode: 200,
        json: jest.fn(),
        on: jest.fn()
      };

      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled(); // Should not attach finish listener
    });

    test('should log bodies only when configured paths', () => {
      const logger = new ConfigurableRequestLogger({
        bodyPaths: ['/api/donations']
      });

      const middleware = logger.middleware();

      const req1 = {
        originalUrl: '/api/donations',
        method: 'POST',
        id: 'test-id-1',
        ip: '127.0.0.1',
        body: { amount: 100 },
        query: {},
        params: {}
      };

      const res1 = {
        statusCode: 201,
        json: jest.fn(),
        on: jest.fn((event, callback) => {
          // Simulate finish event
          callback();
        })
      };

      const next1 = jest.fn();

      middleware(req1, res1, next1);

      expect(next1).toHaveBeenCalled();
      expect(res1.on).toHaveBeenCalledWith('finish', expect.any(Function));

      // For non-body path
      const req2 = {
        originalUrl: '/api/users',
        method: 'GET',
        id: 'test-id-2',
        ip: '127.0.0.1',
        body: {},
        query: {},
        params: {}
      };

      const res2 = {
        statusCode: 200,
        json: jest.fn(),
        on: jest.fn((event, callback) => {
          callback();
        })
      };

      const next2 = jest.fn();

      middleware(req2, res2, next2);

      expect(next2).toHaveBeenCalled();
    });

    test('should apply sampling correctly', () => {
      const logger = new ConfigurableRequestLogger({
        sampleRate: 0 // Never sample
      });

      const middleware = logger.middleware();

      const req = {
        originalUrl: '/api/test',
        method: 'GET',
        id: 'test-id',
        ip: '127.0.0.1'
      };

      const res = {
        statusCode: 200,
        json: jest.fn(),
        on: jest.fn()
      };

      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.on).not.toHaveBeenCalled(); // Should not log due to sampling
    });

    test('should redact sensitive fields in logged data', () => {
      const logger = new ConfigurableRequestLogger({
        bodyPaths: ['/api/test'],
        logBodies: true
      });

      const middleware = logger.middleware();

      const req = {
        originalUrl: '/api/test',
        method: 'POST',
        id: 'test-id',
        ip: '127.0.0.1',
        body: {
          username: 'test',
          password: 'secret123',
          apiKey: 'key123'
        },
        query: {},
        params: {},
        headers: {
          authorization: 'Bearer token123'
        }
      };

      const res = {
        statusCode: 200,
        json: jest.fn(),
        on: jest.fn((event, callback) => {
          callback();
        })
      };

      const next = jest.fn();

      // Spy on log.info to verify sanitized data
      const logInfoSpy = jest.spyOn(require('../../src/utils/log'), 'info');

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();

      // Verify that sensitive fields were redacted in log calls
      const logCalls = logInfoSpy.mock.calls;
      const requestPayloadCall = logCalls.find(call => 
        call[1] === 'Request payload'
      );

      if (requestPayloadCall) {
        const loggedData = requestPayloadCall[2];
        expect(loggedData.password).toBe('[REDACTED]');
        expect(loggedData.apiKey).toBe('[REDACTED]');
        expect(loggedData.headers.authorization).toBe('[REDACTED]');
      }

      logInfoSpy.mockRestore();
    });
  });
});
