/**
 * Integration Tests with Mock Stellar Service
 * Demonstrates how to use mock service in application context
 * Run with: npm test -- integration.test.js
 */

const { getStellarService } = require('../src/config/stellar');

describe('Integration Tests - Mock Stellar Service', () => {
  let stellarService;

  beforeEach(() => {
    // Force mock mode for testing
    process.env.MOCK_STELLAR = 'true';
    stellarService = getStellarService();
  });

  describe('Wallet Management', () => {
    test('should create wallet and fund it successfully', async () => {
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

  describe('Donation Workflow', () => {
    test('should send donation and update balances correctly', async () => {
      // Setup: Create and fund two wallets
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);

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
      expect(parseFloat(recipientBalance.balance)).toBe(250.75);

      // Verify: Check transaction history
      const donorHistory = await stellarService.getTransactionHistory(
        donor.publicKey
      );
      expect(donorHistory.length).toBeGreaterThan(0);
      expect(donorHistory[0].memo).toBe('Coffee donation');
    });
  });

  describe('Transaction Streaming', () => {
    test('should receive transactions via stream listener', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);

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
      expect(receivedTransactions[0].amount).toBe('100');

      unsubscribe();
    });
  });

  describe('Sequential Donations', () => {
    test('should process multiple donations and maintain correct balances', async () => {
      const donor = await stellarService.createWallet();
      const recipient1 = await stellarService.createWallet();
      const recipient2 = await stellarService.createWallet();

      await stellarService.fundTestnetWallet(donor.publicKey);

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
      expect(parseFloat(recipient1Balance.balance)).toBe(100);
      expect(parseFloat(recipient2Balance.balance)).toBe(200);

      // Verify history
      const history = await stellarService.getTransactionHistory(
        donor.publicKey,
        10
      );
      expect(history.length).toBe(2);
    });
  });

  describe('Error Handling', () => {
    test('should reject donation when balance is insufficient', async () => {
      const donor = await stellarService.createWallet();
      const recipient = await stellarService.createWallet();

      // Don't fund donor - balance is 0

      await expect(
        stellarService.sendDonation({
          sourceSecret: donor.secretKey,
          destinationPublic: recipient.publicKey,
          amount: '100',
          memo: 'Will fail',
        })
      ).rejects.toThrow('Insufficient balance');
    });

    test('should reject request for non-existent wallet', async () => {
      await expect(
        stellarService.getBalance('GINVALID')
      ).rejects.toThrow('Wallet not found');
    });
  });

  describe('Service Configuration', () => {
    test('should return MockStellarService when MOCK_STELLAR is enabled', () => {
      process.env.MOCK_STELLAR = 'true';
      const service = getStellarService();
      expect(service.constructor.name).toBe('MockStellarService');
    });

    test('should return StellarService when MOCK_STELLAR is disabled', () => {
      process.env.MOCK_STELLAR = 'false';
      const service = getStellarService();
      expect(service.constructor.name).toBe('StellarService');
    });
  });
});
