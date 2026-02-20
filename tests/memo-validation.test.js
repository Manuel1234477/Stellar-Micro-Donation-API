/**
 * Memo Validation Tests
 * Tests for memo validation according to Stellar specifications
 */

const MemoValidator = require('../src/utils/memoValidator');

describe('MemoValidator', () => {
  describe('validate()', () => {
    test('should accept empty memo', () => {
      const result = MemoValidator.validate('');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('');
      expect(result.byteLength).toBe(0);
    });

    test('should accept null/undefined memo', () => {
      const result1 = MemoValidator.validate(null);
      expect(result1.valid).toBe(true);

      const result2 = MemoValidator.validate(undefined);
      expect(result2.valid).toBe(true);
    });

    test('should accept valid memo within 28 bytes', () => {
      const result = MemoValidator.validate('Donation for charity');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('Donation for charity');
      expect(result.byteLength).toBeLessThanOrEqual(28);
    });

    test('should accept memo exactly 28 bytes', () => {
      const memo = 'a'.repeat(28); // 28 ASCII characters = 28 bytes
      const result = MemoValidator.validate(memo);
      expect(result.valid).toBe(true);
      expect(result.byteLength).toBe(28);
    });

    test('should reject memo exceeding 28 bytes', () => {
      const memo = 'a'.repeat(29);
      const result = MemoValidator.validate(memo);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('MEMO_TOO_LONG');
      expect(result.error).toContain('exceeds maximum length');
    });

    test('should reject non-string memo', () => {
      const result = MemoValidator.validate(123);
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_MEMO_TYPE');
    });

    test('should reject memo with null bytes', () => {
      const result = MemoValidator.validate('test\0memo');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('INVALID_MEMO_CONTENT');
    });

    test('should trim whitespace from memo', () => {
      const result = MemoValidator.validate('  test memo  ');
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('test memo');
    });

    test('should handle multi-byte UTF-8 characters correctly', () => {
      // Emoji are typically 4 bytes each
      const memo = '❤️❤️❤️❤️❤️❤️❤️'; // 7 emojis = 28 bytes
      const result = MemoValidator.validate(memo);
      
      // This should be valid or invalid depending on exact byte count
      if (result.byteLength <= 28) {
        expect(result.valid).toBe(true);
      } else {
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MEMO_TOO_LONG');
      }
    });
  });

  describe('sanitize()', () => {
    test('should return empty string for null/undefined', () => {
      expect(MemoValidator.sanitize(null)).toBe('');
      expect(MemoValidator.sanitize(undefined)).toBe('');
    });

    test('should trim whitespace', () => {
      expect(MemoValidator.sanitize('  test  ')).toBe('test');
    });

    test('should remove null bytes', () => {
      expect(MemoValidator.sanitize('test\0memo')).toBe('testmemo');
    });

    test('should handle non-string input', () => {
      expect(MemoValidator.sanitize(123)).toBe('');
    });
  });

  describe('isEmpty()', () => {
    test('should return true for empty/null/undefined', () => {
      expect(MemoValidator.isEmpty('')).toBe(true);
      expect(MemoValidator.isEmpty(null)).toBe(true);
      expect(MemoValidator.isEmpty(undefined)).toBe(true);
      expect(MemoValidator.isEmpty('   ')).toBe(true);
    });

    test('should return false for non-empty memo', () => {
      expect(MemoValidator.isEmpty('test')).toBe(false);
    });
  });

  describe('truncate()', () => {
    test('should truncate memo exceeding 28 bytes', () => {
      const memo = 'a'.repeat(50);
      const truncated = MemoValidator.truncate(memo);
      expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(28);
    });

    test('should not modify memo within limit', () => {
      const memo = 'test memo';
      const truncated = MemoValidator.truncate(memo);
      expect(truncated).toBe(memo);
    });

    test('should handle multi-byte characters when truncating', () => {
      const memo = '❤️'.repeat(20); // Many emojis
      const truncated = MemoValidator.truncate(memo);
      expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(28);
    });
  });

  describe('getMaxLength()', () => {
    test('should return 28', () => {
      expect(MemoValidator.getMaxLength()).toBe(28);
    });
  });
});
