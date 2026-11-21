'use strict';

/**
 * Tests for #1234 — Comprehensive startup configuration validation.
 *
 * Verifies that src/utils/startupChecks.js fails fast (and with an actionable
 * message naming the offending variable) for:
 *  - Horizon URL format / protocol policy
 *  - DB path existence & writability
 *  - Stellar signing-key presence/validity
 *  - Numeric ranges for pool sizes and timeouts
 *  - Mutually-exclusive / co-required flags
 * and that optional misconfiguration warns rather than aborting.
 */

const crypto = require('crypto');

const VALID_KEY = crypto.randomBytes(32).toString('hex');
const VALID_STELLAR_SECRET = 'S' + 'A'.repeat(55); // valid 56-char StrKey (base32 A-Z,2-7)

const originalEnv = { ...process.env };

let checksModule = null;

function restoreEnv() {
  Object.keys(process.env).forEach(k => { if (!(k in originalEnv)) delete process.env[k]; });
  Object.assign(process.env, originalEnv);
}

async function runChecks(envOverrides = {}) {
  Object.assign(process.env, envOverrides);
  if (!checksModule) {
    checksModule = require('../../src/utils/startupChecks');
  }
  // run() appends to the module-level results array — clear it between runs.
  checksModule.results.length = 0;
  return checksModule.run({ exitOnFailure: false });
}

function result(results, name) {
  return results.find(r => r.name === name);
}

