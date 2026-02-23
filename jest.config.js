/**
 * Jest Configuration
 * Test runner configuration for Stellar Micro-Donation API
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/scheduler-resilience.test.js',
    'tests/advanced-failure-scenarios.test.js',
    'tests/failure-scenarios.test.js',
    'tests/transaction-sync-consistency.test.js',
    'tests/network-timeout-scenarios.test.js',
    'tests/recurring-donation-failures.test.js',
    'tests/transaction-sync-failures.test.js',
    'tests/account-funding.test.js',
    'tests/wallet-analytics-integration.test.js',
    'tests/validation-middleware.test.js',
    'tests/permission-integration.test.js',
    'tests/idempotency-integration.test.js',
    'tests/idempotency.test.js',
  ],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/scripts/**',
    '!src/config/**',
  ],
  coverageThreshold: {
    global: {
      branches: 30,
      functions: 30,
      lines: 30,
      statements: 30,
    },
  },
  verbose: true,
  testTimeout: 10000,
  setupFiles: ['<rootDir>/tests/setup.js'],
};
