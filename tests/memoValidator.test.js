/**
 * Unit Tests for MemoValidator
 * Tests memo validation according to Stellar specifications
 */

const MemoValidator = require('../src/utils/memoValidator');

describe('MemoValidator', () => {
  describe('validate()', () => {
    describe('Valid memos', () => {
      test('should accept empty memo', () => {
        const result = MemoValidator.validate('');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('');
        expect(result.byteLength).toBe(0);
      });

      test('should accept null/undefined as empty memo', () => {
        const result1 = MemoValidator.validate(null);
        const result2 = MemoValidator.validate(undefined);
        expect(result1.valid).toBe(true);
        expect(result2.valid).toBe(true);
      });

      test('should accept short ASCII memo', () => {
        const result = MemoValidator.validate('Payment for service');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('Payment for service');
        expect(result.byteLength).toBeLessThanOrEqual(28);
      });

      test('should accept memo at maximum length (28 bytes)', () => {
        const memo = 'a'.repeat(28); // Exactly 28 ASCII characters
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(true);
        expect(result.byteLength).toBe(28);
      });

      test('should accept memo with numbers', () => {
        const result = MemoValidator.validate('Invoice 12345');
        expect(result.valid).toBe(true);
      });

      test('should accept memo with special characters', () => {
        const result = MemoValidator.validate('Payment #123 @user');
        expect(result.valid).toBe(true);
      });

      test('should trim whitespace from valid memo', () => {
        const result = MemoValidator.validate('  test memo  ');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('test memo');
      });

      test('should accept emoji within byte limit', () => {
        const result = MemoValidator.validate('🎉'); // Single emoji (4 bytes in UTF-8)
        expect(result.valid).toBe(true);
      });
    });

    describe('Invalid type handling', () => {
      test('should reject non-string memo', () => {
        const result = MemoValidator.validate(12345);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('must be a string');
        expect(result.code).toBe('INVALID_MEMO_TYPE');
      });

      test('should reject object as memo', () => {
        const result = MemoValidator.validate({ text: 'memo' });
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_TYPE');
      });

      test('should reject array as memo', () => {
        const result = MemoValidator.validate(['memo']);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_TYPE');
      });

      test('should reject boolean as memo', () => {
        const result = MemoValidator.validate(true);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_TYPE');
      });
    });

    describe('Length validation', () => {
      test('should reject memo exceeding 28 bytes', () => {
        const memo = 'a'.repeat(29); // 29 ASCII characters
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('exceeds maximum length');
        expect(result.code).toBe('MEMO_TOO_LONG');
        expect(result.maxLength).toBe(28);
        expect(result.currentLength).toBe(29);
      });

      test('should reject long UTF-8 memo exceeding byte limit', () => {
        // Emoji take more bytes: 🎉 = 4 bytes in UTF-8
        const memo = '🎉'.repeat(8); // 8 emojis = 32 bytes
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MEMO_TOO_LONG');
        expect(result.currentLength).toBeGreaterThan(28);
      });

      test('should correctly count multi-byte UTF-8 characters', () => {
        const memo = 'Test 你好'; // Contains Chinese characters (3 bytes each)
        const result = MemoValidator.validate(memo);
        const expectedBytes = Buffer.byteLength(memo.trim(), 'utf8');
        if (result.valid) {
          expect(result.byteLength).toBe(expectedBytes);
        }
      });

      test('should reject very long memo', () => {
        const memo = 'a'.repeat(100);
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MEMO_TOO_LONG');
      });
    });

    describe('Content validation', () => {
      test('should reject memo with null bytes', () => {
        const memo = 'test\x00memo';
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('null bytes');
        expect(result.code).toBe('INVALID_MEMO_CONTENT');
      });

      test('should reject memo with control characters', () => {
        const memo = 'test\x01memo'; // SOH control character
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('control characters');
        expect(result.code).toBe('INVALID_MEMO_FORMAT');
      });

      test('should reject memo with tab character', () => {
        const memo = 'test\tmemo';
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_FORMAT');
      });

      test('should reject memo with newline', () => {
        const memo = 'test\nmemo';
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_FORMAT');
      });

      test('should reject memo with carriage return', () => {
        const memo = 'test\rmemo';
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_FORMAT');
      });

      test('should reject memo with DEL character', () => {
        const memo = 'test\x7Fmemo';
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(false);
        expect(result.code).toBe('INVALID_MEMO_FORMAT');
      });
    });
  });

  describe('sanitize()', () => {
    test('should trim whitespace', () => {
      const result = MemoValidator.sanitize('  test memo  ');
      expect(result).toBe('test memo');
    });

    test('should remove null bytes', () => {
      const result = MemoValidator.sanitize('test\x00memo');
      expect(result).toBe('testmemo');
      expect(result).not.toContain('\x00');
    });

    test('should return empty string for null input', () => {
      const result = MemoValidator.sanitize(null);
      expect(result).toBe('');
    });

    test('should return empty string for undefined input', () => {
      const result = MemoValidator.sanitize(undefined);
      expect(result).toBe('');
    });

    test('should return empty string for non-string input', () => {
      const result = MemoValidator.sanitize(12345);
      expect(result).toBe('');
    });

    test('should handle empty string', () => {
      const result = MemoValidator.sanitize('');
      expect(result).toBe('');
    });

    test('should preserve valid content', () => {
      const result = MemoValidator.sanitize('Valid memo content');
      expect(result).toBe('Valid memo content');
    });
  });

  describe('getMaxLength()', () => {
    test('should return 28 as maximum length', () => {
      const maxLength = MemoValidator.getMaxLength();
      expect(maxLength).toBe(28);
    });

    test('should return a number', () => {
      const maxLength = MemoValidator.getMaxLength();
      expect(typeof maxLength).toBe('number');
    });
  });

  describe('isEmpty()', () => {
    test('should return true for empty string', () => {
      expect(MemoValidator.isEmpty('')).toBe(true);
    });

    test('should return true for null', () => {
      expect(MemoValidator.isEmpty(null)).toBe(true);
    });

    test('should return true for undefined', () => {
      expect(MemoValidator.isEmpty(undefined)).toBe(true);
    });

    test('should return true for whitespace-only string', () => {
      expect(MemoValidator.isEmpty('   ')).toBe(true);
      expect(MemoValidator.isEmpty('\t')).toBe(true);
      expect(MemoValidator.isEmpty('\n')).toBe(true);
    });

    test('should return false for non-empty string', () => {
      expect(MemoValidator.isEmpty('test')).toBe(false);
    });

    test('should return false for string with content and whitespace', () => {
      expect(MemoValidator.isEmpty('  test  ')).toBe(false);
    });
  });

  describe('truncate()', () => {
    test('should truncate long memo to 28 bytes', () => {
      const longMemo = 'a'.repeat(50);
      const result = MemoValidator.truncate(longMemo);
      const byteLength = Buffer.byteLength(result, 'utf8');
      expect(byteLength).toBeLessThanOrEqual(28);
    });

    test('should not truncate memo within limit', () => {
      const memo = 'Short memo';
      const result = MemoValidator.truncate(memo);
      expect(result).toBe('Short memo');
    });

    test('should handle memo exactly at limit', () => {
      const memo = 'a'.repeat(28);
      const result = MemoValidator.truncate(memo);
      expect(result).toBe(memo);
      expect(Buffer.byteLength(result, 'utf8')).toBe(28);
    });

    test('should return empty string for null input', () => {
      const result = MemoValidator.truncate(null);
      expect(result).toBe('');
    });

    test('should return empty string for undefined input', () => {
      const result = MemoValidator.truncate(undefined);
      expect(result).toBe('');
    });

    test('should return empty string for non-string input', () => {
      const result = MemoValidator.truncate(12345);
      expect(result).toBe('');
    });

    test('should trim whitespace before truncating', () => {
      const memo = '  ' + 'a'.repeat(50) + '  ';
      const result = MemoValidator.truncate(memo);
      expect(result.startsWith(' ')).toBe(false);
      expect(result.endsWith(' ')).toBe(false);
    });

    test('should handle multi-byte UTF-8 characters correctly', () => {
      // Each emoji is 4 bytes, so 7 emojis = 28 bytes, 8 = 32 bytes
      const memo = '🎉'.repeat(10); // 40 bytes
      const result = MemoValidator.truncate(memo);
      const byteLength = Buffer.byteLength(result, 'utf8');
      expect(byteLength).toBeLessThanOrEqual(28);
      // Should have truncated to 7 emojis (28 bytes)
      expect(result).toBe('🎉'.repeat(7));
    });

    test('should handle empty string', () => {
      const result = MemoValidator.truncate('');
      expect(result).toBe('');
    });
  });

  describe('Edge cases and Stellar-specific scenarios', () => {
    test('should handle common payment memos', () => {
      const memos = [
        'Invoice #12345',
        'Payment for goods',
        'Transfer',
        'Donation',
        'Salary payment',
      ];

      memos.forEach(memo => {
        const result = MemoValidator.validate(memo);
        expect(result.valid).toBe(true);
      });
    });

    test('should handle international characters within byte limit', () => {
      const result = MemoValidator.validate('Café payment'); // é is 2 bytes
      expect(result.valid).toBe(true);
    });

    test('should correctly validate mixed ASCII and UTF-8', () => {
      const memo = 'Test 测试'; // Mix of ASCII and Chinese
      const result = MemoValidator.validate(memo);
      const byteLength = Buffer.byteLength(memo, 'utf8');
      if (byteLength <= 28) {
        expect(result.valid).toBe(true);
      } else {
        expect(result.valid).toBe(false);
        expect(result.code).toBe('MEMO_TOO_LONG');
      }
    });
  });
});
