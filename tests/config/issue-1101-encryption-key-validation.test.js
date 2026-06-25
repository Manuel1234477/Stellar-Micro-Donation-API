/**
 * Tests for Issue #1101: ENCRYPTION_KEY validation
 *
 * Verifies that startup fails fast with actionable error when ENCRYPTION_KEY is:
 * - Missing
 * - Too short
 * - Too long
 * - Contains non-hex characters
 */

'use strict';

describe('Issue #1101 — ENCRYPTION_KEY validation in startupChecks', () => {
  let origEncryptionKey;
  let origApiKeys;

  beforeEach(() => {
    origEncryptionKey = process.env.ENCRYPTION_KEY;
    origApiKeys = process.env.API_KEYS;
    // Set a valid API_KEYS to avoid that check from failing
    process.env.API_KEYS = 'test-key';
  });

  afterEach(() => {
    if (origEncryptionKey !== undefined) {
      process.env.ENCRYPTION_KEY = origEncryptionKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    if (origApiKeys !== undefined) {
      process.env.API_KEYS = origApiKeys;
    } else {
      delete process.env.API_KEYS;
    }
    jest.resetModules();
  });

  test('fails when ENCRYPTION_KEY is missing', async () => {
    delete process.env.ENCRYPTION_KEY;

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('fail');
    expect(encKeyResult.detail).toContain('required but not set');
    expect(encKeyResult.detail).toContain('npm run generate-key');
    expect(passed).toBe(false);
  });

  test('fails when ENCRYPTION_KEY is too short (less than 64 chars)', async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef'; // 16 chars

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('fail');
    expect(encKeyResult.detail).toContain('64 hex characters');
    expect(encKeyResult.detail).toContain('16');
    expect(passed).toBe(false);
  });

  test('fails when ENCRYPTION_KEY is too long (more than 64 chars)', async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef' + '0123456789abcdef' + '0123456789abcdef' + '0123456789abcdef' + 'extra';

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('fail');
    expect(encKeyResult.detail).toContain('64 hex characters');
    expect(passed).toBe(false);
  });

  test('fails when ENCRYPTION_KEY contains non-hex characters', async () => {
    // 64 chars but contains 'G', 'H', 'Z' which are not hex
    process.env.ENCRYPTION_KEY = 'GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG';

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('fail');
    expect(encKeyResult.detail).toContain('hexadecimal');
    expect(passed).toBe(false);
  });

  test('passes when ENCRYPTION_KEY is exactly 64 hex characters (lowercase)', async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef' + '0123456789abcdef' + '0123456789abcdef' + '0123456789abcdef';

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('pass');
    expect(encKeyResult.detail).toContain('64 hex chars');
  });

  test('passes when ENCRYPTION_KEY is exactly 64 hex characters (uppercase)', async () => {
    process.env.ENCRYPTION_KEY = '0123456789ABCDEF' + '0123456789ABCDEF' + '0123456789ABCDEF' + '0123456789ABCDEF';

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('pass');
  });

  test('passes when ENCRYPTION_KEY is exactly 64 hex characters (mixed case)', async () => {
    process.env.ENCRYPTION_KEY = '0123456789abcdef' + '0123456789ABCDEF' + '0123456789abcdef' + '0123456789ABCDEF';

    const { run } = require('../../src/utils/startupChecks');

    const { passed, results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult).toBeDefined();
    expect(encKeyResult.status).toBe('pass');
  });

  test('error message references npm run generate-key for missing key', async () => {
    delete process.env.ENCRYPTION_KEY;

    const { run } = require('../../src/utils/startupChecks');

    const { results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult.detail).toMatch(/npm run generate-key/);
  });

  test('error message references npm run generate-key for malformed key', async () => {
    process.env.ENCRYPTION_KEY = 'invalid_key';

    const { run } = require('../../src/utils/startupChecks');

    const { results } = await run({ exitOnFailure: false });

    const encKeyResult = results.find(r => r.name === 'ENCRYPTION_KEY');
    expect(encKeyResult.detail).toMatch(/npm run generate-key/);
  });
});
