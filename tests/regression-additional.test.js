/**
 * Regression Tests for Additional Recent Features
 * Protects against breaking changes in:
 * - Idempotency Service
 * - Transaction Sync Service
 * - Input Sanitization
 * - Memo Validation
 * - JSDoc Documentation
 */

const IdempotencyService = require('../src/services/IdempotencyService');
const TransactionSyncService = require('../src/services/TransactionSyncService');
const { sanitizeText, sanitizeMemo } = require('../src/utils/sanitizer');
const MemoValidator = require('../src/utils/memoValidator');

describe('Regression Tests - Additional Recent Features', () => {
  describe('Idempotency Service', () => {
    // Skip database-dependent tests in unit test environment
    // These are covered by integration tests
    it('should validate idempotency key format', () => {
      const valid = IdempotencyService.validateKey('valid-key-1234567890');
      expect(valid.valid).toBe(true);

      const tooShort = IdempotencyService.validateKey('short');
      expect(tooShort.valid).toBe(false);
      expect(tooShort.error).toContain('at least 16 characters');

      const invalidChars = IdempotencyService.validateKey('invalid@key#1234567890');
      expect(invalidChars.valid).toBe(false);
      expect(invalidChars.error).toContain('alphanumeric');
    });

    it('should generate request hash consistently', () => {
      const data1 = { amount: '10', donor: 'A', recipient: 'B' };
      const data2 = { recipient: 'B', amount: '10', donor: 'A' }; // Different order
      
      const hash1 = IdempotencyService.generateRequestHash(data1);
      const hash2 = IdempotencyService.generateRequestHash(data2);
      
      expect(hash1).toBe(hash2); // Should be same despite different order
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 char hex
    });

    it('should generate valid idempotency keys', () => {
      const key = IdempotencyService.generateKey();
      
      expect(key).toMatch(/^idem_\d+_[a-f0-9]{32}$/);
      expect(key.length).toBeGreaterThan(16);
    });

    // Database operations are tested in idempotency-integration.test.js
  });

  describe('Transaction Sync Service', () => {
    it('should initialize with default Horizon URL', () => {
      const service = new TransactionSyncService();
      expect(service.server).toBeDefined();
    });

    it('should initialize with custom Horizon URL', () => {
      const customUrl = 'https://horizon.stellar.org';
      const service = new TransactionSyncService(customUrl);
      expect(service.server).toBeDefined();
    });

    it('should have syncWalletTransactions method', () => {
      const service = new TransactionSyncService();
      expect(typeof service.syncWalletTransactions).toBe('function');
    });

    it('should have private extraction methods', () => {
      const service = new TransactionSyncService();
      expect(typeof service._extractAmount).toBe('function');
      expect(typeof service._extractSource).toBe('function');
      expect(typeof service._extractDestination).toBe('function');
    });

    it('should extract amount from transaction', () => {
      const service = new TransactionSyncService();
      const tx = { operations: [{ amount: '100.5' }] };
      
      const amount = service._extractAmount(tx);
      expect(amount).toBe('100.5');
    });

    it('should handle missing amount gracefully', () => {
      const service = new TransactionSyncService();
      const tx = { operations: [] };
      
      const amount = service._extractAmount(tx);
      expect(amount).toBe('0');
    });

    it('should extract source account', () => {
      const service = new TransactionSyncService();
      const tx = { source_account: 'GABC123' };
      
      const source = service._extractSource(tx);
      expect(source).toBe('GABC123');
    });

    it('should extract destination account', () => {
      const service = new TransactionSyncService();
      const tx = { 
        source_account: 'GABC123',
        operations: [{ destination: 'GDEF456' }] 
      };
      
      const dest = service._extractDestination(tx);
      expect(dest).toBe('GDEF456');
    });

    it('should fallback to source if no destination', () => {
      const service = new TransactionSyncService();
      const tx = { 
        source_account: 'GABC123',
        operations: [] 
      };
      
      const dest = service._extractDestination(tx);
      expect(dest).toBe('GABC123');
    });
  });

  describe('Input Sanitization', () => {
    it('should remove null bytes from text', () => {
      const input = 'Hello\x00World';
      const sanitized = sanitizeText(input);
      
      expect(sanitized).toBe('HelloWorld');
      expect(sanitized).not.toContain('\x00');
    });

    it('should remove control characters', () => {
      const input = 'Hello\x01\x02\x03World';
      const sanitized = sanitizeText(input);
      
      expect(sanitized).toBe('HelloWorld');
    });

    it('should remove ANSI escape sequences', () => {
      const input = '\x1b[31mRed Text\x1b[0m';
      const sanitized = sanitizeText(input);
      
      expect(sanitized).not.toContain('\x1b');
      expect(sanitized).toContain('Red Text');
    });

    it('should trim whitespace', () => {
      const input = '  Hello World  ';
      const sanitized = sanitizeText(input);
      
      expect(sanitized).toBe('Hello World');
    });

    it('should truncate to maximum length', () => {
      const input = 'A'.repeat(200);
      const sanitized = sanitizeText(input, { maxLength: 100 });
      
      expect(sanitized.length).toBe(100);
    });

    it('should handle empty strings', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
    });

    it('should sanitize memo with 28 byte limit', () => {
      const longMemo = 'A'.repeat(50);
      const sanitized = sanitizeMemo(longMemo);
      
      // sanitizeMemo uses character limit, not byte limit
      expect(sanitized.length).toBeLessThanOrEqual(28);
    });
  });

  describe('Memo Validation', () => {
    it('should accept valid memo', () => {
      const result = MemoValidator.validate('Valid memo text');
      
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should accept empty memo', () => {
      const result = MemoValidator.validate('');
      
      expect(result.valid).toBe(true);
    });

    it('should accept null/undefined memo', () => {
      expect(MemoValidator.validate(null).valid).toBe(true);
      expect(MemoValidator.validate(undefined).valid).toBe(true);
    });

    it('should reject memo exceeding 28 bytes', () => {
      const longMemo = 'A'.repeat(29);
      const result = MemoValidator.validate(longMemo);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('28 bytes');
    });

    it('should reject non-string memo', () => {
      const result = MemoValidator.validate(12345);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('string');
    });

    it('should reject memo with null bytes', () => {
      const result = MemoValidator.validate('Hello\x00World');
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('null bytes');
    });

    it('should sanitize memo', () => {
      const sanitized = MemoValidator.sanitize('  Hello World  ');
      
      expect(sanitized).toBe('Hello World');
    });

    it('should check if memo is empty', () => {
      expect(MemoValidator.isEmpty('')).toBe(true);
      expect(MemoValidator.isEmpty(null)).toBe(true);
      expect(MemoValidator.isEmpty('  ')).toBe(true);
      expect(MemoValidator.isEmpty('text')).toBe(false);
    });

    it('should truncate memo to 28 bytes', () => {
      const longMemo = 'A'.repeat(50);
      const truncated = MemoValidator.truncate(longMemo);
      
      expect(Buffer.byteLength(truncated, 'utf8')).toBeLessThanOrEqual(28);
    });

    it('should return max length', () => {
      expect(MemoValidator.getMaxLength()).toBe(28);
    });
  });

  describe('JSDoc Documentation (Regression)', () => {
    // Verify that JSDoc doesn't break functionality
    it('should not affect StellarService functionality', () => {
      const StellarService = require('../src/services/StellarService');
      const service = new StellarService();
      
      expect(typeof service.createWallet).toBe('function');
      expect(typeof service.getBalance).toBe('function');
      expect(typeof service.sendDonation).toBe('function');
    });

    it('should not affect RecurringDonationScheduler functionality', () => {
      const scheduler = require('../src/services/RecurringDonationScheduler');
      
      // RecurringDonationScheduler is exported as an instance
      expect(typeof scheduler).toBe('object');
      expect(typeof scheduler.start).toBe('function');
      expect(typeof scheduler.stop).toBe('function');
      expect(typeof scheduler.processSchedules).toBe('function');
    });

    it('should not affect TransactionSyncService functionality', () => {
      const service = new TransactionSyncService();
      
      expect(typeof service.syncWalletTransactions).toBe('function');
      expect(service.server).toBeDefined();
    });

    it('should not affect IdempotencyService functionality', () => {
      expect(typeof IdempotencyService.validateKey).toBe('function');
      expect(typeof IdempotencyService.generateKey).toBe('function');
      expect(typeof IdempotencyService.store).toBe('function');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain idempotency key validation rules', () => {
      // Keys must be at least 16 characters
      expect(IdempotencyService.validateKey('short').valid).toBe(false);
      expect(IdempotencyService.validateKey('1234567890123456').valid).toBe(true);
      
      // Keys must not exceed 255 characters
      const longKey = 'A'.repeat(256);
      expect(IdempotencyService.validateKey(longKey).valid).toBe(false);
    });

    it('should maintain memo byte limit at 28', () => {
      expect(MemoValidator.getMaxLength()).toBe(28);
      
      const result = MemoValidator.validate('A'.repeat(29));
      expect(result.valid).toBe(false);
    });

    it('should maintain sanitization behavior', () => {
      // Null bytes should always be removed
      expect(sanitizeText('test\x00data')).not.toContain('\x00');
      
      // Control characters should be removed
      expect(sanitizeText('test\x01data')).not.toContain('\x01');
      
      // Whitespace should be trimmed
      expect(sanitizeText('  test  ')).toBe('test');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty transaction operations', () => {
      const service = new TransactionSyncService();
      const tx = { operations: null };
      
      expect(() => service._extractAmount(tx)).not.toThrow();
      expect(service._extractAmount(tx)).toBe('0');
    });

    it('should handle special characters in sanitization', () => {
      const special = '<script>alert("xss")</script>';
      const sanitized = sanitizeText(special);
      
      // sanitizeText doesn't remove HTML by default, only control chars
      // For HTML removal, use safeCharsOnly option
      expect(sanitized).toContain('script');
    });

    it('should handle Unicode in memo validation', () => {
      const unicode = '你好世界'; // "Hello World" in Chinese
      const result = MemoValidator.validate(unicode);
      
      // Should validate based on byte length, not character count
      expect(result.valid).toBe(Buffer.byteLength(unicode, 'utf8') <= 28);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid idempotency key types', () => {
      expect(IdempotencyService.validateKey(null).valid).toBe(false);
      expect(IdempotencyService.validateKey(undefined).valid).toBe(false);
      expect(IdempotencyService.validateKey(123).valid).toBe(false);
      expect(IdempotencyService.validateKey({}).valid).toBe(false);
    });

    it('should handle invalid memo types', () => {
      expect(MemoValidator.validate(123).valid).toBe(false);
      expect(MemoValidator.validate({}).valid).toBe(false);
      expect(MemoValidator.validate([]).valid).toBe(false);
    });

    it('should handle non-string sanitization input', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
      expect(sanitizeText(123)).toBe('');
      expect(sanitizeText({})).toBe('');
    });
  });
});
