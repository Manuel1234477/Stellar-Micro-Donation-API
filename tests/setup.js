// Jest setup file - runs before all tests
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';
// Fixed test key — must be set before any module that imports securityConfig is loaded
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test_encryption_key_fixed_32bytes_hex_value_here_00';

// Polyfill for legacy test patterns
if (typeof jest !== 'undefined') {
  try {
    Object.defineProperty(jest.fn.prototype, 'resolves', {
      configurable: true,
      value: function(value) {
        return this.mockResolvedValue(value);
      }
    });

    Object.defineProperty(jest.fn.prototype, 'rejects', {
      configurable: true,
      value: function(error) {
        return this.mockRejectedValue(error);
      }
    });
  } catch (_e) {
    // Already defined or read-only — skip silently
  }
}