describe('#1234 — startup configuration validation', () => {
  beforeEach(() => {
    restoreEnv();
    // Baseline: a fully valid configuration so only the var under test fails.
    process.env.API_KEYS = 'test-key';
    process.env.ENCRYPTION_KEY = VALID_KEY;
    process.env.NODE_ENV = 'development';
    process.env.MOCK_STELLAR = 'true';
    delete process.env.HORIZON_URL;
    delete process.env.SIGNING_PROVIDER;
    delete process.env.STELLAR_ENVIRONMENT;
    delete process.env.STELLAR_NETWORK;
  });

  afterEach(() => {
    restoreEnv();
  });

  // ── Horizon URL format & reachability policy ────────────────────────────────

  test('passes when HORIZON_URL is not set (network default used)', async () => {
    const { passed, results } = await runChecks();
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('fails when HORIZON_URL is not a valid URL', async () => {
    const { passed, results } = await runChecks({ HORIZON_URL: 'not-a-url' });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.name).toBe('HORIZON_URL'); // names the offending variable
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('valid URL');
    expect(r.detail).toContain('not-a-url');
    expect(passed).toBe(false);
  });

  test('fails when HORIZON_URL uses a non-http(s) scheme', async () => {
    const { results } = await runChecks({ HORIZON_URL: 'ftp://horizon.stellar.org' });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('http(s)');
  });

  test('fails when HORIZON_URL is plaintext http in production', async () => {
    const { passed, results } = await runChecks({
      NODE_ENV: 'production',
      HORIZON_URL: 'http://horizon.example.com',
    });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('https');
    expect(passed).toBe(false);
  });

  test('passes when HORIZON_URL is https in production and matches the network', async () => {
    const { passed, results } = await runChecks({
      NODE_ENV: 'production',
      STELLAR_NETWORK: 'mainnet',
      HORIZON_URL: 'https://horizon.stellar.org',
    });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('passes when HORIZON_URL matches the canonical URL for the network', async () => {
    const { results } = await runChecks({ HORIZON_URL: 'https://horizon-testnet.stellar.org' });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
  });

  test('warns when HORIZON_URL overrides the canonical URL for the network', async () => {
    const { passed, results } = await runChecks({ HORIZON_URL: 'https://custom.example.com' });
    const r = result(results, 'HORIZON_URL');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('does not match');
    expect(passed).toBe(true);
  });

  // ── Database path & permissions ─────────────────────────────────────────────

  test('passes when DB_PATH points to an existing writable database', async () => {
    const { passed, results } = await runChecks();
    const r = result(results, 'Database path');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('fails when the DB_PATH parent directory does not exist', async () => {
    const missing = '/nonexistent-dir-xyz-1234/donations.db';
    const { passed, results } = await runChecks({ DB_PATH: missing });
    const r = result(results, 'Database path');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('DB_PATH');
    expect(r.detail).toContain('does not exist');
    expect(passed).toBe(false);
  });

  test('passes for an in-memory database (path checks skipped)', async () => {
    const { passed, results } = await runChecks({ DB_PATH: ':memory:' });
    const r = result(results, 'Database path');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  // ── Signing key presence / validity ─────────────────────────────────────────

  test('fails when SERVICE_SECRET_KEY is not a valid Stellar secret key', async () => {
    const { passed, results } = await runChecks({ SERVICE_SECRET_KEY: 'invalid-key' });
    const r = result(results, 'SERVICE_SECRET_KEY');
    expect(r).toBeDefined();
    expect(r.name).toBe('SERVICE_SECRET_KEY'); // names the offending variable
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('Stellar secret key');
    expect(passed).toBe(false);
  });

  test('passes when SERVICE_SECRET_KEY is a valid Stellar secret key', async () => {
    const { passed, results } = await runChecks({ SERVICE_SECRET_KEY: VALID_STELLAR_SECRET });
    const r = result(results, 'SERVICE_SECRET_KEY');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('fails when STELLAR_SECRET (legacy alias) is malformed', async () => {
    const { results } = await runChecks({ STELLAR_SECRET: 'tooshort' });
    const r = result(results, 'STELLAR_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('fails when SPONSOR_SECRET is malformed', async () => {
    const { results } = await runChecks({ SPONSOR_SECRET: 'not-a-secret' });
    const r = result(results, 'SPONSOR_SECRET');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
  });

  test('warns (does not fail) when a signing key is absent in production on a live network', async () => {
    const { passed, results } = await runChecks({
      NODE_ENV: 'production',
      MOCK_STELLAR: 'false',
      SERVICE_SECRET_KEY: '',
    });
    const r = result(results, 'SERVICE_SECRET_KEY');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(passed).toBe(true);
  });

  // ── Numeric ranges (pools / timeouts) ───────────────────────────────────────

  test('fails when DB_POOL_SIZE is not a positive integer (consumer throws)', async () => {
    const { passed, results } = await runChecks({ DB_POOL_SIZE: 'abc' });
    const r = result(results, 'DB_POOL_SIZE');
    expect(r).toBeDefined();
    expect(r.name).toBe('DB_POOL_SIZE'); // names the offending variable
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('positive integer');
    expect(passed).toBe(false);
  });

  test('fails when PORT is outside the valid range', async () => {
    const { results } = await runChecks({ PORT: '99999' });
    const r = result(results, 'PORT');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('1 and 65535');
  });

  test('warns (does not fail) when HORIZON_POOL_SIZE is out of range', async () => {
    const { passed, results } = await runChecks({ HORIZON_POOL_SIZE: '0' });
    const r = result(results, 'HORIZON_POOL_SIZE');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(passed).toBe(true);
  });

  test('warns when DB_POOL_MIN exceeds DB_POOL_MAX', async () => {
    const { passed, results } = await runChecks({ DB_POOL_MIN: '10', DB_POOL_MAX: '5' });
    const r = result(results, 'DB_POOL_MIN');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('DB_POOL_MAX');
    expect(passed).toBe(true);
  });

  test('does not warn for a coherent pool configuration', async () => {
    const { passed, results } = await runChecks({ DB_POOL_MIN: '2', DB_POOL_MAX: '8' });
    expect(result(results, 'DB_POOL_MIN')).toBeUndefined();
    expect(result(results, 'DB_POOL_MAX')).toBeUndefined();
    expect(passed).toBe(true);
  });

  // ── Mutually-exclusive / co-required flags ──────────────────────────────────

  test('fails when SIGNING_PROVIDER=hsm is missing HSM credentials', async () => {
    const { passed, results } = await runChecks({ SIGNING_PROVIDER: 'hsm' });
    const r = result(results, 'SIGNING_PROVIDER');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('HSM_SLOT_ID');
    expect(r.detail).toContain('HSM_PIN');
    expect(passed).toBe(false);
  });

  test('passes when SIGNING_PROVIDER=hsm has HSM credentials', async () => {
    const { passed, results } = await runChecks({
      SIGNING_PROVIDER: 'hsm',
      HSM_SLOT_ID: '0',
      HSM_PIN: '1234',
    });
    const r = result(results, 'SIGNING_PROVIDER');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('fails when SIGNING_PROVIDER=kms is missing KMS credentials', async () => {
    const { results } = await runChecks({ SIGNING_PROVIDER: 'kms' });
    const r = result(results, 'SIGNING_PROVIDER');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('KMS_PROVIDER');
    expect(r.detail).toContain('KMS_KEY_ID');
  });

  test('fails when SIGNING_PROVIDER is an unknown backend', async () => {
    const { results } = await runChecks({ SIGNING_PROVIDER: 'banana' });
    const r = result(results, 'SIGNING_PROVIDER');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('local, hsm, kms');
  });

  test('fails when REQUIRE_REQUEST_SIGNING=true without REQUEST_SIGNING_SECRET', async () => {
    const { passed, results } = await runChecks({ REQUIRE_REQUEST_SIGNING: 'true' });
    const r = result(results, 'REQUIRE_REQUEST_SIGNING');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('REQUEST_SIGNING_SECRET');
    expect(passed).toBe(false);
  });

  test('fails when RATE_LIMIT_STORE=redis without REDIS_URL', async () => {
    const { passed, results } = await runChecks({ RATE_LIMIT_STORE: 'redis' });
    const r = result(results, 'RATE_LIMIT_STORE');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('REDIS_URL');
    expect(passed).toBe(false);
  });

  test('passes when RATE_LIMIT_STORE=redis has REDIS_URL', async () => {
    const { passed, results } = await runChecks({
      RATE_LIMIT_STORE: 'redis',
      REDIS_URL: 'redis://localhost:6379',
    });
    const r = result(results, 'RATE_LIMIT_STORE');
    expect(r).toBeDefined();
    expect(r.status).toBe('pass');
    expect(passed).toBe(true);
  });

  test('fails when RATE_LIMIT_STORE is an unknown store', async () => {
    const { results } = await runChecks({ RATE_LIMIT_STORE: 'postgres' });
    const r = result(results, 'RATE_LIMIT_STORE');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('memory, redis');
  });

  test('fails when ENCRYPTION_KEY_VERSION=1 without ENCRYPTION_KEY_1', async () => {
    const { passed, results } = await runChecks({ ENCRYPTION_KEY_VERSION: '1' });
    const r = result(results, 'ENCRYPTION_KEY_VERSION');
    expect(r).toBeDefined();
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('ENCRYPTION_KEY_1');
    expect(passed).toBe(false);
  });

  test('warns (does not fail) when MOCK_STELLAR=true in production', async () => {
    const { passed, results } = await runChecks({ NODE_ENV: 'production' });
    const r = result(results, 'MOCK_STELLAR');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(passed).toBe(true);
  });

  test('warns when STELLAR_ENVIRONMENT and STELLAR_NETWORK disagree', async () => {
    const { passed, results } = await runChecks({
      STELLAR_ENVIRONMENT: 'mainnet',
      STELLAR_NETWORK: 'testnet',
    });
    const r = result(results, 'STELLAR_ENVIRONMENT');
    expect(r).toBeDefined();
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('STELLAR_NETWORK');
    expect(passed).toBe(true);
  });

  // ── Exit behaviour ──────────────────────────────────────────────────────────

  test('exits with a non-zero code when required config is invalid and exitOnFailure=true', async () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    try {
      delete process.env.ENCRYPTION_KEY;
      if (!checksModule) checksModule = require('../../src/utils/startupChecks');
      checksModule.results.length = 0;
      const { passed } = await checksModule.run({ exitOnFailure: true });
      expect(passed).toBe(false);
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      exitSpy.mockRestore();
    }
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  test('passes when all required configuration is valid', async () => {
    const { passed, results } = await runChecks();
    expect(passed).toBe(true);
    const failures = results.filter(r => r.status === 'fail');
    expect(failures).toEqual([]);
  });
});
