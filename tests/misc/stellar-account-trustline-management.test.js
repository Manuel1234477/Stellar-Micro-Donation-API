/**
 * Tests for Stellar Account Trustline Management
 * 
 * Test scenarios:
 * 1. Add trustline success
 * 2. Add trustline fails if already exists
 * 3. Remove trustline success
 * 4. Remove trustline fails if not exists
 * 5. Remove trustline fails if balance not zero
 * 6. List trustlines returns array
 * 7. Invalid asset code returns 400
 * 8. Invalid issuer returns 400
 */

const MockStellarService = require('../../src/services/MockStellarService');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../../src/utils/errors');

describe('Stellar Account Trustline Management', () => {
  let mockService;
  let testWallet;

  beforeEach(async () => {
    mockService = new MockStellarService({ network: 'testnet' });
    testWallet = await mockService.createWallet();
  });

  describe('addTrustline', () => {
    test('Add trustline success', async () => {
      const asset = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      const result = await mockService.addTrustline(testWallet.publicKey, asset);

      expect(result).toBeDefined();
      expect(result.hash).toMatch(/^mock_[a-f0-9]{32}$/);
      expect(result.ledger).toBeGreaterThan(0);
      expect(result.hash).toBeTruthy();
    });

    test('Add trustline fails if already exists', async () => {
      const asset = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      // Add first trustline
      await mockService.addTrustline(testWallet.publicKey, asset);

      // Try to add same trustline again
      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(BusinessLogicError);
    });

    test('Invalid asset code returns 400', async () => {
      const asset = {
        code: 'TOOLONGASSETCODE123', // 13+ characters
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Invalid issuer returns 400', async () => {
      const asset = {
        code: 'USD',
        issuer: 'INVALIDISSUER123'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Empty asset code returns 400', async () => {
      const asset = {
        code: '',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Missing issuer returns 400', async () => {
      const asset = {
        code: 'USD'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });
  });

  describe('removeTrustline', () => {
    let asset;

    beforeEach(async () => {
      asset = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };
      // Add a trustline first for removal tests
      await mockService.addTrustline(testWallet.publicKey, asset);
    });

    test('Remove trustline success', async () => {
      const result = await mockService.removeTrustline(testWallet.publicKey, asset);

      expect(result).toBeDefined();
      expect(result.hash).toMatch(/^mock_[a-f0-9]{32}$/);
      expect(result.ledger).toBeGreaterThan(0);
      expect(result.hash).toBeTruthy();
    });

    test('Remove trustline fails if not exists', async () => {
      const nonExistentAsset = {
        code: 'EUR',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.removeTrustline(testWallet.publicKey, nonExistentAsset))
        .rejects
        .toThrow(BusinessLogicError);
    });

    test('Remove trustline fails if balance not zero', async () => {
      // Simulate adding a balance to the trustline
      const wallet = mockService.wallets.get(testWallet.publicKey);
      const assetKey = `${asset.code}:${asset.issuer}`;
      const trustline = wallet.trustlines.get(assetKey);
      trustline.balance = '100.0000000';

      await expect(mockService.removeTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Remove trustline fails for non-existent account', async () => {
      const nonExistentPublicKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';

      await expect(mockService.removeTrustline(nonExistentPublicKey, asset))
        .rejects
        .toThrow(NotFoundError);
    });
  });

  describe('getTrustlines', () => {
    test('List trustlines returns array', async () => {
      const asset1 = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };
      const asset2 = {
        code: 'EUR',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG'
      };

      // Add trustlines
      await mockService.addTrustline(testWallet.publicKey, asset1);
      await mockService.addTrustline(testWallet.publicKey, asset2);

      const trustlines = await mockService.getTrustlines(testWallet.publicKey);

      expect(Array.isArray(trustlines)).toBe(true);
      expect(trustlines).toHaveLength(2);
      expect(trustlines[0]).toHaveProperty('asset');
      expect(trustlines[0]).toHaveProperty('balance');
      expect(trustlines[0]).toHaveProperty('limit');
      expect(trustlines[0].balance).toBe('0.0000000');
      expect(trustlines[0].limit).toBe('922337203685.4775807');
    });

    test('List trustlines returns empty array for no trustlines', async () => {
      const trustlines = await mockService.getTrustlines(testWallet.publicKey);

      expect(Array.isArray(trustlines)).toBe(true);
      expect(trustlines).toHaveLength(0);
    });

    test('List trustlines fails for non-existent account', async () => {
      const nonExistentPublicKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDE';

      await expect(mockService.getTrustlines(nonExistentPublicKey))
        .rejects
        .toThrow(NotFoundError);
    });

    test('List trustlines includes correct asset data', async () => {
      const asset = {
        code: 'BTC',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await mockService.addTrustline(testWallet.publicKey, asset);
      const trustlines = await mockService.getTrustlines(testWallet.publicKey);

      expect(trustlines).toHaveLength(1);
      expect(trustlines[0].asset.code).toBe('BTC');
      expect(trustlines[0].asset.issuer).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF');
    });
  });

  describe('Edge Cases', () => {
    test('Asset code with exactly 12 characters should be valid', async () => {
      const asset = {
        code: '123456789012', // Exactly 12 characters
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      const result = await mockService.addTrustline(testWallet.publicKey, asset);
      expect(result.hash).toBeTruthy();
    });

    test('Asset code with exactly 1 character should be valid', async () => {
      const asset = {
        code: 'X', // Exactly 1 character
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      const result = await mockService.addTrustline(testWallet.publicKey, asset);
      expect(result.hash).toBeTruthy();
    });

    test('Asset code with special characters should be invalid', async () => {
      const asset = {
        code: 'US$D', // Contains special character
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Multiple trustlines for different assets work independently', async () => {
      const asset1 = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };
      const asset2 = {
        code: 'USD', // Same code, different issuer
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG'
      };

      await mockService.addTrustline(testWallet.publicKey, asset1);
      await mockService.addTrustline(testWallet.publicKey, asset2);

      const trustlines = await mockService.getTrustlines(testWallet.publicKey);
      expect(trustlines).toHaveLength(2);

      // Remove one trustline
      await mockService.removeTrustline(testWallet.publicKey, asset1);

      const remainingTrustlines = await mockService.getTrustlines(testWallet.publicKey);
      expect(remainingTrustlines).toHaveLength(1);
      expect(remainingTrustlines[0].asset.issuer).toBe('GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEG');
    });
  });

  describe('Error Handling', () => {
    test('Invalid public key format is rejected', async () => {
      const asset = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.addTrustline('INVALID_KEY', asset))
        .rejects
        .toThrow(ValidationError);
    });

    test('Service failure simulation works', async () => {
      mockService.enableFailureSimulation('tx_failed', 1.0);
      
      const asset = {
        code: 'USD',
        issuer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ABCDEF'
      };

      await expect(mockService.addTrustline(testWallet.publicKey, asset))
        .rejects
        .toThrow(BusinessLogicError);

      mockService.disableFailureSimulation();
    });
  });
});
