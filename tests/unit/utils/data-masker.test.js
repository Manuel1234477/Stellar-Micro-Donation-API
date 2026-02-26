/**
 * Tests for Data Masking Utility
 * Ensures sensitive data is properly masked in logs
 */

const {
  maskSensitiveData,
  maskError,
  maskValue,
  isSensitiveKey,
  isSensitiveValue,
  addSensitivePatterns,
} = require('../../../src/utils/dataMasker');

describe('Data Masker', () => {
  describe('isSensitiveKey', () => {
    it('should identify common sensitive keys', () => {
      expect(isSensitiveKey('password')).toBe(true);
      expect(isSensitiveKey('apiKey')).toBe(true);
      expect(isSensitiveKey('api_key')).toBe(true);
      expect(isSensitiveKey('api-key')).toBe(true);
      expect(isSensitiveKey('secretKey')).toBe(true);
      expect(isSensitiveKey('privateKey')).toBe(true);
      expect(isSensitiveKey('token')).toBe(true);
      expect(isSensitiveKey('authorization')).toBe(true);
    });

    it('should identify Stellar-specific sensitive keys', () => {
      expect(isSensitiveKey('senderSecret')).toBe(true);
      expect(isSensitiveKey('sender_secret')).toBe(true);
      expect(isSensitiveKey('sourceSecret')).toBe(true);
      expect(isSensitiveKey('seed')).toBe(true);
      expect(isSensitiveKey('mnemonic')).toBe(true);
    });

    it('should not flag non-sensitive keys', () => {
      expect(isSensitiveKey('username')).toBe(false);
      expect(isSensitiveKey('email')).toBe(false);
      expect(isSensitiveKey('amount')).toBe(false);
      expect(isSensitiveKey('publicKey')).toBe(false);
      expect(isSensitiveKey('destination')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isSensitiveKey('PASSWORD')).toBe(true);
      expect(isSensitiveKey('ApiKey')).toBe(true);
      expect(isSensitiveKey('SECRET_KEY')).toBe(true);
    });
  });

  describe('isSensitiveValue', () => {
    it('should identify Stellar secret keys', () => {
      const stellarSecret = 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ';
      expect(isSensitiveValue(stellarSecret)).toBe(true);
    });

    it('should identify JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      expect(isSensitiveValue(jwt)).toBe(true);
    });

    it('should not flag normal strings', () => {
      expect(isSensitiveValue('hello world')).toBe(false);
      expect(isSensitiveValue('user@example.com')).toBe(false);
      expect(isSensitiveValue('12345')).toBe(false);
    });
  });

  describe('maskValue', () => {
    it('should mask values completely by default', () => {
      expect(maskValue('secret123')).toBe('[REDACTED]');
      expect(maskValue('my-api-key-12345678')).toBe('[REDACTED]');
    });

    it('should show partial values when configured', () => {
      const result = maskValue('secret123456', { showFirst: 3, showLast: 3 });
      expect(result).toMatch(/^sec\*+456$/);
    });

    it('should handle null and undefined', () => {
      expect(maskValue(null)).toBe('[REDACTED]');
      expect(maskValue(undefined)).toBe('[REDACTED]');
    });
  });

  describe('maskSensitiveData', () => {
    it('should mask sensitive fields in objects', () => {
      const data = {
        username: 'john',
        password: 'secret123',
        apiKey: 'abc123xyz',
        amount: '100',
      };

      const masked = maskSensitiveData(data);

      expect(masked.username).toBe('john');
      expect(masked.password).toBe('[REDACTED]');
      expect(masked.apiKey).toBe('[REDACTED]');
      expect(masked.amount).toBe('100');
    });

    it('should mask nested objects', () => {
      const data = {
        user: {
          name: 'john',
          credentials: {
            password: 'secret123',
            token: 'abc123',
          },
        },
        publicInfo: 'visible',
      };

      const masked = maskSensitiveData(data);

      expect(masked.user.name).toBe('john');
      expect(masked.user.credentials.password).toBe('[REDACTED]');
      expect(masked.user.credentials.token).toBe('[REDACTED]');
      expect(masked.publicInfo).toBe('visible');
    });

    it('should mask arrays', () => {
      const data = {
        users: [
          { name: 'john', password: 'secret1' },
          { name: 'jane', password: 'secret2' },
        ],
      };

      const masked = maskSensitiveData(data);

      expect(masked.users[0].name).toBe('john');
      expect(masked.users[0].password).toBe('[REDACTED]');
      expect(masked.users[1].name).toBe('jane');
      expect(masked.users[1].password).toBe('[REDACTED]');
    });

    it('should mask Stellar secret keys in values', () => {
      const data = {
        publicKey: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        secretKey: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
      };

      const masked = maskSensitiveData(data);

      expect(masked.publicKey).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(masked.secretKey).toBe('[REDACTED]');
    });

    it('should handle request objects with headers', () => {
      const request = {
        method: 'POST',
        url: '/api/donate',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer abc123token',
          'x-api-key': 'secret-key-123',
        },
        body: {
          amount: '100',
          senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        },
      };

      const masked = maskSensitiveData(request);

      expect(masked.method).toBe('POST');
      expect(masked.url).toBe('/api/donate');
      expect(masked.headers['content-type']).toBe('application/json');
      expect(masked.headers.authorization).toBe('[REDACTED]');
      expect(masked.headers['x-api-key']).toBe('[REDACTED]');
      expect(masked.body.amount).toBe('100');
      expect(masked.body.senderSecret).toBe('[REDACTED]');
    });

    it('should prevent infinite recursion', () => {
      const circular = { name: 'test' };
      circular.self = circular;

      // Should not throw, should handle gracefully
      expect(() => maskSensitiveData(circular)).not.toThrow();
    });

    it('should handle primitives', () => {
      expect(maskSensitiveData('string')).toBe('string');
      expect(maskSensitiveData(123)).toBe(123);
      expect(maskSensitiveData(true)).toBe(true);
      expect(maskSensitiveData(null)).toBe(null);
      expect(maskSensitiveData(undefined)).toBe(undefined);
    });

    it('should show partial values when configured', () => {
      const data = {
        apiKey: 'abc123xyz789',
      };

      const masked = maskSensitiveData(data, { showPartial: true });

      expect(masked.apiKey).toMatch(/^abc1\*+x789$/);
    });
  });

  describe('maskError', () => {
    it('should mask error objects', () => {
      const error = new Error('Authentication failed');
      error.code = 'AUTH_ERROR';
      error.details = {
        password: 'secret123',
        username: 'john',
      };

      const masked = maskError(error);

      expect(masked.name).toBe('Error');
      expect(masked.message).toBe('Authentication failed');
      expect(masked.code).toBe('AUTH_ERROR');
      expect(masked.details.password).toBe('[REDACTED]');
      expect(masked.details.username).toBe('john');
    });

    it('should mask sensitive data in stack traces', () => {
      const error = new Error('Failed');
      // Simulate a stack trace with a secret
      error.stack = `Error: Failed
    at sendDonation (secret: SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ)
    at processRequest`;

      const masked = maskError(error);

      expect(masked.stack).not.toContain('SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(masked.stack).toContain('[REDACTED]');
    });
  });

  describe('addSensitivePatterns', () => {
    it('should allow adding custom patterns', () => {
      addSensitivePatterns(['customSecret', 'internalKey']);

      expect(isSensitiveKey('customSecret')).toBe(true);
      expect(isSensitiveKey('internalKey')).toBe(true);
    });
  });

  describe('Real-world scenarios', () => {
    it('should mask donation request with secret key', () => {
      const donationRequest = {
        amount: '100.50',
        destination: 'GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        senderSecret: 'SBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ',
        memo: 'Donation for charity',
      };

      const masked = maskSensitiveData(donationRequest);

      expect(masked.amount).toBe('100.50');
      expect(masked.destination).toBe('GBZVMB3SEPB2ENHQVEQ5MJQXB2QZUQPQQ6QQZQPQQ6QQZQPQQ6QQZQPQ');
      expect(masked.senderSecret).toBe('[REDACTED]');
      expect(masked.memo).toBe('Donation for charity');
    });

    it('should mask API authentication headers', () => {
      const headers = {
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
        'x-api-key': 'sk_live_abc123xyz789',
        'authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
      };

      const masked = maskSensitiveData(headers);

      expect(masked['user-agent']).toBe('Mozilla/5.0');
      expect(masked['content-type']).toBe('application/json');
      expect(masked['x-api-key']).toBe('[REDACTED]');
      expect(masked.authorization).toBe('[REDACTED]');
    });

    it('should mask environment variables', () => {
      const env = {
        NODE_ENV: 'production',
        PORT: '3000',
        API_KEYS: 'key1,key2,key3',
        ENCRYPTION_KEY: 'super-secret-key-12345',
        DATABASE_URL: 'postgresql://user:password@localhost:5432/db',
      };

      const masked = maskSensitiveData(env);

      expect(masked.NODE_ENV).toBe('production');
      expect(masked.PORT).toBe('3000');
      expect(masked.API_KEYS).toBe('[REDACTED]');
      expect(masked.ENCRYPTION_KEY).toBe('[REDACTED]');
      // DATABASE_URL contains 'password' in the string
      expect(masked.DATABASE_URL).toBe('[REDACTED]');
    });
  });
});
