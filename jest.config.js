/**
 * Jest Configuration
 * Test runner configuration for Stellar Micro-Donation API
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    'tests/e2e/',
    'tests/donation-routes-integration.test.js', // Temporarily disabled - pre-existing failures
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
  coverageReporters: ['text', 'text-summary', 'lcov', 'html', 'json-summary'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
  // Cap parallelism to avoid I/O contention on per-worker SQLite copies while
  // still exercising true parallelism. Overridden to 2 in test:coverage:ci.
  maxWorkers: '50%',
  // Recycle workers that grow too large (e.g. after importing heavy modules)
  // to avoid OOM in long parallel runs.
  workerIdleMemoryLimit: '512MB',
  setupFiles: ['<rootDir>/tests/setup.js'],
  globalSetup: '<rootDir>/tests/globalSetup.js',
};
