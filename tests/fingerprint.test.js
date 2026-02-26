/**
 * Unit tests for computeFingerprint function
 * Tests fingerprint generation, determinism, uniqueness, and edge cases
 */

const { computeFingerprint } = require('../src/utils/replayDetector');

describe('computeFingerprint', () => {
  describe('Basic Functionality', () => {
    test('should generate a 64-character hex string (SHA-256)', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John' }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should generate consistent fingerprints for identical requests', () => {
      const req1 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John', email: 'john@example.com' }
      };

      const req2 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John', email: 'john@example.com' }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    test('should generate different fingerprints for different methods', () => {
      const req1 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John' }
      };

      const req2 = {
        method: 'GET',
        path: '/api/users',
        body: { name: 'John' }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test('should generate different fingerprints for different paths', () => {
      const req1 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John' }
      };

      const req2 = {
        method: 'POST',
        path: '/api/accounts',
        body: { name: 'John' }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    test('should generate different fingerprints for different bodies', () => {
      const req1 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John' }
      };

      const req2 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'Jane' }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('Empty and Missing Body Handling', () => {
    test('should handle empty body object', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: {}
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle missing body (undefined)', () => {
      const req = {
        method: 'GET',
        path: '/api/users'
        // body is undefined
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle null body', () => {
      const req = {
        method: 'GET',
        path: '/api/users',
        body: null
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should generate same fingerprint for missing and empty string body', () => {
      const req1 = {
        method: 'GET',
        path: '/api/users'
        // body is undefined
      };

      const req2 = {
        method: 'GET',
        path: '/api/users',
        body: ''
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).toBe(fingerprint2);
    });

    test('should generate same fingerprint for null and empty string body', () => {
      const req1 = {
        method: 'GET',
        path: '/api/users',
        body: null
      };

      const req2 = {
        method: 'GET',
        path: '/api/users',
        body: ''
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('Edge Cases', () => {
    test('should handle special characters in path', () => {
      const req = {
        method: 'GET',
        path: '/api/users?query=test&filter=active',
        body: {}
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle unicode characters in body', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: { name: '日本語', emoji: '🎉' }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle nested objects in body', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: {
          user: {
            name: 'John',
            address: {
              street: '123 Main St',
              city: 'Boston'
            }
          }
        }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle arrays in body', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: {
          tags: ['admin', 'user', 'moderator'],
          scores: [1, 2, 3, 4, 5]
        }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle large body (>1KB)', () => {
      const largeBody = {
        data: 'x'.repeat(2000),
        items: Array(100).fill({ id: 1, name: 'test' })
      };

      const req = {
        method: 'POST',
        path: '/api/bulk',
        body: largeBody
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle body with boolean values', () => {
      const req = {
        method: 'POST',
        path: '/api/settings',
        body: { enabled: true, verified: false }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should handle body with numeric values', () => {
      const req = {
        method: 'POST',
        path: '/api/transactions',
        body: { amount: 100.50, count: 42, id: 0 }
      };

      const fingerprint = computeFingerprint(req);

      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    test('should differentiate between string and number in body', () => {
      const req1 = {
        method: 'POST',
        path: '/api/data',
        body: { value: '123' }
      };

      const req2 = {
        method: 'POST',
        path: '/api/data',
        body: { value: 123 }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      expect(fingerprint1).not.toBe(fingerprint2);
    });
  });

  describe('Determinism', () => {
    test('should generate same fingerprint when called multiple times', () => {
      const req = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John', email: 'john@example.com' }
      };

      const fingerprints = [];
      for (let i = 0; i < 10; i++) {
        fingerprints.push(computeFingerprint(req));
      }

      // All fingerprints should be identical
      const uniqueFingerprints = new Set(fingerprints);
      expect(uniqueFingerprints.size).toBe(1);
    });

    test('should generate same fingerprint regardless of object property order in body', () => {
      // Note: JSON.stringify with sorted keys should handle this
      const req1 = {
        method: 'POST',
        path: '/api/users',
        body: { name: 'John', email: 'john@example.com' }
      };

      const req2 = {
        method: 'POST',
        path: '/api/users',
        body: { email: 'john@example.com', name: 'John' }
      };

      const fingerprint1 = computeFingerprint(req1);
      const fingerprint2 = computeFingerprint(req2);

      // This test documents current behavior - may need adjustment
      // if we want property order independence
      expect(fingerprint1).toBe(fingerprint2);
    });
  });
});
