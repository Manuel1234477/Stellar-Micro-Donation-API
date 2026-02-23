const {
  isValidStellarPublicKey,
  isValidStellarSecretKey,
  isValidAmount,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString
} = require('../src/utils/validators');

describe('Validation Utilities', () => {
  describe('isValidStellarPublicKey', () => {
    test('should accept valid Stellar public key', () => {
      const validKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarPublicKey(validKey)).toBe(true);
    });

    test('should reject key not starting with G', () => {
      const invalidKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarPublicKey(invalidKey)).toBe(false);
    });

    test('should reject key with wrong length', () => {
      const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX';
      expect(isValidStellarPublicKey(invalidKey)).toBe(false);
    });

    test('should reject key with invalid characters', () => {
      const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2!';
      expect(isValidStellarPublicKey(invalidKey)).toBe(false);
    });

    test('should reject non-string input', () => {
      expect(isValidStellarPublicKey(123)).toBe(false);
      expect(isValidStellarPublicKey(null)).toBe(false);
      expect(isValidStellarPublicKey(undefined)).toBe(false);
    });
  });

  describe('isValidStellarSecretKey', () => {
    test('should accept valid Stellar secret key', () => {
      const validKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarSecretKey(validKey)).toBe(true);
    });

    test('should reject key not starting with S', () => {
      const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarSecretKey(invalidKey)).toBe(false);
    });
  });

  describe('isValidAmount', () => {
    test('should accept positive numbers', () => {
      expect(isValidAmount(1)).toBe(true);
      expect(isValidAmount(0.01)).toBe(true);
      expect(isValidAmount('10.5')).toBe(true);
      expect(isValidAmount(1000000)).toBe(true);
    });

    test('should reject zero', () => {
      expect(isValidAmount(0)).toBe(false);
      expect(isValidAmount('0')).toBe(false);
    });

    test('should reject negative numbers', () => {
      expect(isValidAmount(-1)).toBe(false);
      expect(isValidAmount('-10.5')).toBe(false);
    });

    test('should reject non-numeric values', () => {
      expect(isValidAmount('abc')).toBe(false);
      expect(isValidAmount(null)).toBe(false);
      expect(isValidAmount(undefined)).toBe(false);
      expect(isValidAmount(NaN)).toBe(false);
    });

    test('should reject infinity', () => {
      expect(isValidAmount(Infinity)).toBe(false);
      expect(isValidAmount(-Infinity)).toBe(false);
    });
  });

  describe('isValidDateRange', () => {
    test('should accept valid date range', () => {
      const result = isValidDateRange('2024-01-01', '2024-12-31');
      expect(result.valid).toBe(true);
    });

    test('should reject invalid date format', () => {
      const result = isValidDateRange('invalid', '2024-12-31');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid date format');
    });

    test('should reject start date after end date', () => {
      const result = isValidDateRange('2024-12-31', '2024-01-01');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('startDate must be before endDate');
    });

    test('should accept same start and end date', () => {
      const result = isValidDateRange('2024-01-01', '2024-01-01');
      expect(result.valid).toBe(true);
    });
  });

  describe('isValidTransactionHash', () => {
    test('should accept valid 64-char hex string', () => {
      const validHash = 'a'.repeat(64);
      expect(isValidTransactionHash(validHash)).toBe(true);
    });

    test('should accept mixed case hex', () => {
      const validHash = 'AbCdEf0123456789'.repeat(4);
      expect(isValidTransactionHash(validHash)).toBe(true);
    });

    test('should reject wrong length', () => {
      const invalidHash = 'a'.repeat(63);
      expect(isValidTransactionHash(invalidHash)).toBe(false);
    });

    test('should reject non-hex characters', () => {
      const invalidHash = 'g'.repeat(64);
      expect(isValidTransactionHash(invalidHash)).toBe(false);
    });

    test('should reject non-string input', () => {
      expect(isValidTransactionHash(123)).toBe(false);
      expect(isValidTransactionHash(null)).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    test('should trim whitespace', () => {
      expect(sanitizeString('  hello  ')).toBe('hello');
      expect(sanitizeString('\n\ttest\n')).toBe('test');
    });

    test('should return empty string for non-string input', () => {
      expect(sanitizeString(123)).toBe('');
      expect(sanitizeString(null)).toBe('');
      expect(sanitizeString(undefined)).toBe('');
    });

    test('should handle empty string', () => {
      expect(sanitizeString('')).toBe('');
      expect(sanitizeString('   ')).toBe('');
    });
  });
});
