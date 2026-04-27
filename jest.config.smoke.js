'use strict';

/**
 * Jest Configuration — Smoke Test Suite (#706)
 *
 * Runs the real server process and verifies HTTP health endpoints respond.
 * Kept separate from jest.config.js (unit/integration) so smoke tests can
 * run independently in CI without interfering with coverage collection.
 *
 * Run with: npm run test:smoke
 */

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/smoke/**/*.smoke.test.js'],
  testTimeout: 30000,
  maxWorkers: 1, // smoke tests bind a real port — run serially
  verbose: true,
  collectCoverage: false,
};
