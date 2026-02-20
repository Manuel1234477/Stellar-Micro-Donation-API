/**
 * Integration tests for Stellar Address Validation
 * Tests validation in MockStellarService and donation routes
 */

const MockStellarService = require('../src/services/MockStellarService');

describe('Address Validation Integration', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  describe('MockStellarService Address Validation', () => {
    test('should reject invalid destination address in sendDonation', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      const invalidAddress = 'GINVALID123';

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: invalidAddress,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid destination address');
    });

    test('should reject empty destination address', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: '',
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid destination address');
    });

    test('should reject null destination address', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: null,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid destination address');
    });

    test('should reject address with wrong prefix', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      const wrongPrefix = 'ABRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: wrongPrefix,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('must start with "G"');
    });

    test('should reject address with wrong length', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      const wrongLength = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX';

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: wrongLength,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid Stellar address length');
    });

    test('should reject address with invalid checksum', async () => {
      const wallet1 = await service.createWallet();
      await service.fundTestnetWallet(wallet1.publicKey);

      // Valid format but invalid checksum
      const invalidChecksum = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2X';

      await expect(
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: invalidChecksum,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid destination address');
    });

    test('should accept valid destination address', async () => {
      const wallet1 = await service.createWallet();
      const wallet2 = await service.createWallet();
      
      await service.fundTestnetWallet(wallet1.publicKey);
      await service.fundTestnetWallet(wallet2.publicKey);

      const result = await service.sendDonation({
        sourceSecret: wallet1.secretKey,
        destinationPublic: wallet2.publicKey,
        amount: '10',
        memo: 'Test'
      });

      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('ledger');
    });

    test('should validate address in getBalance', async () => {
      await expect(
        service.getBalance('GINVALID')
      ).rejects.toThrow('Invalid Stellar address');
    });

    test('should validate address in fundTestnetWallet', async () => {
      await expect(
        service.fundTestnetWallet('GINVALID')
      ).rejects.toThrow('Invalid Stellar address');
    });

    test('should validate address in isAccountFunded', async () => {
      await expect(
        service.isAccountFunded('GINVALID')
      ).rejects.toThrow('Invalid Stellar address');
    });

    test('should validate address in getTransactionHistory', async () => {
      await expect(
        service.getTransactionHistory('GINVALID')
      ).rejects.toThrow('Invalid Stellar address');
    });

    test('should validate address in streamTransactions', () => {
      expect(() => {
        service.streamTransactions('GINVALID', () => {});
      }).toThrow('Invalid Stellar address');
    });

    test('should reject invalid source secret key', async () => {
      const wallet2 = await service.createWallet();
      await service.fundTestnetWallet(wallet2.publicKey);

      await expect(
        service.sendDonation({
          sourceSecret: 'SINVALID',
          destinationPublic: wallet2.publicKey,
          amount: '10',
          memo: 'Test'
        })
      ).rejects.toThrow('Invalid source secret key');
    });
  });
});
