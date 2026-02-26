/**
 * Integration tests for logger with sensitive data masking
 * Ensures logs don't contain secrets in real-world scenarios
 */

const { Logger } = require('../src/middleware/logger');
const log = require('../src/utils/log');

describe('Logger Middleware - Sensitive Data Masking', () => {
  let logger;
  let consoleLogSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    logger = new Logger({ logToFile: false });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Request sanitization', () => {
    it('should mask API keys in headers', () => {
      const request = {
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'secret-api-key-12345',
          'authorization': 'Bearer token123',
        },
        body: { amount: '100' },
      };

      const sanitized = logger.sanitize(request);

      expect(sanitized.headers['content-type']).toBe('application/json');
      expect(sanitized.headers['x-api-key']).toBe('[REDACTED]');
      expect(sanitized.headers.authorization).toBe('[REDACTED]');
      expect(sanitized.body.amount).toBe('100');
    });

    it('should mask secret keys in request body', () => {
      const request = {
        body: {
          amount: '100',
          destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
          senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        },
      };

      const sanitized = logger.sanitize(request);

      expect(sanitized.body.amount).toBe('100');
      expect(sanitized.body.destination).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(sanitized.body.senderSecret).toBe('[REDACTED]');
    });

    it('should mask passwords in nested objects', () => {
      const request = {
        body: {
          user: {
            username: 'john',
            password: 'secret123',
            profile: {
              email: 'john@example.com',
              apiKey: 'key123',
            },
          },
        },
      };

      const sanitized = logger.sanitize(request);

      expect(sanitized.body.user.username).toBe('john');
      expect(sanitized.body.user.password).toBe('[REDACTED]');
      expect(sanitized.body.user.profile.email).toBe('john@example.com');
      expect(sanitized.body.user.profile.apiKey).toBe('[REDACTED]');
    });

    it('should mask sensitive data in query parameters', () => {
      const request = {
        query: {
          page: '1',
          apiKey: 'secret-key',
          token: 'auth-token-123',
        },
      };

      const sanitized = logger.sanitize(request);

      expect(sanitized.query.page).toBe('1');
      expect(sanitized.query.apiKey).toBe('[REDACTED]');
      expect(sanitized.query.token).toBe('[REDACTED]');
    });
  });

  describe('Response sanitization', () => {
    it('should mask secret keys in response', () => {
      const response = {
        success: true,
        wallet: {
          publicKey: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
          secret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        },
      };

      const sanitized = logger.sanitize(response);

      expect(sanitized.success).toBe(true);
      expect(sanitized.wallet.publicKey).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(sanitized.wallet.secret).toBe('[REDACTED]');
    });

    it('should not mask non-sensitive response data', () => {
      const response = {
        success: true,
        transaction: {
          hash: 'abc123',
          amount: '100',
          destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        },
      };

      const sanitized = logger.sanitize(response);

      expect(sanitized.success).toBe(true);
      expect(sanitized.transaction.hash).toBe('abc123');
      expect(sanitized.transaction.amount).toBe('100');
      expect(sanitized.transaction.destination).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
    });
  });

  describe('Log utility masking', () => {
    it('should mask sensitive data in log.info', () => {
      log.info('TEST', 'User login', {
        username: 'john',
        password: 'secret123',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).toContain('john');
      expect(logOutput).not.toContain('secret123');
      expect(logOutput).toContain('[REDACTED]');
    });

    it('should mask sensitive data in log.error', () => {
      log.error('TEST', 'Authentication failed', {
        apiKey: 'secret-key-123',
        error: 'Invalid credentials',
      });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logOutput = consoleErrorSpy.mock.calls[0][0];
      expect(logOutput).not.toContain('secret-key-123');
      expect(logOutput).toContain('[REDACTED]');
      expect(logOutput).toContain('Invalid credentials');
    });

    it('should mask Stellar secret keys in values', () => {
      const stellarSecret = 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ';
      
      log.info('TEST', 'Transaction', {
        source: stellarSecret,
        amount: '100',
      });

      expect(consoleLogSpy).toHaveBeenCalled();
      const logOutput = consoleLogSpy.mock.calls[0][0];
      expect(logOutput).not.toContain(stellarSecret);
      expect(logOutput).toContain('[REDACTED]');
      expect(logOutput).toContain('100');
    });

    it('should handle error objects with sensitive data', () => {
      const error = new Error('Transaction failed');
      error.details = {
        senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        amount: '100',
      };

      log.error('TEST', 'Error occurred', { error });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logOutput = consoleErrorSpy.mock.calls[0][0];
      expect(logOutput).not.toContain('SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(logOutput).toContain('[REDACTED]');
    });
  });

  describe('Array handling', () => {
    it('should mask sensitive data in arrays', () => {
      const data = {
        transactions: [
          { id: 1, secret: 'secret1' },
          { id: 2, secret: 'secret2' },
        ],
      };

      const sanitized = logger.sanitize(data);

      expect(sanitized.transactions[0].id).toBe(1);
      expect(sanitized.transactions[0].secret).toBe('[REDACTED]');
      expect(sanitized.transactions[1].id).toBe(2);
      expect(sanitized.transactions[1].secret).toBe('[REDACTED]');
    });
  });

  describe('Edge cases', () => {
    it('should handle null values', () => {
      const sanitized = logger.sanitize(null);
      expect(sanitized).toBe(null);
    });

    it('should handle undefined values', () => {
      const sanitized = logger.sanitize(undefined);
      expect(sanitized).toBe(undefined);
    });

    it('should handle empty objects', () => {
      const sanitized = logger.sanitize({});
      expect(sanitized).toEqual({});
    });

    it('should handle primitives', () => {
      expect(logger.sanitize('string')).toBe('string');
      expect(logger.sanitize(123)).toBe(123);
      expect(logger.sanitize(true)).toBe(true);
    });
  });

  describe('Debug usefulness', () => {
    it('should preserve non-sensitive data for debugging', () => {
      const request = {
        method: 'POST',
        url: '/api/donate',
        body: {
          amount: '100.50',
          destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
          memo: 'Donation for charity',
          senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        },
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Test Client',
        },
      };

      const sanitized = logger.sanitize(request);

      // Verify useful debugging info is preserved
      expect(sanitized.method).toBe('POST');
      expect(sanitized.url).toBe('/api/donate');
      expect(sanitized.body.amount).toBe('100.50');
      expect(sanitized.body.destination).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(sanitized.body.memo).toBe('Donation for charity');
      expect(sanitized.headers['content-type']).toBe('application/json');
      expect(sanitized.headers['user-agent']).toBe('Test Client');

      // Verify sensitive data is masked
      expect(sanitized.body.senderSecret).toBe('[REDACTED]');
    });
  });
});
