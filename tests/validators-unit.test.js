/**
 * Unit Tests for Validation Utilities
 * Tests all helper validation functions for Stellar keys, amounts, dates, and hashes
 */

const {
  isValidStellarPublicKey,
  isValidStellarSecretKey,
  isValidAmount,
  isValidDate,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString
} = require('../src/utils/validators');

describe('Validators Utility Functions', () => {
  describe('isValidStellarPublicKey()', () => {
    describe('Valid public keys', () => {
      test('should accept valid Stellar public key format', () => {
        const validKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
        expect(isValidStellarPublicKey(validKey)).toBe(true);
      });

      test('should accept another valid public key', () => {
        const validKey = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
        expect(isValidStellarPublicKey(validKey)).toBe(true);
      });

      test('should accept public key with all valid base32 characters', () => {
        const validKey = 'G' + 'A'.repeat(55); // All A's
        expect(isValidStellarPublicKey(validKey)).toBe(true);
      });

      test('should accept public key with numbers 2-7', () => {
        const validKey = 'G234567234567234567234567234567234567234567234567234567';
        expect(isValidStellarPublicKey(validKey)).toBe(true);
      });
    });

    describe('Invalid public keys', () => {
      test('should reject key starting with S (secret key)', () => {
        const invalidKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });

      test('should reject key with wrong length (too short)', () => {
        const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDL';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });

      test('should reject key with wrong length (too long)', () => {
        const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2HEXTRACHARS';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });

      test('should reject key with invalid characters (lowercase)', () => {
        const invalidKey = 'gbrpyhil2ci3fnq4bxlfmndlfjunpu2hy3zmfshonuceoasw7qc7ox2h';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });

      test('should reject key with invalid base32 characters (0, 1, 8, 9)', () => {
        const invalidKey = 'G0189PYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7O';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });

      test('should reject empty string', () => {
        expect(isValidStellarPublicKey('')).toBe(false);
      });

      test('should reject null', () => {
        expect(isValidStellarPublicKey(null)).toBe(false);
      });

      test('should reject undefined', () => {
        expect(isValidStellarPublicKey(undefined)).toBe(false);
      });

      test('should reject number', () => {
        expect(isValidStellarPublicKey(12345)).toBe(false);
      });

      test('should reject object', () => {
        expect(isValidStellarPublicKey({ key: 'G...' })).toBe(false);
      });

      test('should reject key with special characters', () => {
        const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7O@#$';
        expect(isValidStellarPublicKey(invalidKey)).toBe(false);
      });
    });
  });

  describe('isValidStellarSecretKey()', () => {
    describe('Valid secret keys', () => {
      test('should accept valid Stellar secret key format', () => {
        const validKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
        expect(isValidStellarSecretKey(validKey)).toBe(true);
      });

      test('should accept another valid secret key', () => {
        const validKey = 'SA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
        expect(isValidStellarSecretKey(validKey)).toBe(true);
      });

      test('should accept secret key with all valid base32 characters', () => {
        const validKey = 'S' + 'A'.repeat(55);
        expect(isValidStellarSecretKey(validKey)).toBe(true);
      });
    });

    describe('Invalid secret keys', () => {
      test('should reject key starting with G (public key)', () => {
        const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
        expect(isValidStellarSecretKey(invalidKey)).toBe(false);
      });

      test('should reject key with wrong length', () => {
        const invalidKey = 'SBRPYHIL2CI3FNQ4';
        expect(isValidStellarSecretKey(invalidKey)).toBe(false);
      });

      test('should reject non-string input', () => {
        expect(isValidStellarSecretKey(12345)).toBe(false);
        expect(isValidStellarSecretKey(null)).toBe(false);
        expect(isValidStellarSecretKey(undefined)).toBe(false);
      });

      test('should reject key with invalid characters', () => {
        const invalidKey = 'S0189PYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7O';
        expect(isValidStellarSecretKey(invalidKey)).toBe(false);
      });
    });
  });

  describe('isValidAmount()', () => {
    describe('Valid amounts', () => {
      test('should accept positive integer', () => {
        expect(isValidAmount(10)).toBe(true);
      });

      test('should accept positive decimal', () => {
        expect(isValidAmount(10.5)).toBe(true);
      });

      test('should accept very small positive number', () => {
        expect(isValidAmount(0.0001)).toBe(true);
      });

      test('should accept large number', () => {
        expect(isValidAmount(999999)).toBe(true);
      });

      test('should accept string representation of positive number', () => {
        expect(isValidAmount('10')).toBe(true);
        expect(isValidAmount('10.5')).toBe(true);
      });
    });

    describe('Invalid amounts', () => {
      test('should reject zero', () => {
        expect(isValidAmount(0)).toBe(false);
      });

      test('should reject negative number', () => {
        expect(isValidAmount(-10)).toBe(false);
      });

      test('should reject NaN', () => {
        expect(isValidAmount(NaN)).toBe(false);
      });

      test('should reject Infinity', () => {
        expect(isValidAmount(Infinity)).toBe(false);
      });

      test('should reject negative Infinity', () => {
        expect(isValidAmount(-Infinity)).toBe(false);
      });

      test('should reject non-numeric string', () => {
        expect(isValidAmount('abc')).toBe(false);
      });

      test('should reject empty string', () => {
        expect(isValidAmount('')).toBe(false);
      });

      test('should reject null', () => {
        expect(isValidAmount(null)).toBe(false);
      });

      test('should reject undefined', () => {
        expect(isValidAmount(undefined)).toBe(false);
      });

      test('should reject object', () => {
        expect(isValidAmount({ amount: 10 })).toBe(false);
      });

      test('should reject array', () => {
        expect(isValidAmount([10])).toBe(false);
      });
    });
  });

  describe('isValidDate()', () => {
    describe('Valid dates', () => {
      test('should accept ISO date string', () => {
        expect(isValidDate('2024-01-15T10:30:00Z')).toBe(true);
      });

      test('should accept simple date string', () => {
        expect(isValidDate('2024-01-15')).toBe(true);
      });

      test('should accept date with time', () => {
        expect(isValidDate('2024-01-15 10:30:00')).toBe(true);
      });

      test('should accept various date formats', () => {
        expect(isValidDate('January 15, 2024')).toBe(true);
        expect(isValidDate('01/15/2024')).toBe(true);
      });

      test('should accept timestamp string', () => {
        expect(isValidDate('1705315800000')).toBe(true);
      });
    });

    describe('Invalid dates', () => {
      test('should reject invalid date string', () => {
        expect(isValidDate('not-a-date')).toBe(false);
      });

      test('should reject impossible date', () => {
        expect(isValidDate('2024-13-45')).toBe(false);
      });

      test('should reject empty string', () => {
        expect(isValidDate('')).toBe(false);
      });

      test('should reject null', () => {
        expect(isValidDate(null)).toBe(false);
      });

      test('should reject undefined', () => {
        expect(isValidDate(undefined)).toBe(false);
      });
    });
  });

  describe('isValidDateRange()', () => {
    describe('Valid date ranges', () => {
      test('should accept valid date range', () => {
        const result = isValidDateRange('2024-01-01', '2024-01-31');
        expect(result.valid).toBe(true);
      });

      test('should accept same start and end date', () => {
        const result = isValidDateRange('2024-01-15', '2024-01-15');
        expect(result.valid).toBe(true);
      });

      test('should accept date range with time', () => {
        const result = isValidDateRange(
          '2024-01-01T00:00:00Z',
          '2024-01-31T23:59:59Z'
        );
        expect(result.valid).toBe(true);
      });
    });

    describe('Invalid date ranges', () => {
      test('should reject when start date is after end date', () => {
        const result = isValidDateRange('2024-01-31', '2024-01-01');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('before endDate');
      });

      test('should reject invalid start date', () => {
        const result = isValidDateRange('invalid-date', '2024-01-31');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid date format');
      });

      test('should reject invalid end date', () => {
        const result = isValidDateRange('2024-01-01', 'invalid-date');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid date format');
      });

      test('should reject both dates invalid', () => {
        const result = isValidDateRange('invalid-start', 'invalid-end');
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('isValidTransactionHash()', () => {
    describe('Valid transaction hashes', () => {
      test('should accept 64-character hex string (lowercase)', () => {
        const hash = 'a'.repeat(64);
        expect(isValidTransactionHash(hash)).toBe(true);
      });

      test('should accept 64-character hex string (uppercase)', () => {
        const hash = 'A'.repeat(64);
        expect(isValidTransactionHash(hash)).toBe(true);
      });

      test('should accept mixed case hex string', () => {
        const hash = 'AbCdEf0123456789'.repeat(4); // 64 chars
        expect(isValidTransactionHash(hash)).toBe(true);
      });

      test('should accept valid Stellar transaction hash format', () => {
        const hash = '3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889';
        expect(isValidTransactionHash(hash)).toBe(true);
      });

      test('should accept hash with numbers and letters a-f', () => {
        const hash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
        expect(isValidTransactionHash(hash)).toBe(true);
      });
    });

    describe('Invalid transaction hashes', () => {
      test('should reject hash with wrong length (too short)', () => {
        const hash = 'a'.repeat(63);
        expect(isValidTransactionHash(hash)).toBe(false);
      });

      test('should reject hash with wrong length (too long)', () => {
        const hash = 'a'.repeat(65);
        expect(isValidTransactionHash(hash)).toBe(false);
      });

      test('should reject hash with invalid characters (g-z)', () => {
        const hash = 'g'.repeat(64);
        expect(isValidTransactionHash(hash)).toBe(false);
      });

      test('should reject hash with special characters', () => {
        const hash = 'a'.repeat(63) + '@';
        expect(isValidTransactionHash(hash)).toBe(false);
      });

      test('should reject hash with spaces', () => {
        const hash = 'a'.repeat(60) + '    ';
        expect(isValidTransactionHash(hash)).toBe(false);
      });

      test('should reject empty string', () => {
        expect(isValidTransactionHash('')).toBe(false);
      });

      test('should reject non-string input', () => {
        expect(isValidTransactionHash(12345)).toBe(false);
        expect(isValidTransactionHash(null)).toBe(false);
        expect(isValidTransactionHash(undefined)).toBe(false);
      });
    });
  });

  describe('sanitizeString()', () => {
    test('should trim whitespace from string', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
    });

    test('should remove leading whitespace', () => {
      expect(sanitizeString('  hello')).toBe('hello');
    });

    test('should remove trailing whitespace', () => {
      expect(sanitizeString('hello  ')).toBe('hello');
    });

    test('should handle string with only whitespace', () => {
      expect(sanitizeString('   ')).toBe('');
    });

    test('should return empty string for non-string input', () => {
      expect(sanitizeString(12345)).toBe('');
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
      expect(sanitizeString({})).toBe('');
      expect(sanitizeString([])).toBe('');
    });

    test('should preserve content with internal spaces', () => {
      expect(sanitizeString('hello world')).toBe('hello world');
    });

    test('should handle empty string', () => {
      expect(sanitizeString('')).toBe('');
    });

    test('should handle string with tabs and newlines', () => {
      expect(sanitizeString('\t hello \n world \r')).toBe('hello \n world');
    });
  });

  describe('Edge cases and integration scenarios', () => {
    test('should handle validation pipeline for Stellar keys', () => {
      const publicKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const secretKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

      expect(isValidStellarPublicKey(publicKey)).toBe(true);
      expect(isValidStellarSecretKey(publicKey)).toBe(false);

      expect(isValidStellarSecretKey(secretKey)).toBe(true);
      expect(isValidStellarPublicKey(secretKey)).toBe(false);
    });

    test('should handle common transaction workflow validations', () => {
      // Valid transaction components
      const amount = '10.5';
      const hash = 'a'.repeat(64);
      const date = '2024-01-15T10:00:00Z';

      expect(isValidAmount(amount)).toBe(true);
      expect(isValidTransactionHash(hash)).toBe(true);
      expect(isValidDate(date)).toBe(true);
    });

    test('should sanitize user input before validation', () => {
      const dirtyInput = '  user input  ';
      const cleaned = sanitizeString(dirtyInput);
      expect(cleaned).toBe('user input');
    });
  });
});
