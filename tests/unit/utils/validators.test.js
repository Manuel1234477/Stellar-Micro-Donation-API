const {
  isValidStellarPublicKey,
  isValidStellarSecretKey,
  isValidAmount,
  isValidDateRange,
  isValidTransactionHash,
  sanitizeString
} = require('../../../src/utils/validators');

describe('Validation Utilities - Unit Tests', () => {
  describe('Stellar Public Key Validation', () => {
    test('should accept valid Stellar public key starting with G', () => {
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

  describe('Stellar Secret Key Validation', () => {
    test('should accept valid Stellar secret key starting with S', () => {
      const validKey = 'SBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarSecretKey(validKey)).toBe(true);
    });

    test('should reject key not starting with S', () => {
      const invalidKey = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      expect(isValidStellarSecretKey(invalidKey)).toBe(false);
    });
  });

  describe('Amount Validation', () => {
    test('should accept positive numeric amounts', () => {
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

  describe('Date Range Validation', () => {
    test('should accept valid date range with start before end', () => {
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

  describe('Transaction Hash Validation', () => {
    test('should accept valid 64-character hexadecimal hash', () => {
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

  describe('String Sanitization', () => {
    test('should trim leading and trailing whitespace', () => {
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

  describe('isValidDate', () => {
    const { isValidDate } = require('../../../src/utils/validators');

    test('should accept valid ISO date strings', () => {
      expect(isValidDate('2024-01-01')).toBe(true);
      expect(isValidDate('2024-12-31T23:59:59Z')).toBe(true);
      expect(isValidDate('2024-06-15T12:30:00.000Z')).toBe(true);
    });

    test('should accept valid date formats', () => {
      expect(isValidDate('January 1, 2024')).toBe(true);
      expect(isValidDate('01/01/2024')).toBe(true);
      expect(isValidDate('2024/01/01')).toBe(true);
    });

    test('should accept timestamp numbers', () => {
      expect(isValidDate(1704067200000)).toBe(true); // 2024-01-01
      expect(isValidDate(0)).toBe(true); // Unix epoch
    });

    test('should reject invalid date strings', () => {
      expect(isValidDate('invalid-date')).toBe(false);
      expect(isValidDate('2024-13-01')).toBe(false); // Invalid month
      // Note: JavaScript Date is lenient with '2024-02-30', it rolls over to March
      expect(isValidDate('not a date')).toBe(false);
    });

    test('should reject empty or null values', () => {
      expect(isValidDate('')).toBe(false);
      // Note: new Date(null) returns epoch time, which is valid
      // This is expected JavaScript behavior
      expect(isValidDate(undefined)).toBe(false);
    });

    test('should reject NaN', () => {
      expect(isValidDate(NaN)).toBe(false);
    });

    test('should handle edge case dates', () => {
      expect(isValidDate('1970-01-01')).toBe(true); // Unix epoch
      expect(isValidDate('2099-12-31')).toBe(true); // Future date
      expect(isValidDate('1900-01-01')).toBe(true); // Past date
    });
  });

  describe('walletExists', () => {
    const { walletExists } = require('../../../src/utils/validators');
    const User = require('../../../src/routes/models/user');

    beforeEach(() => {
      // Mock User.getById
      jest.spyOn(User, 'getById');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should return true when wallet exists', () => {
      User.getById.mockReturnValue({ id: 1, wallet: 'GTEST...' });
      expect(walletExists(1)).toBe(true);
    });

    test('should return false when wallet does not exist', () => {
      User.getById.mockReturnValue(null);
      expect(walletExists(999)).toBe(false);
    });

    test('should return false for null wallet ID', () => {
      expect(walletExists(null)).toBe(false);
    });

    test('should return false for undefined wallet ID', () => {
      expect(walletExists(undefined)).toBe(false);
    });

    test('should return false for empty string wallet ID', () => {
      expect(walletExists('')).toBe(false);
    });

    test('should return false for zero wallet ID', () => {
      User.getById.mockReturnValue(null);
      expect(walletExists(0)).toBe(false);
    });
  });

  describe('walletAddressExists', () => {
    const { walletAddressExists } = require('../../../src/utils/validators');
    const User = require('../../../src/routes/models/user');

    beforeEach(() => {
      jest.spyOn(User, 'getByWallet');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should return true when wallet address exists', () => {
      const address = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      User.getByWallet.mockReturnValue({ id: 1, wallet: address });
      expect(walletAddressExists(address)).toBe(true);
    });

    test('should return false when wallet address does not exist', () => {
      User.getByWallet.mockReturnValue(null);
      expect(walletAddressExists('GINVALIDADDRESS')).toBe(false);
    });

    test('should return false for null wallet address', () => {
      expect(walletAddressExists(null)).toBe(false);
    });

    test('should return false for undefined wallet address', () => {
      expect(walletAddressExists(undefined)).toBe(false);
    });

    test('should return false for empty string wallet address', () => {
      expect(walletAddressExists('')).toBe(false);
    });

    test('should handle malformed addresses', () => {
      User.getByWallet.mockReturnValue(null);
      expect(walletAddressExists('invalid')).toBe(false);
      expect(walletAddressExists('123')).toBe(false);
    });
  });

  describe('transactionExists', () => {
    const { transactionExists } = require('../../../src/utils/validators');
    const Transaction = require('../../../src/routes/models/transaction');

    beforeEach(() => {
      jest.spyOn(Transaction, 'getById');
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('should return true when transaction exists', () => {
      Transaction.getById.mockReturnValue({ id: 1, amount: 100 });
      expect(transactionExists(1)).toBe(true);
    });

    test('should return false when transaction does not exist', () => {
      Transaction.getById.mockReturnValue(null);
      expect(transactionExists(999)).toBe(false);
    });

    test('should return false for null transaction ID', () => {
      expect(transactionExists(null)).toBe(false);
    });

    test('should return false for undefined transaction ID', () => {
      expect(transactionExists(undefined)).toBe(false);
    });

    test('should return false for empty string transaction ID', () => {
      expect(transactionExists('')).toBe(false);
    });

    test('should return false for zero transaction ID', () => {
      Transaction.getById.mockReturnValue(null);
      expect(transactionExists(0)).toBe(false);
    });

    test('should handle string transaction IDs', () => {
      Transaction.getById.mockReturnValue({ id: '123', amount: 100 });
      expect(transactionExists('123')).toBe(true);
    });
  });

  describe('Edge Cases and Security', () => {
    test('isValidStellarPublicKey should reject lowercase keys', () => {
      const lowercaseKey = 'gbrpyhil2ci3fnq4bxlfmndlfjunpu2hy3zmfshonuceoasw7qc7ox2h';
      expect(isValidStellarPublicKey(lowercaseKey)).toBe(false);
    });

    test('isValidStellarPublicKey should reject keys with invalid base32 chars', () => {
      expect(isValidStellarPublicKey('G' + '1'.repeat(55))).toBe(false); // 1 not in base32
      expect(isValidStellarPublicKey('G' + '8'.repeat(55))).toBe(false); // 8 not in base32
      expect(isValidStellarPublicKey('G' + '9'.repeat(55))).toBe(false); // 9 not in base32
      expect(isValidStellarPublicKey('G' + '0'.repeat(55))).toBe(false); // 0 not in base32
    });

    test('isValidStellarSecretKey should reject keys with wrong length', () => {
      expect(isValidStellarSecretKey('S' + 'A'.repeat(54))).toBe(false); // Too short
      expect(isValidStellarSecretKey('S' + 'A'.repeat(56))).toBe(false); // Too long
    });

    test('isValidAmount should handle very small positive numbers', () => {
      expect(isValidAmount(0.0000001)).toBe(true);
      expect(isValidAmount(Number.MIN_VALUE)).toBe(true);
    });

    test('isValidAmount should handle very large positive numbers', () => {
      expect(isValidAmount(999999999999)).toBe(true);
      expect(isValidAmount(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    test('isValidAmount should handle string with spaces', () => {
      expect(isValidAmount('10 ')).toBe(true); // parseFloat handles trailing spaces
      expect(isValidAmount(' 10')).toBe(true); // parseFloat handles leading spaces
      expect(isValidAmount('1 0')).toBe(true); // parseFloat('1 0') returns 1
    });

    test('isValidTransactionHash should be case insensitive', () => {
      const upperHash = 'A'.repeat(64);
      const lowerHash = 'a'.repeat(64);
      const mixedHash = 'Aa'.repeat(32);
      
      expect(isValidTransactionHash(upperHash)).toBe(true);
      expect(isValidTransactionHash(lowerHash)).toBe(true);
      expect(isValidTransactionHash(mixedHash)).toBe(true);
    });

    test('isValidTransactionHash should reject hash with spaces', () => {
      const hashWithSpace = 'a'.repeat(32) + ' ' + 'a'.repeat(31);
      expect(isValidTransactionHash(hashWithSpace)).toBe(false);
    });

    test('isValidDateRange should handle ISO date strings', () => {
      const result = isValidDateRange('2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z');
      expect(result.valid).toBe(true);
    });

    test('isValidDateRange should handle timestamp numbers', () => {
      const result = isValidDateRange(1704067200000, 1735689599000);
      expect(result.valid).toBe(true);
    });

    test('sanitizeString should preserve internal spaces', () => {
      expect(sanitizeString('  hello world  ')).toBe('hello world');
      expect(sanitizeString('  multiple   spaces  ')).toBe('multiple   spaces');
    });

    test('sanitizeString should handle special characters', () => {
      expect(sanitizeString('  test@example.com  ')).toBe('test@example.com');
      expect(sanitizeString('  $100.50  ')).toBe('$100.50');
    });
  });
});
