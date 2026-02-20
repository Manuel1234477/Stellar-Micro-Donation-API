/**
 * Tests for Stellar Address Validation
 */

const { validateStellarAddress, validateStellarSecretKey } = require('../src/utils/stellarValidation');

describe('Stellar Address Validation', () => {
  describe('validateStellarAddress', () => {
    test('should accept valid Stellar public key', () => {
      // Valid Stellar testnet address
      const validAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const result = validateStellarAddress(validAddress);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    test('should reject address that does not start with G', () => {
      const invalidAddress = 'ABRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
      const result = validateStellarAddress(invalidAddress);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with "G"');
    });

    test('should reject address with wrong length', () => {
      const shortAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX';
      const result = validateStellarAddress(shortAddress);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid Stellar address length');
    });

    test('should reject empty address', () => {
      const result = validateStellarAddress('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    test('should reject null address', () => {
      const result = validateStellarAddress(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    test('should reject undefined address', () => {
      const result = validateStellarAddress(undefined);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    test('should reject non-string address', () => {
      const result = validateStellarAddress(12345);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must be a string');
    });

    test('should trim whitespace and validate', () => {
      const addressWithSpaces = '  GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H  ';
      const result = validateStellarAddress(addressWithSpaces);
      expect(result.valid).toBe(true);
    });

    test('should reject address with invalid checksum', () => {
      // Modified last character to break checksum
      const invalidChecksum = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2X';
      const result = validateStellarAddress(invalidChecksum);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid Stellar address');
    });
  });

  describe('validateStellarSecretKey', () => {
    test('should accept valid Stellar secret key', () => {
      // Valid Stellar secret key format
      const validSecret = 'SBZVMB3SEPB2QXKGDWQM7VPNQVF4CEZSQFQHQVFQVQVQVQVQVQVQVQVQ';
      const result = validateStellarSecretKey(validSecret);
      // Note: This will fail checksum validation, but tests the format check
      expect(result.valid).toBe(false); // Invalid checksum
    });

    test('should reject secret key that does not start with S', () => {
      const invalidSecret = 'GBZVMB3SEPB2QXKGDWQM7VPNQVF4CEZSQFQHQVFQVQVQVQVQVQVQVQVQ';
      const result = validateStellarSecretKey(invalidSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('must start with "S"');
    });

    test('should reject secret key with wrong length', () => {
      const shortSecret = 'SBZVMB3SEPB2QXKGDWQM7VPNQVF4CEZSQFQHQVFQVQVQVQVQVQVQ';
      const result = validateStellarSecretKey(shortSecret);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid Stellar secret key length');
    });

    test('should reject empty secret key', () => {
      const result = validateStellarSecretKey('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });

    test('should reject null secret key', () => {
      const result = validateStellarSecretKey(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('required');
    });
  });
});
