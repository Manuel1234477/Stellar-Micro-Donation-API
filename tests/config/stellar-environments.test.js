/**
 * Tests: stellarEnvironments — Issue #713
 *
 * Verifies:
 *  - Correct default HORIZON_URL for each network (testnet/mainnet/futurenet)
 *  - STELLAR_NETWORK overrides STELLAR_ENVIRONMENT for URL selection
 *  - Warning emitted when HORIZON_URL override doesn't match expected URL
 *  - No warning when HORIZON_URL matches expected URL
 *  - Invalid STELLAR_ENVIRONMENT throws
 */

'use strict';

describe('stellarEnvironments — getActiveEnvironment()', () => {
  let getActiveEnvironment;

  // Save and restore env vars around each test
  const saved = {};
  const VARS = ['STELLAR_ENVIRONMENT', 'STELLAR_NETWORK', 'HORIZON_URL', 'NODE_ENV'];

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

  // ── Default URL per network ──────────────────────────────────────────────

  it('testnet: defaults horizonUrl to https://horizon-testnet.stellar.org', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(env.network).toBe('testnet');
  });

  it('mainnet: defaults horizonUrl to https://horizon.stellar.org', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.NODE_ENV = 'production';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon.stellar.org');
    expect(env.network).toBe('mainnet');
  });

  it('futurenet: defaults horizonUrl to https://horizon-futurenet.stellar.org', () => {
    process.env.STELLAR_ENVIRONMENT = 'futurenet';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon-futurenet.stellar.org');
    expect(env.network).toBe('futurenet');
  });

  // ── STELLAR_NETWORK overrides URL selection ──────────────────────────────

  it('STELLAR_NETWORK=futurenet overrides STELLAR_ENVIRONMENT=testnet for horizonUrl', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'futurenet';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon-futurenet.stellar.org');
    expect(env.network).toBe('futurenet');
  });

  it('STELLAR_NETWORK=mainnet overrides STELLAR_ENVIRONMENT=testnet for horizonUrl', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.STELLAR_NETWORK = 'mainnet';
    process.env.NODE_ENV = 'production';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://horizon.stellar.org');
    expect(env.network).toBe('mainnet');
  });

  // ── Mismatch warning ─────────────────────────────────────────────────────

  it('emits a warning when HORIZON_URL does not match the expected URL for the network', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.HORIZON_URL = 'https://horizon.stellar.org'; // mainnet URL on testnet
    getActiveEnvironment();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not match')
    );
  });

  it('emits no warning when HORIZON_URL matches the expected URL for the network', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.HORIZON_URL = 'https://horizon-testnet.stellar.org';
    getActiveEnvironment();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('emits no warning when HORIZON_URL is not set', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    getActiveEnvironment();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('warning message includes the override URL, network name, and expected URL', () => {
    process.env.STELLAR_ENVIRONMENT = 'futurenet';
    process.env.HORIZON_URL = 'https://custom.horizon.example.com';
    getActiveEnvironment();
    const msg = console.warn.mock.calls[0][0];
    expect(msg).toContain('https://custom.horizon.example.com');
    expect(msg).toContain('futurenet');
    expect(msg).toContain('https://horizon-futurenet.stellar.org');
  });

  // ── HORIZON_URL override is respected ────────────────────────────────────

  it('uses the explicit HORIZON_URL override even when it mismatches', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.HORIZON_URL = 'https://my-custom-horizon.example.com';
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('https://my-custom-horizon.example.com');
  });

  // ── Invalid STELLAR_ENVIRONMENT ──────────────────────────────────────────

  it('throws for an unknown STELLAR_ENVIRONMENT value', () => {
    process.env.STELLAR_ENVIRONMENT = 'devnet';
    expect(() => getActiveEnvironment()).toThrow(/Invalid STELLAR_ENVIRONMENT/);
  });

  it('error message lists all valid options', () => {
    process.env.STELLAR_ENVIRONMENT = 'devnet';
    expect(() => getActiveEnvironment()).toThrow(/testnet.*mainnet.*futurenet/);
  });
});
