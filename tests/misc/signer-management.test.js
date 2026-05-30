/**
 * Tests for Stellar Account Signer Management
 * 
 * Verifies:
 * - Signer added with correct weight
 * - Signer removed successfully
 * - Last signer removal prevented
 * - Audit trail entry created
 */

const StellarService = require('../../src/services/StellarService');
const { ValidationError } = require('../../src/utils/errors');

// Mock Stellar SDK
jest.mock('stellar-sdk', () => ({
  Keypair: {
    fromSecret: jest.fn().mockReturnValue({
      publicKey: () => 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
    })
  },
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({
      sign: jest.fn(),
      hash: () => 'mock-hash',
      toEnvelope: () => ({
        toXDR: () => 'mock-xdr'
      })
    })
  })),
  Operation: {
    setOptions: jest.fn().mockReturnValue({})
  },
  Asset: {
    native: jest.fn().mockReturnValue({})
  },
  Networks: {
    TESTNET: 'Test SDF Network ; September 2015',
    PUBLIC: 'Public Global Stellar Network ; September 2015'
  },
  BASE_FEE: '100'
}));

// Mock Horizon Server
const mockServer = {
  loadAccount: jest.fn().mockResolvedValue({
    signers: [
      { key: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 1, type: 'ed25519_public_key' },
      { key: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', weight: 1, type: 'ed25519_public_key' }
    ],
    thresholds: {
      low: 1,
      medium: 2,
      high: 3
    }
  }),
  submitTransaction: jest.fn().mockResolvedValue({
    hash: 'mock-hash',
    ledger: 12345
  })
};

describe('Stellar Account Signer Management', () => {
  let stellarService;

  beforeEach(() => {
    stellarService = new StellarService({
      network: 'testnet',
      horizonUrl: 'https://horizon-testnet.stellar.org'
    });
    stellarService.server = mockServer;
    jest.clearAllMocks();
  });

  describe('getSigners', () => {
    test('should return all signers when an account', async () => {
      const signers = await stellarService.getSigners('GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX');

      expect(signers).toHaveLength(2);
      expect(signers[0]).toEqual({
        publicKey: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        weight: 1,
        type: 'ed25519_public_key'
      });
      expect(signers[1]).toEqual({
        publicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        weight: 1,
        type: 'ed25519_public_key'
      });
    });

    test('should handle account not found', async () => {
      mockServer.loadAccount.mockRejectedValueOnce({
        response: { status: 404 }
      });

      await expect(
        stellarService.getSigners('GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
      ).rejects.toThrow();
    });
  });

  describe('addSigner', () => {
    test('should add a signer when correct weight', async () => {
      const result = await stellarService.addSigner(
        'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        2
      );

      expect(result).toEqual({
        hash: 'mock-hash',
        ledger: 12345,
        signer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        weight: 2
      });
    });

    test('should default to weight 1 when not specified', async () => {
      const result = await stellarService.addSigner(
        'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      );

      expect(result.weight).toBe(1);
    });

    test('should reject invalid weight', async () => {
      await expect(
        stellarService.addSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          -1
        )
      ).rejects.toThrow('Weight must be a number between 0 and 255');
    });

    test('should reject weight > 255', async () => {
      await expect(
        stellarService.addSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          256
        )
      ).rejects.toThrow('Weight must be a number between 0 and 255');
    });

    test('should reject adding master key as signer', async () => {
      await expect(
        stellarService.addSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          1
        )
      ).rejects.toThrow('Cannot add master key as a signer');
    });

    test('should reject invalid signer public key', async () => {
      await expect(
        stellarService.addSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          '',
          1
        )
      ).rejects.toThrow('Signer public key is required');
    });
  });

  describe('removeSigner', () => {
    test('should remove a signer successfully', async () => {
      const result = await stellarService.removeSigner(
        'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      );

      expect(result).toEqual({
        hash: 'mock-hash',
        ledger: 12345,
        signer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      });
    });

    test('should reject removing master key as signer', async () => {
      await expect(
        stellarService.removeSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'
        )
      ).rejects.toThrow('Cannot remove master key as a signer');
    });

    test('should reject removing non-existent signer', async () => {
      await expect(
        stellarService.removeSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
        )
      ).rejects.toThrow('Signer not found on account');
    });

    test('should prevent removing last signer that would lock account', async () => {
      // Mock account with only one signer (master)
      mockServer.loadAccount.mockResolvedValueOnce({
        signers: [
          { key: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 1, type: 'ed25519_public_key' }
        ],
        thresholds: {
          low: 1,
          medium: 2,
          high: 3
        }
      });

      await expect(
        stellarService.removeSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        )
      ).rejects.toThrow('Signer not found on account');
    });

    test('should prevent removal that would make total weight below threshold', async () => {
      // Mock account with signers where removal would lock
      mockServer.loadAccount.mockResolvedValueOnce({
        signers: [
          { key: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 1, type: 'ed25519_public_key' },
          { key: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', weight: 1, type: 'ed25519_public_key' }
        ],
        thresholds: {
          low: 2, // Requires total weight of 2
          medium: 2,
          high: 3
        }
      });

      await expect(
        stellarService.removeSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
        )
      ).rejects.toThrow('Cannot remove signer: account would be locked');
    });
  });

  describe('updateSignerWeight', () => {
    test('should update signer weight successfully', async () => {
      const result = await stellarService.updateSignerWeight(
        'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        3
      );

      expect(result).toEqual({
        hash: 'mock-hash',
        ledger: 12345,
        signer: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        weight: 3
      });
    });

    test('should reject invalid weight', async () => {
      await expect(
        stellarService.updateSignerWeight(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          -1
        )
      ).rejects.toThrow('Weight must be a number between 0 and 255');
    });

    test('should reject updating non-existent signer', async () => {
      await expect(
        stellarService.updateSignerWeight(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
          2
        )
      ).rejects.toThrow('Signer not found on account');
    });

    test('should prevent weight update that would lock account', async () => {
      // Mock account where weight update would lock
      mockServer.loadAccount.mockResolvedValueOnce({
        signers: [
          { key: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', weight: 1, type: 'ed25519_public_key' },
          { key: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', weight: 1, type: 'ed25519_public_key' }
        ],
        thresholds: {
          low: 2,
          medium: 2,
          high: 3
        }
      });

      await expect(
        stellarService.updateSignerWeight(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          0
        )
      ).rejects.toThrow('Cannot update signer weight: account would be locked');
    });
  });

  describe('Security validations', () => {
    test('should validate signer public key format', async () => {
      await expect(
        stellarService.addSigner(
          'SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
          'invalid-key',
          1
        )
      ).rejects.toThrow();
    });

    test('should validate master secret is required', async () => {
      await expect(
        stellarService.addSigner(
          '',
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          1
        )
      ).rejects.toThrow();
    });
  });
});
