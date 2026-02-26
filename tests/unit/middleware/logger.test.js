const { Logger } = require('../../../src/middleware/logger');
const fs = require('fs');
const path = require('path');

describe('Logger Middleware - Unit Tests', () => {
  let logger;
  const testLogDir = path.join(__dirname, '../test-logs');

  beforeEach(() => {
    // Create a new logger instance for each test
    logger = new Logger({
      logToFile: false,
      logDir: testLogDir
    });
  });

  afterEach(() => {
    // Clean up test log directory
    if (fs.existsSync(testLogDir)) {
      const files = fs.readdirSync(testLogDir);
      files.forEach(file => {
        fs.unlinkSync(path.join(testLogDir, file));
      });
      fs.rmdirSync(testLogDir);
    }
  });

  describe('Data Sanitization', () => {
    test('should redact sensitive fields from data', () => {
      const data = {
        username: 'testuser',
        password: 'secret123',
        email: 'test@example.com',
        secretKey: 'SXXXXXXXXXXXXXXX',
        token: 'abc123token'
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.username).toBe('testuser');
      expect(sanitized.email).toBe('test@example.com');
      expect(sanitized.password).toBe('[REDACTED]');
      expect(sanitized.secretKey).toBe('[REDACTED]');
      expect(sanitized.token).toBe('[REDACTED]');
    });

    test('should handle nested objects', () => {
      const data = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret',
            apiKey: 'key123'
          }
        }
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.user.name).toBe('John');
      expect(sanitized.user.credentials.password).toBe('[REDACTED]');
      expect(sanitized.user.credentials.apiKey).toBe('[REDACTED]');
    });

    test('should handle arrays', () => {
      const data = {
        users: [
          { name: 'Alice', password: 'pass1' },
          { name: 'Bob', password: 'pass2' }
        ]
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.users[0].name).toBe('Alice');
      expect(sanitized.users[0].password).toBe('[REDACTED]');
      expect(sanitized.users[1].name).toBe('Bob');
      expect(sanitized.users[1].password).toBe('[REDACTED]');
    });

    test('should handle null and undefined', () => {
      expect(logger.sanitize(null)).toBeNull();
      expect(logger.sanitize(undefined)).toBeUndefined();
    });

    test('should handle primitive values', () => {
      expect(logger.sanitize('string')).toBe('string');
      expect(logger.sanitize(123)).toBe(123);
      expect(logger.sanitize(true)).toBe(true);
    });

    test('should redact authorization headers', () => {
      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer token123',
        'x-api-key': 'secret-key'
      };

      const sanitized = logger.sanitize(headers);

      expect(sanitized['content-type']).toBe('application/json');
      expect(sanitized['authorization']).toBe('[REDACTED]');
      expect(sanitized['x-api-key']).toBe('[REDACTED]');
    });

    test('should handle case-insensitive field matching', () => {
      const data = {
        Password: 'secret',
        SECRET_KEY: 'key123',
        ApiKey: 'api123'
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.Password).toBe('[REDACTED]');
      expect(sanitized.SECRET_KEY).toBe('[REDACTED]');
      expect(sanitized.ApiKey).toBe('[REDACTED]');
    });

    test('should redact credit card information', () => {
      const data = {
        amount: 100,
        creditCard: '4111111111111111',
        credit_card_cvv: '123'
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.amount).toBe(100);
      expect(sanitized.creditCard).toBe('[REDACTED]');
      expect(sanitized.credit_card_cvv).toBe('[REDACTED]');
    });

    test('should redact private keys', () => {
      const data = {
        publicKey: 'GXXXXXXXXXXXXXXX',
        privateKey: 'SXXXXXXXXXXXXXXX',
        private_key: 'key123'
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.publicKey).toBe('GXXXXXXXXXXXXXXX');
      expect(sanitized.privateKey).toBe('[REDACTED]');
      expect(sanitized.private_key).toBe('[REDACTED]');
    });
  });

  describe('Log Formatting', () => {
    test('should format log data as JSON string', () => {
      const logData = {
        timestamp: '2024-02-20T10:00:00.000Z',
        method: 'GET',
        endpoint: '/api/test'
      };

      const formatted = logger.formatLog(logData);

      expect(formatted).toContain('"timestamp"');
      expect(formatted).toContain('"method"');
      expect(formatted).toContain('"endpoint"');
      expect(JSON.parse(formatted)).toEqual(logData);
    });
  });

  describe('Log Directory Management', () => {
    test('should create log directory if it does not exist', () => {
      const fileLogger = new Logger({
        logToFile: true,
        logDir: testLogDir
      });

      expect(fs.existsSync(testLogDir)).toBe(true);
    });
  });

  describe('File Writing', () => {
    test('should write log to file when logToFile is enabled', (done) => {
      const fileLogger = new Logger({
        logToFile: true,
        logDir: testLogDir
      });

      const logData = {
        timestamp: new Date().toISOString(),
        method: 'GET',
        endpoint: '/test'
      };

      fileLogger.writeToFile(logData);

      // Wait for file write to complete
      setTimeout(() => {
        const date = new Date().toISOString().split('T')[0];
        const logFile = path.join(testLogDir, `api-${date}.log`);
        
        expect(fs.existsSync(logFile)).toBe(true);
        const content = fs.readFileSync(logFile, 'utf8');
        expect(content).toContain(logData.method);
        expect(content).toContain(logData.endpoint);
        done();
      }, 500);
    }, 15000); // Increase timeout to 15 seconds

    test('should not write to file when logToFile is disabled', () => {
      const consoleLogger = new Logger({
        logToFile: false,
        logDir: testLogDir
      });

      const logData = {
        timestamp: new Date().toISOString(),
        method: 'GET',
        endpoint: '/test'
      };

      consoleLogger.writeToFile(logData);

      expect(fs.existsSync(testLogDir)).toBe(false);
    });
  });

  describe('Middleware Function', () => {
    test('should return a middleware function with correct signature', () => {
      const middleware = logger.middleware();
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3); // req, res, next
    });

    test('should call next() to continue request processing', () => {
      const middleware = logger.middleware();
      const req = { method: 'GET', url: '/test', headers: {}, query: {}, body: {}, params: {} };
      const res = {
        json: jest.fn(),
        on: jest.fn(),
        statusCode: 200
      };
      const next = jest.fn();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    test('should intercept res.json to capture response body', () => {
      const middleware = logger.middleware();
      const req = { method: 'GET', url: '/test', headers: {}, query: {}, body: {}, params: {} };
      const originalJson = jest.fn();
      const res = {
        json: originalJson,
        on: jest.fn(),
        statusCode: 200
      };
      const next = jest.fn();

      middleware(req, res, next);

      const responseData = { success: true };
      res.json(responseData);

      expect(originalJson).toHaveBeenCalledWith(responseData);
    });

    test('should sanitize request data', () => {
      const middleware = logger.middleware();
      const req = {
        method: 'POST',
        url: '/test',
        headers: { authorization: 'Bearer token123' },
        query: {},
        body: { password: 'secret' },
        params: {}
      };
      const res = {
        json: jest.fn(),
        on: jest.fn((event, callback) => {
          if (event === 'finish') {
            callback();
          }
        }),
        statusCode: 200
      };
      const next = jest.fn();

      // Spy on logToConsole to verify sanitization
      const logSpy = jest.spyOn(logger, 'logToConsole');

      middleware(req, res, next);

      expect(logSpy).toHaveBeenCalled();
      const logData = logSpy.mock.calls[0][0];
      expect(logData.request.headers.authorization).toBe('[REDACTED]');
      expect(logData.request.body.password).toBe('[REDACTED]');
    });
  });

  describe('Console Logging', () => {
    test('should log basic request information to console', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      const logData = {
        timestamp: '2024-02-20T10:00:00.000Z',
        method: 'GET',
        endpoint: '/test',
        statusCode: 200,
        duration: 50,
        request: {},
        response: {}
      };

      logger.logToConsole(logData);

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('GET');
      expect(logOutput).toContain('/test');
      expect(logOutput).toContain('200');
      expect(logOutput).toContain('50ms');

      consoleSpy.mockRestore();
    });
  });
});
