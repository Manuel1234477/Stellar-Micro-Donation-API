// Jest setup file - runs before all tests
process.env.MOCK_STELLAR = 'true';
process.env.API_KEYS = 'test-key-1,test-key-2,test-key,admin-test-key';
process.env.NODE_ENV = 'test';

// Polyfill for legacy test patterns
if (typeof jest !== 'undefined') {
  jest.fn.prototype.resolves = function(value) {
    return this.mockResolvedValue(value);
  };

  jest.fn.prototype.rejects = function(error) {
    return this.mockRejectedValue(error);
  };
}
