/**
 * Account Funding Verification Tests
 * Tests for detecting unfunded accounts before sending donations
 * Run with: npm test -- account-funding.test.js
 */

const MockStellarService = require('../../../src/services/MockStellarService');

describe('Account Funding Verification', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  describe('isAccountFunded', () => {
    test('should return false for non-existent account', async () => {
      const result = await service.isAccountFunded('GINVALID');

      expect(result.funded).toBe(false);
      expect(result.exists).toBe(false);
      expect(result.balance).toBe('0');
    });

    test('should return false for unfunded account', async () => {
      const wallet = await service.createWallet();
      const result = await service.isAccountFunded(wallet.publicKey);

      expect(result.funded).toBe(false);
      expect(result.exists).toBe(true);
      expect(result.balance).toBe('0');
    });

    test('should return true for funded account', async () => {
      const wallet = await service.createWallet();
      await service.fundTestnetWallet(wallet.publicKey);
      const result = await service.isAccountFunded(wallet.publicKey);

      expect(result.funded).toBe(true);
      expect(result.exists).toBe(true);
      expect(parseFloat(result.balance)).toBeGreaterThan(0);
    });
  });

  describe('Donation to Unfunded Account', () => {
    test('should reject donation to unfunded account', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      await expect(
        service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: destination.publicKey,
          amount: '100',
          memo: 'Test donation',
        })
      ).rejects.toThrow('Destination account is not funded');
    });

    test('should provide helpful error message for unfunded account', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      try {
        await service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: destination.publicKey,
          amount: '100',
          memo: 'Test donation',
        });
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('Destination account is not funded');
        expect(error.message).toContain('Stellar');
        expect(error.message).toContain('Friendbot');
      }
    });

    test('should allow donation to funded account', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      await service.fundTestnetWallet(destination.publicKey);

      const result = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '100',
        memo: 'Test donation',
      });

      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('ledger');
    });
  });

  describe('Pre-flight Account Check', () => {
    test('should check account funding before attempting donation', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      // Check destination account before sending
      const fundingStatus = await service.isAccountFunded(destination.publicKey);

      if (!fundingStatus.funded) {
        // Fund the account first
        await service.fundTestnetWallet(destination.publicKey);
      }

      // Now donation should succeed
      const result = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '100',
        memo: 'Test donation',
      });

      expect(result).toHaveProperty('transactionId');
    });

    test('should handle multiple donations to same funded account', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      await service.fundTestnetWallet(destination.publicKey);

      // First donation
      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Donation 1',
      });

      // Second donation should also succeed
      const result = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Donation 2',
      });

      expect(result).toHaveProperty('transactionId');

      const destBalance = await service.getBalance(destination.publicKey);
      expect(parseFloat(destBalance.balance)).toBe(10100); // 10000 + 50 + 50
    });
  });

  describe('Edge Cases', () => {
    test('should handle account with minimal balance', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      
      // Manually set destination to have minimal balance
      const destWallet = service.wallets.get(destination.publicKey);
      destWallet.balance = '0.0000001';

      const result = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '10',
        memo: 'Test donation',
      });

      expect(result).toHaveProperty('transactionId');
    });

    test('should reject account with exactly zero balance', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      // Ensure destination has exactly zero balance
      const destWallet = service.wallets.get(destination.publicKey);
      destWallet.balance = '0';

      await expect(
        service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: destination.publicKey,
          amount: '10',
          memo: 'Test donation',
        })
      ).rejects.toThrow('Destination account is not funded');
    });
  });
});
