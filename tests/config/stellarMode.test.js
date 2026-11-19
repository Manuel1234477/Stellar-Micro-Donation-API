'use strict';

describe('stellarMode (#1984)', () => {
  const SAVED = { ...process.env };
  let mode;

  beforeEach(() => {
    jest.resetModules();
    for (const k of ['MOCK_STELLAR', 'USE_MOCK_STELLAR', 'STELLAR_NETWORK', 'STELLAR_ENVIRONMENT', 'ALLOW_MOCK_STELLAR_IN_PRODUCTION']) delete process.env[k];
    mode = require('../../src/config/stellarMode');
  });

  afterAll(() => { process.env = SAVED; });

  test('MOCK_STELLAR=true selects mock mode', () => {
    process.env.MOCK_STELLAR = 'true';
    expect(mode.isMockStellarEnabled()).toBe(true);
    expect(mode.getStellarMode()).toBe('mock');
  });

  test('USE_MOCK_STELLAR is ignored: only MOCK_STELLAR controls mock mode', () => {
    process.env.USE_MOCK_STELLAR = 'true';
    expect(mode.isMockStellarEnabled()).toBe(false);
    expect(mode.getStellarMode()).toBe('testnet');
  });

  test('mainnet maps to public and other networks to testnet', () => {
    process.env.STELLAR_NETWORK = 'mainnet';
    expect(mode.getStellarMode()).toBe('public');
    process.env.STELLAR_NETWORK = 'futurenet';
    expect(mode.getStellarMode()).toBe('testnet');
  });

  test('the production override is opt-in only', () => {
    expect(mode.isMockStellarAllowedInProduction()).toBe(false);
    process.env.ALLOW_MOCK_STELLAR_IN_PRODUCTION = 'true';
    expect(mode.isMockStellarAllowedInProduction()).toBe(true);
  });
});
