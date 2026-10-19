/**
 * Tests: stellarEnvironments — Issue #1341
 *
 * The mainnet-in-test security guard in getActiveEnvironment() previously checked
 * only envName (derived from STELLAR_ENVIRONMENT).  However, resolvedNetwork
 * (derived from STELLAR_NETWORK, which takes precedence) is the value actually
 * used to resolve horizonUrl.  Setting STELLAR_ENVIRONMENT=testnet together with
 * STELLAR_NETWORK=mainnet while NODE_ENV=test would silently bypass the guard
 * while routing every SDK call to the real mainnet Horizon endpoint.
 *
 * Fix verified:
 *  1. STELLAR_NETWORK=mainnet + NODE_ENV=test throws regardless of STELLAR_ENVIRONMENT.
 *  2. STELLAR_ENVIRONMENT=mainnet + NODE_ENV=test still throws (existing behaviour).
 *  3. The bypass combination (STELLAR_ENVIRONMENT=testnet + STELLAR_NETWORK=mainnet
 *     + NODE_ENV=test) is now blocked.
 *  4. Invalid STELLAR_NETWORK values are rejected with a clear error message.
 *  5. When STELLAR_NETWORK overrides STELLAR_ENVIRONMENT, networkPassphrase,
 *     baseReserve, and feeMultiplier are taken from the resolvedNetwork preset so
 *     the returned config is internally consistent.
 *
 * Closes #1341
 */

'use strict';

describe('stellarEnvironments — issue #1341 mainnet-in-test security guard', () => {
  let getActiveEnvironment;

  const VARS = ['STELLAR_ENVIRONMENT', 'STELLAR_NETWORK', 'HORIZON_URL', 'NODE_ENV'];
  const saved = {};

  beforeEach(() => {
    VARS.forEach(k => { saved[k] = process.env[k]; delete process.env[k]; });
    jest.resetModules();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    ({ getActiveEnvironment } = require('../../src/config/stellarEnvironments'));
  });

  afterEach(() => {
    VARS.forEach(k => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
    jest.restoreAllMocks();
  });

  // ── Core bypass scenario (the actual bug) ────────────────────────────────

  it('throws when STELLAR_ENVIRONMENT=testnet + STELLAR_NETWORK=mainnet + NODE_ENV=test (bypass scenario)', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'test';

    expect(() => getActiveEnvironment()).toThrow(/SECURITY BLOCK/);
  });

  it('error message mentions NODE_ENV=test in the bypass scenario', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'test';

    expect(() => getActiveEnvironment()).toThrow(/test/);
  });

  // ── Existing guard still works ───────────────────────────────────────────

  it('throws when STELLAR_ENVIRONMENT=mainnet + NODE_ENV=test (original guard)', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.NODE_ENV = 'test';

    expect(() => getActiveEnvironment()).toThrow(/SECURITY BLOCK/);
  });

  it('throws when both STELLAR_ENVIRONMENT=mainnet and STELLAR_NETWORK=mainnet + NODE_ENV=test', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'test';

    expect(() => getActiveEnvironment()).toThrow(/SECURITY BLOCK/);
  });

  // ── Futurenet bypass variant ──────────────────────────────────────────────

  it('throws when STELLAR_ENVIRONMENT=futurenet + STELLAR_NETWORK=mainnet + NODE_ENV=test', () => {
    process.env.STELLAR_ENVIRONMENT = 'futurenet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'test';

    expect(() => getActiveEnvironment()).toThrow(/SECURITY BLOCK/);
  });

  // ── Non-test environments are allowed ────────────────────────────────────

  it('allows STELLAR_ENVIRONMENT=mainnet in production', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.NODE_ENV = 'production';

    expect(() => getActiveEnvironment()).not.toThrow();
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon.stellar.org');
  });

  it('allows STELLAR_NETWORK=mainnet in production', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'production';

    expect(() => getActiveEnvironment()).not.toThrow();
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon.stellar.org');
  });

  it('allows STELLAR_ENVIRONMENT=mainnet when NODE_ENV is undefined', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    // NODE_ENV not set

    expect(() => getActiveEnvironment()).not.toThrow();
  });

  // ── STELLAR_NETWORK validation ────────────────────────────────────────────

  it('throws for an unknown STELLAR_NETWORK value', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'devnet';

    expect(() => getActiveEnvironment()).toThrow(/Invalid STELLAR_NETWORK/);
  });

  it('error message for invalid STELLAR_NETWORK lists valid options', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'devnet';

    expect(() => getActiveEnvironment()).toThrow(/testnet.*mainnet.*futurenet/);
  });

  // ── Config consistency when STELLAR_NETWORK overrides STELLAR_ENVIRONMENT ─

  it('networkPassphrase matches resolvedNetwork when STELLAR_NETWORK overrides STELLAR_ENVIRONMENT', () => {
    // STELLAR_ENVIRONMENT=testnet + STELLAR_NETWORK=futurenet in non-test
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'futurenet';

    const env = getActiveEnvironment();

    // passphrase must be the futurenet one, not testnet
    expect(env.networkPassphrase).toBe('Test SDF Future Network ; October 2022');
    expect(env.network).toBe('futurenet');
    expect(env.horizonUrl).toBe('https://horizon-futurenet.stellar.org');
  });

  it('networkPassphrase is testnet when STELLAR_ENVIRONMENT=testnet (no STELLAR_NETWORK override)', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';

    const env = getActiveEnvironment();
    expect(env.networkPassphrase).toBe('Test SDF Network ; September 2015');
    expect(env.network).toBe('testnet');
  });

  it('returns environment field equal to envName (STELLAR_ENVIRONMENT) for traceability', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'futurenet';

    const env = getActiveEnvironment();
    // environment reflects the raw STELLAR_ENVIRONMENT value
    expect(env.environment).toBe('testnet');
    // but network and horizonUrl reflect the resolved (override) network
    expect(env.network).toBe('futurenet');
  });
});
