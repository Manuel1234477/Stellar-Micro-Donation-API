/**
 * Jest Configuration — E2E Testnet Suite
 *
 * Completely separate from jest.config.js (unit/integration tests).
 * Run with: npm run test:e2e
 *
 * Key differences from the unit-test config:
 *   - Targets only tests/e2e/**\/*.e2e.test.js
 *   - 60-second timeout per test (real Stellar network ops)
 *   - Single worker process (serial) to avoid Friendbot rate limits
 *   - Custom globalSetup/globalTeardown that target real testnet
 *   - No MOCK_STELLAR — all Stellar calls hit the live testnet
 *
 * The suite is intentionally small and focused on the money path:
 *   create wallet → fund (Friendbot, with retries) → donate →
 *   verify on Horizon → refund.
 *
 * Setup/teardown no longer touch data/*.json (the old JSON persistence
 * backup/restore has been removed). Testnet resets are tolerated and
 * Friendbot funding is retried in the setup helpers.
 */

'use strict';

module.exports = {
  testEnvironment: 'node',

  // Only run e2e tests — never bleed into the unit test suite
  testMatch: ['**/tests/e2e/**/*.e2e.test.js'],

  // Keep the nightly run fast and reliable: skip any e2e suites that are
  // outside the money path (create → fund → donate → verify → refund).
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/tests/e2e/.*\\.(nonmoney|experimental|manual)\\.e2e\\.test\\.js$',
  ],

  // Lifecycle hooks unique to the e2e run (rewritten: no data/*.json access,
  // Friendbot funding with retries, tolerant of testnet resets)
  globalSetup: '<rootDir>/tests/e2e/setup.js',
  globalTeardown: '<rootDir>/tests/e2e/teardown.js',

  // Real Stellar network operations (Friendbot + tx confirmation) can take 30s+
  testTimeout: 60000,

  // Run test files serially — parallel Friendbot calls hit rate limits quickly
  maxWorkers: 1,

  // Verbose output so nightly CI logs show exactly which tests ran
  verbose: true,

  // Coverage collection is opt-in for e2e — pass --coverage flag explicitly
  collectCoverage: false,
};