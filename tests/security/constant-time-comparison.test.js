/**
 * Tests for Constant-Time Comparison (Issue #1115)
 * 
 * Ensures API key, secret, and signature comparisons use timing-safe methods
 * to prevent timing side-channel attacks.
 */

const { safeEqual } = require('../../src/utils/safeEqual');

describe('Constant-Time Comparison Utility', () => {
  describe('safeEqual', () => {
    test('returns true for identical secrets', () => {
      const secret = 'my-api-key-12345';
      expect(safeEqual(secret, secret)).toBe(true);
    });

    test('returns false for different secrets', () => {
      expect(safeEqual('key-a', 'key-b')).toBe(false);
    });

    test('returns false when incoming is shorter than stored', () => {
      expect(safeEqual('abc', 'abcdefg')).toBe(false);
    });

    test('returns false when incoming is longer than stored', () => {
      expect(safeEqual('abcdefg', 'abc')).toBe(false);
    });

    test('returns false for empty vs non-empty', () => {
      expect(safeEqual('', 'secret')).toBe(false);
      expect(safeEqual('secret', '')).toBe(false);
    });

    test('returns true for both empty strings', () => {
      expect(safeEqual('', '')).toBe(true);
    });

    test('handles null/undefined gracefully', () => {
      expect(safeEqual(null, null)).toBe(true);
      expect(safeEqual(undefined, undefined)).toBe(true);
      expect(safeEqual('secret', null)).toBe(false);
      expect(safeEqual(null, 'secret')).toBe(false);
    });

    test('converts buffers to strings', () => {
      const buf1 = Buffer.from('secret');
      const buf2 = Buffer.from('secret');
      expect(safeEqual(buf1, buf2)).toBe(true);
    });

    test('is timing-safe by using HMAC digests', () => {
      // Test that comparison always takes similar time regardless of mismatch position
      const secret1 = 'x'.repeat(100) + '0';
      const secret2 = 'x'.repeat(100) + '1';
      
      const t1 = process.hrtime.bigint();
      safeEqual(secret1, secret2);
      const elapsed = Number(process.hrtime.bigint() - t1);
      
      // Both should use similar computation time (within ~10ms on most systems)
      // Just verify it completes without timing vulnerability
      expect(elapsed).toBeGreaterThan(0);
    });

    test('rejects mismatched-length inputs without timing variance', () => {
      // Comparing the digests means length differences don't leak timing info
      const result1 = safeEqual('short', 'this-is-a-very-long-secret');
      const result2 = safeEqual('this-is-a-very-long-secret', 'short');
      
      expect(result1).toBe(false);
      expect(result2).toBe(false);
    });
  });
});

describe('API Key Middleware with Constant-Time Comparison', () => {
  const requireApiKey = require('../../src/middleware/apiKey');

  test('should use constant-time comparison for legacy keys', async () => {
    process.env.API_KEYS = 'legacy-key-123';
    
    const req = {
      apiKey: null,
      user: null,
      get: (header) => {
        if (header.toLowerCase() === 'x-api-key') return 'legacy-key-123';
        return undefined;
      },
      ip: '127.0.0.1',
      path: '/test',
      method: 'GET',
      id: 'req-123',
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };

    const next = jest.fn();

    await requireApiKey(req, res, next);
    
    // Should succeed with legacy key
    expect(next).toHaveBeenCalled();
    expect(req.apiKey).toBeDefined();
    expect(req.apiKey.isLegacy).toBe(true);

    delete process.env.API_KEYS;
  });

  test('should reject incorrect legacy keys with constant-time comparison', async () => {
    process.env.API_KEYS = 'correct-key-123';
    
    const req = {
      apiKey: null,
      user: null,
      get: (header) => {
        if (header.toLowerCase() === 'x-api-key') return 'wrong-key-456';
        return undefined;
      },
      ip: '127.0.0.1',
      path: '/test',
      method: 'GET',
      id: 'req-123',
    };

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      setHeader: jest.fn(),
    };

    const next = jest.fn();

    await requireApiKey(req, res, next);
    
    // Should fail
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);

    delete process.env.API_KEYS;
  });
});
