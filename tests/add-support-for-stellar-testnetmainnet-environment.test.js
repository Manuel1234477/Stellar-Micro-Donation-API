const { STELLAR_ENVIRONMENTS, getStellarEnvironment } = require('../src/config/stellarEnvironments');
const { ConfigurationError } = require('../src/config');
const HealthCheckService = require('../src/services/HealthCheckService');

// Mock dependencies
jest.mock('../src/constants', () => ({
  HORIZON_URLS: {
    TESTNET: 'https://horizon-testnet.stellar.org',
    MAINNET: 'https://horizon.stellar.org',
    FUTURENET: 'https://horizon-futurenet.stellar.org'
  },
  VALID_STELLAR_NETWORKS: ['testnet', 'mainnet', 'futurenet']
}));

describe('Stellar Environment Switching', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('stellarEnvironments.js', () => {
    it('should return testnet config by default if not specified', () => {
      const config = getStellarEnvironment();
      expect(config.name).toBe('testnet');
      expect(config.horizonUrl).toBe('https://horizon-testnet.stellar.org');
      expect(config.baseFee).toBe(100);
    });

    it('should return testnet config explicitly', () => {
      const config = getStellarEnvironment('testnet');
      expect(config.name).toBe('testnet');
      expect(config.networkPassphrase).toContain('Test SDF Network');
    });

    it('should return mainnet config', () => {
      const config = getStellarEnvironment('mainnet');
      expect(config.name).toBe('mainnet');
      expect(config.horizonUrl).toBe('https://horizon.stellar.org');
      expect(config.networkPassphrase).toContain('Public Global Stellar Network');
    });

    it('should fallback to testnet for unknown environment', () => {
      const config = getStellarEnvironment('invalid_env');
      expect(config.name).toBe('testnet');
    });
  });

  describe('config/index.js Parsing', () => {
    it('uses STELLAR_ENVIRONMENT if provided', () => {
      process.env.STELLAR_ENVIRONMENT = 'mainnet';
      process.env.NODE_ENV = 'production'; // bypass test protections
      process.env.API_KEYS = 'test-key';
      process.env.ENCRYPTION_KEY = 'test-encryption-key-which-is-long-enough';
      
      const config = require('../src/config');
      expect(config.stellar.network).toBe('mainnet');
      expect(config.stellar.horizonUrl).toBe('https://horizon.stellar.org');
      expect(config.stellar.environment.baseFee).toBe(100);
    });

    it('prevents mainnet operations in test environment', () => {
      process.env.NODE_ENV = 'test';
      process.env.STELLAR_ENVIRONMENT = 'mainnet';
      process.env.API_KEYS = 'test-key';
      
      const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1) was called');
      });
      const consoleErrorMock = jest.spyOn(console, 'error').mockImplementation(() => {});
      
      try {
        expect(() => {
          require('../src/config');
        }).toThrow('process.exit(1) was called');
        
        expect(consoleErrorMock).toHaveBeenCalledWith(
          expect.stringContaining('CRITICAL: Mainnet operations are strictly prevented when NODE_ENV=test.')
        );
      } finally {
        exitMock.mockRestore();
        consoleErrorMock.mockRestore();
      }
    });
  });

  describe('HealthCheckService integration', () => {
    it('includes environment indicator in health check payload', async () => {
      const mockStellarService = {
        server: {
          root: jest.fn().mockResolvedValue(true)
        },
        getNetwork: () => 'testnet',
        getEnvironment: () => ({ name: 'testnet' }),
        getHorizonUrl: () => 'https://horizon-testnet.mock.org'
      };

      const result = await HealthCheckService.checkStellar(mockStellarService);
      
      expect(result.status).toBe('healthy');
      expect(result.network).toBe('testnet');
      expect(result.environment).toBe('testnet');
      expect(result.horizonUrl).toBe('https://horizon-testnet.mock.org');
    });
  });
});
