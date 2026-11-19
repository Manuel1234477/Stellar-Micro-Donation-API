'use strict';

/**
 * Mock Stellar mode in production is fatal unless ALLOW_MOCK_STELLAR_IN_PRODUCTION=true (#1984).
 */
// The guard does not use the SDK; stub the wrapper so this suite does not load
// the ESM-only Stellar SDK chain under Jest.
jest.mock('../../src/services/stellar/sdk', () => ({}), { virtual: false });

describe('checkMainnetProductionGuard — mock Stellar in production', () => {
  const SAVED = { ...process.env };

  beforeEach(() => {
    jest.resetModules();
    for (const k of ['MOCK_STELLAR', 'USE_MOCK_STELLAR', 'STELLAR_NETWORK', 'STELLAR_ENVIRONMENT', 'ALLOW_TESTNET_IN_PRODUCTION', 'ALLOW_MOCK_STELLAR_IN_PRODUCTION']) delete process.env[k];
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => { process.env = SAVED; });

  const guard = () => require('../../src/utils/startupChecks').checkMainnetProductionGuard();

  test('mock mode in production fails startup without the explicit override', () => {
    process.env.MOCK_STELLAR = 'true';
    process.env.STELLAR_NETWORK = 'mainnet';
    expect(guard()).toBe(false);
  });

  test('the explicit ALLOW_MOCK_STELLAR_IN_PRODUCTION override permits it', () => {
    process.env.MOCK_STELLAR = 'true';
    process.env.ALLOW_MOCK_STELLAR_IN_PRODUCTION = 'true';
    expect(guard()).toBe(true);
  });

  test('the testnet override does not unlock mock mode', () => {
    process.env.MOCK_STELLAR = 'true';
    process.env.ALLOW_TESTNET_IN_PRODUCTION = 'true';
    expect(guard()).toBe(false);
  });

  test('USE_MOCK_STELLAR alone does not trigger the production guard', () => {
    process.env.USE_MOCK_STELLAR = 'true';
    process.env.STELLAR_NETWORK = 'mainnet';
    expect(guard()).toBe(true);
  });
});
