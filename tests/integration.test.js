/**
 * Integration Tests with Mock Stellar Service
 * Demonstrates how to use mock service in application context
 * Run with: npm test -- integration.test.js
 */

const { getStellarService } = require('../src/config/stellar');

describe('Integration Tests with Mock Stellar', () => {
  let stellarService;

  beforeEach(() => {
    // Force mock mode for testing
    process.env.MOCK_STELLAR = 'true';
    stellarService = getStellarService();
  });

  describe('Wallet Management Flow', () => {
    test('should complete full wallet creation and funding flow', async () => {
      // Create wallet
      const wallet = await stellarService.createWallet();
      expect(wallet.publicKey).toBeDefined();
      expect(wallet.secretKey).toBeDefined();

      // Check initial balance
      let balance = await stellarService.getBalance(wallet.publicKey);
      expect(balance.balance).toBe('0');

      // Fund wallet
      await stellarService.fundTestnetWallet(wallet.publicKey);

      // Verify funded balance
      balance = await stellarService.getBalance(wallet.publicKey);
      expect(balance.balance).toBe('10000.0000000');
    });
  });

  describe('Donation Flow', () => {
    test('should complete full donation workflow', async () => {
      // Setup: Create and fund two wallets
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      // Execute: Send donation
      const txResult = await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '250.75',
        memo: 'Coffee donation',
      });

      expect(txResult.transactionId).toBeDefined();
      expect(txResult.ledger).toBeDefined();

      // Verify: Check balances
      const donorBalance = await stellarService.getBalance(donor.publicKey);
      const recipientBalance = await stellarService.getBalance(
        recipient.publicKey
      );

      expect(parseFloat(donorBalance.balance)).toBe(9749.25);
      expect(parseFloat(recipientBalance.balance)).toBe(10250.75);

      // Verify: Check transaction history
      const donorHistory = await stellarService.getTransactionHistory(
        donor.publicKey
      );
      expect(donorHistory.length).toBeGreaterThan(0);
      expect(donorHistory[0].memo).toBe('Coffee donation');
    });
  });

  describe('Real-time Streaming', () => {
    test('should stream donation transactions', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient.publicKey);

      const receivedTransactions = [];

      // Subscribe to stream
      const unsubscribe = stellarService.streamTransactions(
        recipient.publicKey,
        (tx) => {
          receivedTransactions.push(tx);
        }
      );

      // Send donation
      await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient.publicKey,
        amount: '100',
        memo: 'Stream test',
      });

      // Verify stream received transaction
      expect(receivedTransactions.length).toBe(1);
      expect(receivedTransactions[0].amount).toBe('100.0000000');

      unsubscribe();
    });
  });

  describe('Multiple Donations', () => {
    test('should handle multiple sequential donations', async () => {
      const donor = await stellarService.createWallet();
      const recipient1 = await stellarService.createWallet();
      const recipient2 = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);
      await stellarService.fundTestnetWallet(recipient1.publicKey);
      await stellarService.fundTestnetWallet(recipient2.publicKey);

      // Send multiple donations
      await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient1.publicKey,
        amount: '100',
        memo: 'Donation 1',
      });

      await stellarService.sendDonation({
        sourceSecret: donor.secretKey,
        destinationPublic: recipient2.publicKey,
        amount: '200',
        memo: 'Donation 2',
      });

      // Verify final state
      const donorBalance = await stellarService.getBalance(donor.publicKey);
      const recipient1Balance = await stellarService.getBalance(
        recipient1.publicKey
      );
      const recipient2Balance = await stellarService.getBalance(
        recipient2.publicKey
      );

      expect(parseFloat(donorBalance.balance)).toBe(9700);
      expect(parseFloat(recipient1Balance.balance)).toBe(10100);
      expect(parseFloat(recipient2Balance.balance)).toBe(10200);

      // Verify history
      const history = await stellarService.getTransactionHistory(
        donor.publicKey,
        10
      );
      expect(history.length).toBe(2);
    });
  });

  describe('Error Scenarios', () => {
    test('should handle insufficient balance error', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Fund recipient but not donor
      await stellarService.fundTestnetWallet(recipient.publicKey);

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Will fail',
        })
      ).rejects.toThrow('Insufficient balance');
    });

    test('should handle invalid wallet error', async () => {
      await expect(
        stellarService.getBalance('GINVALIDKEY123456789012345678901234567890123456')
      ).rejects.toThrow();
    });
  });

  describe('Mock Service Configuration', () => {
    test('should use mock service when MOCK_STELLAR=true', () => {
      process.env.MOCK_STELLAR = 'true';
      const service = getStellarService();
      expect(service.constructor.name).toBe('MockStellarService');
    });

    test.skip('should use real service when MOCK_STELLAR=false', () => {
      // Skipped: setup.js forces MOCK_STELLAR=true for all tests
      process.env.MOCK_STELLAR = 'false';
      const service = getStellarService();
      expect(service.constructor.name).toBe('StellarService');
    });
  });
});
