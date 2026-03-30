/**
 * Test Suite: Stellar Environment configurations
 * Asserts predefined properties are generated conditionally and restricts
 * explicit access configurations properly.
 */

const { getActiveEnvironment } = require('../src/config/stellarEnvironments');
const MockStellarService = require('../src/services/MockStellarService');

describe('Stellar Testnet/Mainnet Environment Switching', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('should return testnet presets correctly', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    const env = getActiveEnvironment();
    
    expect(env.environment).toBe('testnet');
    expect(env.network).toBe('testnet');
    expect(env.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(env.networkPassphrase).toContain('Test SDF Network');
    expect(env.baseReserve).toBe('0.5');
    expect(env.feeMultiplier).toBe(100);
  });

  test('should return mainnet presets correctly (non-test safety check)', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.NODE_ENV = 'production'; // Safely mock out of testing context
    const env = getActiveEnvironment();
    
    expect(env.environment).toBe('mainnet');
    expect(env.network).toBe('mainnet');
    expect(env.horizonUrl).toBe('https://horizon.stellar.org');
    expect(env.networkPassphrase).toContain('Public Global Stellar Network');
  });

  test('should explicitly throw error configuring mainnet while in NODE_ENV=test', () => {
    process.env.STELLAR_ENVIRONMENT = 'mainnet';
    process.env.NODE_ENV = 'test';
    
    expect(() => {
      getActiveEnvironment();
    }).toThrow('SECURITY BLOCK: Mainnet operations are explicitly prevented');
  });

  test('should throw error for invalid environment names', () => {
    process.env.STELLAR_ENVIRONMENT = 'devnet';
    expect(() => {
      getActiveEnvironment();
    }).toThrow("Invalid STELLAR_ENVIRONMENT provided: 'devnet'. Must be strictly 'testnet' or 'mainnet'.");
  });

  test('should fallback to testnet if no variable is provided', () => {
    delete process.env.STELLAR_ENVIRONMENT;
    const env = getActiveEnvironment();
    expect(env.environment).toBe('testnet');
  });

  test('should allow explicit CLI priority overrides to standard settings natively', () => {
    process.env.STELLAR_ENVIRONMENT = 'testnet';
    process.env.HORIZON_URL = 'http://localhost:8000';
    process.env.STELLAR_FEE_MULTIPLIER = '250';
    
    const env = getActiveEnvironment();
    expect(env.horizonUrl).toBe('http://localhost:8000');
    expect(env.feeMultiplier).toBe(250);
  });

  test('Instantiate MockStellarService correctly allowing local transactions testing securely', () => {
    const mService = new MockStellarService();
    expect(mService).not.toBeNull();
  });
});
