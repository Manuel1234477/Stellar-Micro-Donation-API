/**
 * Mock Stellar Service Tests
 * Demonstrates testing without real Stellar network calls
 * Run with: npm test -- MockStellarService.test.js
 */

const MockStellarService = require('../src/services/MockStellarService');

describe('MockStellarService', () => {
  let service;

  beforeEach(() => {
    service = new MockStellarService();
  });

  describe('Wallet Creation', () => {
    test('should create a new wallet with valid keypair', async () => {
      const wallet = await service.createWallet();

      expect(wallet).toHaveProperty('publicKey');
      expect(wallet).toHaveProperty('secretKey');
      expect(wallet.publicKey).toMatch(/^G[A-Z0-9]{54}$/);
      expect(wallet.secretKey).toMatch(/^S[A-Z0-9]{54}$/);
    });

    test('should create multiple unique wallets', async () => {
      const wallet1 = await service.createWallet();
      const wallet2 = await service.createWallet();

      expect(wallet1.publicKey).not.toBe(wallet2.publicKey);
      expect(wallet1.secretKey).not.toBe(wallet2.secretKey);
    });

    test('should initialize wallet with zero balance', async () => {
      const wallet = await service.createWallet();
      const balance = await service.getBalance(wallet.publicKey);

      expect(balance.balance).toBe('0');
      expect(balance.asset).toBe('XLM');
    });
  });

  describe('Wallet Balance', () => {
    test('should retrieve wallet balance', async () => {
      const wallet = await service.createWallet();
      const balance = await service.getBalance(wallet.publicKey);

      expect(balance).toHaveProperty('balance');
      expect(balance).toHaveProperty('asset');
      expect(balance.asset).toBe('XLM');
    });

    test('should throw error for non-existent wallet', async () => {
      await expect(service.getBalance('GINVALID')).rejects.toThrow(
        'Wallet not found'
      );
    });
  });

  describe('Testnet Funding', () => {
    test('should fund wallet with 10000 XLM', async () => {
      const wallet = await service.createWallet();
      const result = await service.fundTestnetWallet(wallet.publicKey);

      expect(result.balance).toBe('10000.0000000');
    });

    test('should update wallet balance after funding', async () => {
      const wallet = await service.createWallet();
      await service.fundTestnetWallet(wallet.publicKey);
      const balance = await service.getBalance(wallet.publicKey);

      expect(balance.balance).toBe('10000.0000000');
    });

    test('should throw error for non-existent wallet', async () => {
      await expect(
        service.fundTestnetWallet('GINVALID')
      ).rejects.toThrow('Wallet not found');
    });
  });

  describe('Donations', () => {
    test('should send donation between wallets', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      // Fund source wallet
      await service.fundTestnetWallet(source.publicKey);

      // Send donation
      const result = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '100.50',
        memo: 'Test donation',
      });

      expect(result).toHaveProperty('transactionId');
      expect(result).toHaveProperty('ledger');
      expect(result.transactionId).toMatch(/^mock_/);
    });

    test('should update balances after donation', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '100.50',
        memo: 'Test donation',
      });

      const sourceBalance = await service.getBalance(source.publicKey);
      const destBalance = await service.getBalance(destination.publicKey);

      expect(parseFloat(sourceBalance.balance)).toBe(9899.5);
      expect(parseFloat(destBalance.balance)).toBe(100.5);
    });

    test('should reject donation with insufficient balance', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await expect(
        service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: destination.publicKey,
          amount: '100',
          memo: 'Test donation',
        })
      ).rejects.toThrow('Insufficient balance');
    });

    test('should reject donation with invalid source secret', async () => {
      const destination = await service.createWallet();

      await expect(
        service.sendDonation({
          sourceSecret: 'SINVALID',
          destinationPublic: destination.publicKey,
          amount: '100',
          memo: 'Test donation',
        })
      ).rejects.toThrow('Invalid source secret key');
    });

    test('should reject donation to non-existent wallet', async () => {
      const source = await service.createWallet();
      await service.fundTestnetWallet(source.publicKey);

      await expect(
        service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: 'GINVALID',
          amount: '100',
          memo: 'Test donation',
        })
      ).rejects.toThrow('Destination wallet not found');
    });
  });

  describe('Transaction History', () => {
    test('should retrieve transaction history', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Donation 1',
      });

      const history = await service.getTransactionHistory(source.publicKey);

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0]).toHaveProperty('transactionId');
      expect(history[0]).toHaveProperty('amount');
    });

    test('should respect limit parameter', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      // Send multiple donations
      for (let i = 0; i < 5; i++) {
        await service.sendDonation({
          sourceSecret: source.secretKey,
          destinationPublic: destination.publicKey,
          amount: '10',
          memo: `Donation ${i}`,
        });
      }

      const history = await service.getTransactionHistory(source.publicKey, 2);

      expect(history.length).toBeLessThanOrEqual(2);
    });

    test('should throw error for non-existent wallet', async () => {
      await expect(
        service.getTransactionHistory('GINVALID')
      ).rejects.toThrow('Wallet not found');
    });
  });

  describe('Transaction Streaming', () => {
    test('should stream transactions to listener', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      const transactions = [];
      const unsubscribe = service.streamTransactions(
        source.publicKey,
        (tx) => transactions.push(tx)
      );

      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Streamed donation',
      });

      expect(transactions.length).toBe(1);
      expect(transactions[0].memo).toBe('Streamed donation');

      unsubscribe();
    });

    test('should support multiple stream listeners', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      const listener1 = jest.fn();
      const listener2 = jest.fn();

      service.streamTransactions(source.publicKey, listener1);
      service.streamTransactions(source.publicKey, listener2);

      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Test',
      });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    test('should unsubscribe from stream', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);

      const listener = jest.fn();
      const unsubscribe = service.streamTransactions(source.publicKey, listener);

      unsubscribe();

      await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Test',
      });

      expect(listener).not.toHaveBeenCalled();
    });

    test('should throw error for non-existent wallet', async () => {
      expect(() => {
        service.streamTransactions('GINVALID', () => {});
      }).toThrow('Wallet not found');
    });
  });

  describe('Error Handling', () => {
    test('should handle concurrent operations', async () => {
      const wallet1 = await service.createWallet();
      const wallet2 = await service.createWallet();

      await service.fundTestnetWallet(wallet1.publicKey);
      await service.fundTestnetWallet(wallet2.publicKey);

      const results = await Promise.all([
        service.sendDonation({
          sourceSecret: wallet1.secretKey,
          destinationPublic: wallet2.publicKey,
          amount: '100',
          memo: 'Concurrent 1',
        }),
        service.sendDonation({
          sourceSecret: wallet2.secretKey,
          destinationPublic: wallet1.publicKey,
          amount: '50',
          memo: 'Concurrent 2',
        }),
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('transactionId');
      expect(results[1]).toHaveProperty('transactionId');
    });
  });
});
