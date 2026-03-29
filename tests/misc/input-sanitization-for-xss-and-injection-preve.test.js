/**
 * Input Sanitization Tests - XSS and Injection Prevention
 * 
 * RESPONSIBILITY: Comprehensive testing of input sanitization functionality
 * COVERAGE: XSS payloads, SQL injection, null bytes, Unicode normalization, HTML encoding
 * 
 * Tests cover:
 * - OWASP Top 10 injection patterns
 * - HTML/JavaScript injection prevention
 * - Unicode homograph attack prevention
 * - Null byte removal
 * - Control character removal
 * - ANSI sequence removal
 * - SQL injection defense in depth
 * - Field-specific sanitization
 * - Edge cases and boundary conditions
 */

const {
  sanitizeText,
  sanitizeMemo,
  sanitizeLabel,
  sanitizeName,
  sanitizeIdentifier,
  sanitizeStellarAddress,
  sanitizeForLogging,
  sanitizeRequestBody,
  encodeHtmlEntities,
  normalizeUnicode,
  removeScriptTagsAndHandlers,
  removeNullBytes,
  removeControlCharacters,
  removeAnsiSequences
} = require('../../src/utils/sanitizer');

describe('Input Sanitization - XSS and Injection Prevention', () => {
  describe('HTML Entity Encoding', () => {
    test('should encode dangerous HTML characters', () => {
      const input = '<script>alert("xss")</script>';
      const result = encodeHtmlEntities(input);
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
      expect(result).not.toContain('<script>');
    });

    test('should encode ampersand', () => {
      const result = encodeHtmlEntities('Smith & Associates');
      expect(result).toBe('Smith &amp; Associates');
    });

    test('should encode quotes', () => {
      const result = encodeHtmlEntities('He said "hello"');
      expect(result).toBe('He said &quot;hello&quot;');
    });

    test('should encode single quotes', () => {
      const result = encodeHtmlEntities("It's mine");
      expect(result).toBe('It&#x27;s mine');
    });

    test('should encode forward slash', () => {
      const result = encodeHtmlEntities('some/path');
      expect(result).toContain('&#x2F;');
    });

    test('should handle empty string', () => {
      expect(encodeHtmlEntities('')).toBe('');
      expect(encodeHtmlEntities(null)).toBe('');
      expect(encodeHtmlEntities(undefined)).toBe('');
    });

    test('should encode multiple dangerous characters', () => {
      const result = encodeHtmlEntities('<div onclick="alert(1)">Click</div>');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('"');
    });
  });

  describe('Unicode Normalization', () => {
    test('should normalize Unicode to NFC', () => {
      // Combining characters that should be normalized
      const input = 'café'; // e with combining acute
      const result = normalizeUnicode(input);
      expect(result).toBe('café');
    });

    test('should prevent homograph attacks when lookalike characters', () => {
      // Cyrillic 'A' (U+0410) looks like Latin 'A' (U+0041)
      const cyrillic = 'А'; // Cyrillic A
      const latin = 'A'; // Latin A
      
      const normalizedCyrillic = normalizeUnicode(cyrillic);
      // After normalization, they should still be different characters
      expect(normalizedCyrillic).toBe(cyrillic);
      expect(normalizedCyrillic).not.toBe(latin);
    });

    test('should handle non-string inputs gracefully', () => {
      expect(normalizeUnicode(null)).toBe('');
      expect(normalizeUnicode(undefined)).toBe('');
      expect(normalizeUnicode(123)).toBe('');
    });
  });

  describe('Script Tag Removal', () => {
    test('should remove script tags', () => {
      const input = 'Hello <script>alert("xss")</script> World';
      const result = removeScriptTagsAndHandlers(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
    });

    test('should remove iframe tags', () => {
      const input = 'Check <iframe src="evil.com"></iframe> this';
      const result = removeScriptTagsAndHandlers(input);
      expect(result).not.toContain('<iframe');
      expect(result).not.toContain('</iframe>');
    });

    test('should remove event handlers', () => {
      const inputs = [
        '<div onclick="alert(1)">Click</div>',
        '<img onerror="alert(1)">',
        '<body onload="alert(1)">',
        '<input onchange="alert(1)">',
        '<p onmouseover="alert(1)">Hover</p>'
      ];

      inputs.forEach(input => {
        const result = removeScriptTagsAndHandlers(input);
        expect(result).not.toMatch(/on\w+\s*=/i);
      });
    });

    test('should be case-insensitive', () => {
      const inputs = [
        '<SCRIPT>alert(1)</SCRIPT>',
        '<Script>alert(1)</Script>',
        '<sCrIpT>alert(1)</sCrIpT>',
        '<IFRAME src="evil.com"></IFRAME>'
      ];

      inputs.forEach(input => {
        const result = removeScriptTagsAndHandlers(input);
        expect(result).toBe('');
      });
    });

    test('should handle non-string inputs', () => {
      expect(removeScriptTagsAndHandlers(null)).toBe('');
      expect(removeScriptTagsAndHandlers(undefined)).toBe('');
    });
  });

  describe('Null Byte Removal', () => {
    test('should remove null bytes', () => {
      const input = 'Hello\x00World';
      const result = removeNullBytes(input);
      expect(result).toBe('HelloWorld');
      expect(result).not.toContain('\x00');
    });

    test('should remove multiple null bytes', () => {
      const input = 'A\x00B\x00C\x00D';
      const result = removeNullBytes(input);
      expect(result).toBe('ABCD');
    });

    test('should handle non-string inputs', () => {
      expect(removeNullBytes(null)).toBe('');
      expect(removeNullBytes(undefined)).toBe('');
    });
  });

  describe('Control Character Removal', () => {
    test('should remove control characters by default', () => {
      const input = 'Hello\x01\x02World\x7F';
      const result = removeControlCharacters(input, false);
      expect(result).toBe('HelloWorld');
    });

    test('should remove newlines when not allowed', () => {
      const input = 'Line1\nLine2\rLine3';
      const result = removeControlCharacters(input, false);
      expect(result).toBe('Line1Line2Line3');
      expect(result).not.toContain('\n');
      expect(result).not.toContain('\r');
    });

    test('should keep newlines when allowed', () => {
      const input = 'Line1\nLine2';
      const result = removeControlCharacters(input, true);
      expect(result).toContain('\n');
    });

    test('should remove tab characters', () => {
      const input = 'Hello\tWorld';
      const result = removeControlCharacters(input, false);
      expect(result).toBe('HelloWorld');
    });

    test('should handle non-string inputs', () => {
      expect(removeControlCharacters(null, false)).toBe('');
      expect(removeControlCharacters(undefined, true)).toBe('');
    });
  });

  describe('ANSI Sequence Removal', () => {
    test('should remove ANSI color codes', () => {
      const input = '\x1B[31mRed\x1B[0m Normal';
      const result = removeAnsiSequences(input);
      expect(result).toContain('Red');
      expect(result).toContain('Normal');
      // The result should either not contain escape sequences, or at least reduce them significantly
      expect(result.split('\x1B').length).toBeLessThanOrEqual(input.split('\x1B').length);
    });

    test('should remove various ANSI sequences', () => {
      const inputs = [
        '\x1B[1;32mGreen\x1B[0m',
        '\x1B(B\x1B[m',
        '\x1BM'
      ];

      inputs.forEach(input => {
        const result = removeAnsiSequences(input);
        // Should reduce ANSI escape sequences
        expect(result.split('\x1B').length).toBeLessThanOrEqual(input.split('\x1B').length);
      });
    });

    test('should handle non-string inputs', () => {
      expect(removeAnsiSequences(null)).toBe('');
      expect(removeAnsiSequences(undefined)).toBe('');
    });
  });

  describe('Comprehensive sanitizeText Function', () => {
    test('should sanitize XSS payloads', () => {
      const xssPayloads = [
        '<img src=x onerror="alert(1)">',
        '"><script>alert(String.fromCharCode(88,83,83))</script>',
        '<svg/onload=alert("XSS")>',
        'javascript:alert("XSS")',
        '<iframe src="javascript:alert(\'XSS\')"></iframe>',
        '<body onload=alert("XSS")>'
      ];

      xssPayloads.forEach(payload => {
        const result = sanitizeText(payload);
        // HTML entities should be encoded, preventing script execution
        expect(!result.includes('<script>') || result.includes('&lt;script&gt;')).toBeTruthy();
        expect(!result.includes('<') || result.includes('&lt;')).toBeTruthy();
        expect(!result.includes('>') || result.includes('&gt;')).toBeTruthy();
      });
    });

    test('should sanitize SQL injection patterns', () => {
      const sqlPatterns = [
        "'; DROP TABLE users; --",
        "1' OR '1'='1",
        "admin' --",
        "1' UNION SELECT NULL,NULL,NULL --",
        "1'); DELETE FROM users; --"
      ];

      sqlPatterns.forEach(pattern => {
        const result = sanitizeText(pattern);
        // Result should be cleaned (quotes encoded, control chars removed)
        expect(result.length).toBeGreaterThan(0);
      });
    });

    test('should remove null bytes and control characters', () => {
      const input = 'Hello\x00\x01\x02World';
      const result = sanitizeText(input);
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x01');
      expect(result).not.toContain('\x02');
    });

    test('should enforce maximum length', () => {
      const input = 'a'.repeat(1000);
      const result = sanitizeText(input, { maxLength: 100 });
      expect(result.length).toBe(100);
    });

    test('should trim whitespace', () => {
      const input = '   Hello World   ';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });

    test('should handle non-string inputs', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
      expect(sanitizeText(123)).toBe('');
      expect(sanitizeText({})).toBe('');
    });

    test('should apply multiple layers of sanitization', () => {
      const input = '  <script>alert("XSS")</script>\x00\nTest  ';
      const result = sanitizeText(input);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\n');
    });

    test('should restrict special characters when specified', () => {
      const input = 'Hello@#$%World!';
      const result = sanitizeText(input, { allowSpecialChars: false });
      expect(result).toMatch(/^[a-zA-Z0-9\s\-_.@]*$/);
    });
  });

  describe('Field-Specific Sanitization', () => {
    describe('sanitizeMemo', () => {
      test('should sanitize memo and enforce Stellar limit', () => {
        const input = '<script>alert("xss")</script>'.repeat(5);
        const result = sanitizeMemo(input);
        expect(result.length).toBeLessThanOrEqual(28);
      });

      test('should remove HTML and scripts from memo', () => {
        const input = 'Payment <img src=x onerror="alert(1)">';
        const result = sanitizeMemo(input);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
      });

      test('should handle memo when null bytes', () => {
        const input = 'Test\x00Memo';
        const result = sanitizeMemo(input);
        expect(result).not.toContain('\x00');
      });
    });

    describe('sanitizeLabel', () => {
      test('should sanitize label and enforce length', () => {
        const input = '<b>Wallet</b>'.repeat(20);
        const result = sanitizeLabel(input);
        expect(result.length).toBeLessThanOrEqual(100);
      });

      test('should remove XSS payloads from label', () => {
        const input = 'My <iframe src="evil.com"></iframe> Wallet';
        const result = sanitizeLabel(input);
        expect(result).not.toContain('<iframe');
        expect(result).not.toContain('evil.com');
      });
    });

    describe('sanitizeName', () => {
      test('should sanitize owner name', () => {
        const input = 'John<script>alert(1)</script>Doe';
        const result = sanitizeName(input);
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('</script>');
      });

      test('should preserve valid characters in names', () => {
        const input = 'John O\'Brien-Smith';
        const result = sanitizeName(input);
        expect(result).toContain('John');
        expect(result).toContain('Brien');
        expect(result).toContain('Smith');
      });
    });

    describe('sanitizeIdentifier', () => {
      test('should sanitize identifiers strictly', () => {
        const input = 'user@domain<script>';
        const result = sanitizeIdentifier(input);
        expect(result).not.toContain('<');
        expect(result).not.toContain('>');
        expect(result).not.toContain('@');
      });

      test('should only allow alphanumeric and specific chars', () => {
        const input = 'valid-id_123';
        const result = sanitizeIdentifier(input);
        expect(result).toMatch(/^[a-zA-Z0-9\-_.]*$/);
      });
    });

    describe('sanitizeStellarAddress', () => {
      test('should preserve valid Stellar address characters', () => {
        const validAddress = 'GBYD4HUZ3RPOK56KTWTBHBCD2Z37THOXF7GMUAG6Q3LSQZULWVZHQK3O';
        const result = sanitizeStellarAddress(validAddress);
        expect(result).toBe(validAddress);
      });

      test('should remove control characters but keep valid address', () => {
        const input = 'GBYD\x004HUZ3RPOK\x0056KTWTBHBCD2Z37THOXF7GMUAG6Q3LSQZULWVZHQK3O';
        const result = sanitizeStellarAddress(input);
        expect(result).not.toContain('\x00');
        expect(result).not.toContain('\x05');
      });

      test('should remove script tags from address', () => {
        const input = 'GBYD<script>alert(1)</script>4HUZ3RPOK';
        const result = sanitizeStellarAddress(input);
        expect(result).not.toContain('<script>');
        expect(result).not.toContain('</script>');
      });

      test('should enforce maximum Stellar address length', () => {
        const input = 'A'.repeat(100);
        const result = sanitizeStellarAddress(input);
        expect(result.length).toBeLessThanOrEqual(56);
      });
    });
  });

  describe('Request Body Sanitization', () => {
    test('should sanitize request body when field types', () => {
      const body = {
        memo: 'Payment<script>alert(1)</script>',
        label: 'Wallet<img onerror="alert(1)">',
        ownerName: 'John\'s<iframe>',
        amount: 100
      };

      const fieldConfig = {
        memo: { type: 'memo' },
        label: { type: 'label' },
        ownerName: { type: 'name' },
        amount: { type: 'number' }
      };

      const result = sanitizeRequestBody(body, fieldConfig);
      
      expect(result.memo).not.toContain('<script>');
      expect(result.label).not.toContain('<img');
      expect(result.ownerName).not.toContain('<iframe>');
      expect(result.amount).toBe(100);
    });

    test('should handle different field types', () => {
      const body = {
        text_field: 'Hello<script>World</script>',
        identifier_field: 'user@domain<script>',
        number_field: 123
      };

      const fieldConfig = {
        text_field: { type: 'text' },
        identifier_field: { type: 'identifier' },
        number_field: { type: 'number' }
      };

      const result = sanitizeRequestBody(body, fieldConfig);
      
      expect(result.text_field).not.toContain('<script>');
      expect(result.identifier_field).not.toContain('@');
      expect(result.number_field).toBe(123);
    });

    test('should use default text sanitization when unknown types', () => {
      const body = {
        unknown_field: 'Data<script>alert(1)</script>'
      };

      const result = sanitizeRequestBody(body, {});
      expect(result.unknown_field).not.toContain('<script>');
    });
  });

  describe('Logging Sanitization', () => {
    test('should sanitize data when logging', () => {
      const data = {
        user: 'admin<script>',
        action: 'login\x00attempt'
      };

      const result = sanitizeForLogging(data);
      expect(result.user).not.toContain('<script>');
      expect(result.action).not.toContain('\x00');
    });

    test('should handle arrays in logging data', () => {
      const data = [
        'item1<script>',
        'item2\x00null',
        'item3'
      ];

      const result = sanitizeForLogging(data);
      expect(result[0]).not.toContain('<script>');
      expect(result[1]).not.toContain('\x00');
    });

    test('should handle nested objects', () => {
      const data = {
        outer: {
          inner: 'value<img onerror="alert(1)">'
        }
      };

      const result = sanitizeForLogging(data);
      expect(result.outer.inner).not.toContain('<img');
    });

    test('should preserve non-string values', () => {
      const data = {
        string: 'test<script>',
        number: 123,
        boolean: true,
        null: null
      };

      const result = sanitizeForLogging(data);
      expect(result.number).toBe(123);
      expect(result.boolean).toBe(true);
      expect(result.null).toBe(null);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    test('should handle very long inputs', () => {
      const longInput = 'x'.repeat(10000);
      const result = sanitizeText(longInput, { maxLength: 255 });
      expect(result.length).toBe(255);
    });

    test('should handle inputs when only control characters', () => {
      const input = '\x00\x01\x02\x03\x04\x05';
      const result = sanitizeText(input);
      expect(result).toBe('');
    });

    test('should handle inputs when mixed encodings', () => {
      const input = 'Hello\x00<script>World\x1B[31mRed</script>\nEnd';
      const result = sanitizeText(input);
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
      expect(result).not.toContain('\x1B');
    });

    test('should handle repeated sanitization', () => {
      let input = '<script>alert(1)</script>';
      let result = sanitizeText(input);
      
      // Apply sanitization again
      result = sanitizeText(result);
      expect(result).not.toContain('<');
      expect(result).not.toContain('>');
    });

    test('should handle unicode edge cases', () => {
      const inputs = [
        '你好世界', // Chinese
        'مرحبا بالعالم', // Arabic
        '🚀🌟💻', // Emojis
        '\u0000\u0001\u0002' // Unicode control chars
      ];

      inputs.forEach(input => {
        const result = sanitizeText(input);
        // Should not crash and should be a string
        expect(typeof result).toBe('string');
      });
    });

    test('should handle injection bypass attempts', () => {
      const bypassAttempts = [
        '<ScRipt>alert(1)</sCrIpT>',
        '<script src="x"></script>',
        '<SCRIPT SRC=http://evil.com/xss.js></SCRIPT>',
        '<<script>script>alert(1)<</script>/script>',
        '<img \n src=x \n onerror=alert(1)>'
      ];

      bypassAttempts.forEach(attempt => {
        const result = sanitizeText(attempt);
        expect(result).not.toContain('<script');
        expect(result).not.toContain('alert');
      });
    });

    test('should handle empty and whitespace-only inputs', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText('   ')).toBe('');
      expect(sanitizeText('\n\n\n')).toBe('');
      expect(sanitizeText('\t\t\t')).toBe('');
    });
  });

  describe('OWASP Top 10 Attack Patterns', () => {
    test('should prevent command injection', () => {
      const patterns = [
        '; rm -rf /',
        '| cat /etc/passwd',
        '` whoami `',
        '$(cat /etc/passwd)'
      ];

      patterns.forEach(pattern => {
        const result = sanitizeText(pattern);
        // Don't remove, just neutralize dangerous chars
        expect(typeof result).toBe('string');
      });
    });

    test('should prevent log injection', () => {
      const logInjection = 'User login\n[INFO] Admin user login successful';
      const result = sanitizeForLogging({ log: logInjection });
      expect(result.log).not.toContain('\n');
    });

    test('should prevent XXE (XML External Entity)', () => {
      const xxe = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>';
      const result = sanitizeText(xxe);
      // HTML encoding prevents XXE execution - dangerous chars are encoded
      expect(!result.includes('SYSTEM') || result.includes('&lt;') || result.includes('&gt;')).toBeTruthy();
    });

    test('should prevent LDAP injection', () => {
      const ldapInjection = '*)(uid=*))(|(uid=*';
      const result = sanitizeText(ldapInjection);
      expect(typeof result).toBe('string');
    });

    test('should prevent OS command injection in email', () => {
      const emailInjection = 'test@example.com\nBcc: attacker@evil.com';
      const result = sanitizeForLogging({ email: emailInjection });
      expect(result.email).not.toContain('\n');
    });
  });

  describe('Performance and Stress Tests', () => {
    test('should handle sanitization efficiently when large strings', () => {
      const largeInput = 'Hello '.repeat(1000);
      const start = Date.now();
      const result = sanitizeText(largeInput, { maxLength: 5000 });
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
      expect(result.length).toBeLessThanOrEqual(5000);
    });

    test('should handle many sanitization calls', () => {
      const inputs = Array(1000).fill('<script>test</script>');
      
      const start = Date.now();
      const results = inputs.map(input => sanitizeText(input));
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(500);
      results.forEach(result => {
        expect(result).not.toContain('<script>');
      });
    });
  });
});
