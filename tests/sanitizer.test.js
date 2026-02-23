/**
 * Tests for input sanitization utility
 */

const {
  sanitizeText,
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeForLogging,
  sanitizeRequestBody
} = require('../src/utils/sanitizer');

describe('Sanitizer Utility', () => {
  describe('sanitizeText', () => {
    test('should trim whitespace', () => {
      expect(sanitizeText('  hello  ')).toBe('hello');
      expect(sanitizeText('\t\ntest\n\t')).toBe('test');
    });

    test('should remove null bytes', () => {
      expect(sanitizeText('hello\0world')).toBe('helloworld');
      expect(sanitizeText('\0test\0')).toBe('test');
    });

    test('should remove control characters by default', () => {
      expect(sanitizeText('hello\x01world')).toBe('helloworld');
      expect(sanitizeText('test\x1F\x7F')).toBe('test');
      expect(sanitizeText('line1\nline2')).toBe('line1line2');
    });

    test('should allow newlines when specified', () => {
      expect(sanitizeText('line1\nline2', { allowNewlines: true })).toBe('line1\nline2');
      expect(sanitizeText('test\x01\nvalue', { allowNewlines: true })).toBe('test\nvalue');
    });

    test('should remove ANSI escape sequences', () => {
      expect(sanitizeText('\x1B[31mRed Text\x1B[0m')).toBe('Red Text');
      expect(sanitizeText('\x1B[1;32mGreen\x1B[0m')).toBe('Green');
    });

    test('should restrict to safe characters when specified', () => {
      expect(sanitizeText('hello<script>alert(1)</script>', { allowSpecialChars: false }))
        .toBe('helloscriptalert1script');
      expect(sanitizeText('user@example.com', { allowSpecialChars: false }))
        .toBe('user@example.com');
    });

    test('should truncate to maximum length', () => {
      const longText = 'a'.repeat(300);
      expect(sanitizeText(longText, { maxLength: 100 }).length).toBe(100);
      expect(sanitizeText('hello', { maxLength: 3 })).toBe('hel');
    });

    test('should handle non-string inputs', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
      expect(sanitizeText(123)).toBe('');
      expect(sanitizeText({})).toBe('');
    });

    test('should handle empty strings', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText('   ')).toBe('');
    });
  });

  describe('sanitizeMemo', () => {
    test('should sanitize memo with 28 byte limit', () => {
      const longMemo = 'a'.repeat(50);
      const sanitized = sanitizeMemo(longMemo);
      expect(sanitized.length).toBeLessThanOrEqual(28);
    });

    test('should remove control characters from memo', () => {
      expect(sanitizeMemo('hello\nworld')).toBe('helloworld');
      expect(sanitizeMemo('test\x00value')).toBe('testvalue');
    });

    test('should handle empty memo', () => {
      expect(sanitizeMemo('')).toBe('');
      expect(sanitizeMemo(null)).toBe('');
    });
  });

  describe('sanitizeLabel', () => {
    test('should sanitize wallet labels', () => {
      expect(sanitizeLabel('My Wallet')).toBe('My Wallet');
      expect(sanitizeLabel('  Savings  ')).toBe('Savings');
    });

    test('should remove dangerous characters from labels', () => {
      expect(sanitizeLabel('Label\x00\x01')).toBe('Label');
      expect(sanitizeLabel('Test\nLabel')).toBe('TestLabel');
    });

    test('should enforce 100 character limit', () => {
      const longLabel = 'a'.repeat(150);
      expect(sanitizeLabel(longLabel).length).toBe(100);
    });
  });

  describe('sanitizeName', () => {
    test('should sanitize owner names', () => {
      expect(sanitizeName('John Doe')).toBe('John Doe');
      expect(sanitizeName('  Alice  ')).toBe('Alice');
    });

    test('should remove control characters from names', () => {
      expect(sanitizeName('John\x00Doe')).toBe('JohnDoe');
      expect(sanitizeName('Alice\nBob')).toBe('AliceBob');
    });
  });

  describe('sanitizeIdentifier', () => {
    test('should sanitize identifiers strictly', () => {
      expect(sanitizeIdentifier('user123')).toBe('user123');
      expect(sanitizeIdentifier('donor_456')).toBe('donor_456');
    });

    test('should remove special characters from identifiers', () => {
      expect(sanitizeIdentifier('user<script>')).toBe('userscript');
      expect(sanitizeIdentifier('test@#$%')).toBe('test');
    });

    test('should handle Stellar addresses', () => {
      const stellarKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(sanitizeIdentifier(stellarKey)).toBe(stellarKey);
    });
  });

  describe('sanitizeForLogging', () => {
    test('should sanitize string values for logging', () => {
      expect(sanitizeForLogging('hello\nworld')).toBe('helloworld');
      expect(sanitizeForLogging('test\x00value')).toBe('testvalue');
    });

    test('should sanitize objects for logging', () => {
      const obj = {
        name: 'test\nvalue',
        memo: 'hello\x00world'
      };
      const sanitized = sanitizeForLogging(obj);
      expect(sanitized.name).toBe('testvalue');
      expect(sanitized.memo).toBe('helloworld');
    });

    test('should sanitize arrays for logging', () => {
      const arr = ['test\nvalue', 'hello\x00world'];
      const sanitized = sanitizeForLogging(arr);
      expect(sanitized[0]).toBe('testvalue');
      expect(sanitized[1]).toBe('helloworld');
    });

    test('should handle nested objects', () => {
      const obj = {
        user: {
          name: 'test\nvalue',
          data: {
            memo: 'hello\x00world'
          }
        }
      };
      const sanitized = sanitizeForLogging(obj);
      expect(sanitized.user.name).toBe('testvalue');
      expect(sanitized.user.data.memo).toBe('helloworld');
    });

    test('should handle null and undefined', () => {
      expect(sanitizeForLogging(null)).toBe(null);
      expect(sanitizeForLogging(undefined)).toBe(undefined);
    });

    test('should handle numbers and booleans', () => {
      expect(sanitizeForLogging(123)).toBe(123);
      expect(sanitizeForLogging(true)).toBe(true);
    });
  });

  describe('sanitizeRequestBody', () => {
    test('should sanitize request body with field config', () => {
      const body = {
        memo: 'test\nmemo',
        label: '  My Label  ',
        amount: 100
      };

      const config = {
        memo: { type: 'memo' },
        label: { type: 'label' },
        amount: { type: 'number' }
      };

      const sanitized = sanitizeRequestBody(body, config);
      expect(sanitized.memo).toBe('testmemo');
      expect(sanitized.label).toBe('My Label');
      expect(sanitized.amount).toBe(100);
    });

    test('should use default text sanitization for unconfigured fields', () => {
      const body = {
        customField: 'test\nvalue'
      };

      const sanitized = sanitizeRequestBody(body);
      expect(sanitized.customField).toBe('testvalue');
    });
  });

  describe('Security Tests', () => {
    test('should prevent log injection attacks', () => {
      const malicious = 'user\n[2024-01-01] [ERROR] Fake log entry';
      const sanitized = sanitizeText(malicious);
      expect(sanitized).not.toContain('\n');
      expect(sanitized).toBe('user[2024-01-01] [ERROR] Fake log entry');
    });

    test('should prevent null byte injection', () => {
      const malicious = 'safe\0malicious';
      expect(sanitizeText(malicious)).toBe('safemalicious');
    });

    test('should remove ANSI escape codes that could break terminals', () => {
      const malicious = '\x1B[2J\x1B[HCleared screen';
      const sanitized = sanitizeText(malicious);
      expect(sanitized).not.toContain('\x1B');
      expect(sanitized).toBe('Cleared screen');
    });

    test('should handle potential XSS in metadata', () => {
      const xss = '<script>alert("XSS")</script>';
      const sanitized = sanitizeText(xss, { allowSpecialChars: false });
      expect(sanitized).not.toContain('<');
      expect(sanitized).not.toContain('>');
    });
  });
});
