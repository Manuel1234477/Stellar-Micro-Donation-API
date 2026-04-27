/**
 * Infrastructure Verification Tests — E2E Testnet Suite
 *
 * Runs inside the standard mock-based Jest suite (no real network calls).
 * Verifies that all e2e infrastructure files exist, are correctly structured,
 * and that the retry helper behaves as specified.
 *
 * This file serves as the issue-tracking test for GitHub issue #371.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ─── File Existence ───────────────────────────────────────────────────────────

describe('E2E infrastructure — required files exist', () => {
  const requiredFiles = [
    'jest.config.e2e.js',
    'tests/e2e/setup.js',
    'tests/e2e/teardown.js',
    'tests/e2e/helpers/retry.js',
    'tests/e2e/helpers/testnet.js',
    'tests/e2e/wallet.e2e.test.js',
    'tests/e2e/donation.e2e.test.js',
    'tests/e2e/transaction.e2e.test.js',
    '.github/workflows/e2e-nightly.yml',
    'docs/features/ADD_ENDTOEND_TEST_SUITE_WITH_REAL_STELLAR_TESTNET.md',
  ];

  test.each(requiredFiles)('%s exists', (relPath) => {
    expect(fs.existsSync(path.join(ROOT, relPath))).toBe(true);
  });
});

// ─── Jest E2E Config ──────────────────────────────────────────────────────────

describe('jest.config.e2e.js — valid configuration', () => {
  let config;

  beforeAll(() => {
    config = require('../../jest.config.e2e.js');
  });

  it('targets only e2e test files', () => {
    expect(config.testMatch).toEqual(
      expect.arrayContaining([expect.stringContaining('e2e')])
    );
  });

  it('has an extended testTimeout for real network operations', () => {
    expect(config.testTimeout).toBeGreaterThanOrEqual(30000);
  });

  it('runs tests serially (maxWorkers: 1) to avoid Friendbot rate limits', () => {
    expect(config.maxWorkers).toBe(1);
  });

  it('specifies globalSetup pointing to the e2e setup file', () => {
    expect(config.globalSetup).toMatch(/tests\/e2e\/setup\.js/);
  });

  it('specifies globalTeardown pointing to the e2e teardown file', () => {
    expect(config.globalTeardown).toMatch(/tests\/e2e\/teardown\.js/);
  });

  it('uses the node test environment', () => {
    expect(config.testEnvironment).toBe('node');
  });
});

// ─── Retry Helper — Unit Tests ────────────────────────────────────────────────

describe('tests/e2e/helpers/retry.js — withRetry()', () => {
  const { withRetry, waitUntil, computeBackoff } = require('../e2e/helpers/retry');

  it('resolves immediately when the operation succeeds on the first attempt', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3 });

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and resolves when a subsequent attempt succeeds', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) throw new Error('transient');
      return Promise.resolve('recovered');
    });

    const result = await withRetry(fn, {
      maxAttempts: 5,
      baseDelayMs: 0,
      maxDelayMs: 0,
    });

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws the last error when all attempts are exhausted', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent failure'));

    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 })
    ).rejects.toThrow('persistent failure');

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying immediately when shouldRetry returns false', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('non-retryable'));

    await expect(
      withRetry(fn, {
        maxAttempts: 5,
        baseDelayMs: 0,
        shouldRetry: () => false,
      })
    ).rejects.toThrow('non-retryable');

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('calls the onRetry callback with error, attempt, and delayMs', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) throw new Error('temp');
      return Promise.resolve('done');
    });

    const onRetry = jest.fn();
    await withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    const [err, attempt, delay] = onRetry.mock.calls[0];
    expect(err.message).toBe('temp');
    expect(attempt).toBe(1);
    expect(typeof delay).toBe('number');
  });
});

describe('tests/e2e/helpers/retry.js — waitUntil()', () => {
  const { waitUntil } = require('../e2e/helpers/retry');

  it('resolves when condition becomes true on the first poll', async () => {
    const condition = jest.fn().mockResolvedValue(true);
    await expect(waitUntil(condition, { maxAttempts: 3, intervalMs: 0 })).resolves.toBeUndefined();
    expect(condition).toHaveBeenCalledTimes(1);
  });

  it('retries until condition becomes true', async () => {
    let count = 0;
    const condition = jest.fn().mockImplementation(() => {
      count++;
      return Promise.resolve(count >= 3);
    });

    await expect(waitUntil(condition, { maxAttempts: 5, intervalMs: 0 })).resolves.toBeUndefined();
    expect(condition).toHaveBeenCalledTimes(3);
  });

  it('throws if condition never becomes true within maxAttempts', async () => {
    const condition = jest.fn().mockResolvedValue(false);

    await expect(
      waitUntil(condition, { maxAttempts: 2, intervalMs: 0, description: 'test condition' })
    ).rejects.toThrow('test condition');
  });
});

describe('tests/e2e/helpers/retry.js — computeBackoff()', () => {
  const { computeBackoff } = require('../e2e/helpers/retry');

  it('returns a value between 0 and the computed exponential cap', () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const delay = computeBackoff(attempt, 100, 10000);
      expect(delay).toBeGreaterThanOrEqual(0);
      const cap = Math.min(100 * Math.pow(2, attempt - 1), 10000);
      expect(delay).toBeLessThanOrEqual(cap);
    }
  });

  it('never exceeds maxDelayMs', () => {
    const delay = computeBackoff(10, 1000, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });
});

// ─── Testnet Helper Exports ───────────────────────────────────────────────────

describe('tests/e2e/helpers/testnet.js — exported API', () => {
  it('exports all required functions', () => {
    const testnet = require('../e2e/helpers/testnet');
    const required = [
      'createTestnetService',
      'generateKeypair',
      'fundAccount',
      'createFundedAccount',
      'waitForBalance',
      'seedUser',
      'createFundedUser',
    ];
    for (const fn of required) {
      expect(typeof testnet[fn]).toBe('function');
    }
  });

  it('generateKeypair() returns a valid Stellar keypair shape', () => {
    const { generateKeypair } = require('../e2e/helpers/testnet');
    const kp = generateKeypair();

    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.secretKey).toBe('string');
    // Stellar public keys start with G and are 56 chars
    expect(kp.publicKey).toMatch(/^G[A-Z0-9]{55}$/);
    // Stellar secret keys start with S and are 56 chars
    expect(kp.secretKey).toMatch(/^S[A-Z0-9]{55}$/);
  });

  it('createTestnetService() returns a StellarService instance', () => {
    const { createTestnetService } = require('../e2e/helpers/testnet');
    const StellarService = require('../../src/services/StellarService');
    const svc = createTestnetService();
    expect(svc).toBeInstanceOf(StellarService);
    expect(svc.network).toBe('testnet');
  });
});

// ─── CI Workflow ──────────────────────────────────────────────────────────────

describe('.github/workflows/e2e-nightly.yml — CI configuration', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(
      path.join(ROOT, '.github/workflows/e2e-nightly.yml'),
      'utf8'
    );
  });

  it('has a nightly schedule trigger', () => {
    expect(content).toMatch(/schedule/);
    expect(content).toMatch(/cron/);
  });

  it('has a workflow_dispatch trigger for manual runs', () => {
    expect(content).toMatch(/workflow_dispatch/);
  });

  it('sets MOCK_STELLAR to false', () => {
    expect(content).toMatch(/MOCK_STELLAR.*false/);
  });

  it('targets the Stellar testnet', () => {
    expect(content).toMatch(/STELLAR_ENVIRONMENT.*testnet/);
  });

  it('references the E2E_ENCRYPTION_KEY secret', () => {
    expect(content).toMatch(/E2E_ENCRYPTION_KEY/);
  });

  it('runs npm run test:e2e', () => {
    expect(content).toMatch(/npm run test:e2e/);
  });

  it('has a failure notification step', () => {
    expect(content).toMatch(/if.*failure/);
  });
});

// ─── Documentation ────────────────────────────────────────────────────────────

describe('docs/features/ADD_ENDTOEND_TEST_SUITE_WITH_REAL_STELLAR_TESTNET.md', () => {
  let content;

  beforeAll(() => {
    content = fs.readFileSync(
      path.join(ROOT, 'docs/features/ADD_ENDTOEND_TEST_SUITE_WITH_REAL_STELLAR_TESTNET.md'),
      'utf8'
    );
  });

  it('documents how to run the e2e suite locally', () => {
    expect(content).toMatch(/npm run test:e2e/);
  });

  it('documents required environment variables', () => {
    expect(content).toMatch(/MOCK_STELLAR/);
    expect(content).toMatch(/ENCRYPTION_KEY/);
  });

  it('mentions Friendbot', () => {
    expect(content).toMatch(/[Ff]riendbot/);
  });

  it('describes retry logic', () => {
    expect(content).toMatch(/[Rr]etry/);
  });
});

// ─── package.json script ──────────────────────────────────────────────────────

describe('package.json — test:e2e script', () => {
  it('has a test:e2e script that invokes jest with the e2e config', () => {
    const pkg = require('../../package.json');
    expect(pkg.scripts['test:e2e']).toBeDefined();
    expect(pkg.scripts['test:e2e']).toMatch(/jest.*e2e/);
  });
});
