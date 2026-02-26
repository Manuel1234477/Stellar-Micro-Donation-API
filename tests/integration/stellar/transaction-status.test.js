/**
 * Transaction Status Tests
 * Tests for storing and updating Stellar transaction status
 * Run with: npm test -- transaction-status.test.js
 */

const Transaction = require('../../../src/routes/models/transaction');
const MockStellarService = require('../../../src/services/MockStellarService');
const fs = require('fs');
const path = require('path');

describe('Transaction Status Management', () => {
  const testDbPath = path.join(__dirname, '../data/test-transactions.json');

  beforeEach(() => {
    // Use test database
    Transaction.getDbPath = () => testDbPath;
    
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  afterEach(() => {
    // Clean up test database
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  describe('Transaction Creation with Status', () => {
    test('should create transaction with pending status by default', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
      });

      expect(transaction.status).toBe('pending');
      expect(transaction).toHaveProperty('statusUpdatedAt');
      expect(transaction.stellarTxId).toBeNull();
      expect(transaction.stellarLedger).toBeNull();
    });

    test('should create transaction with specified status', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'confirmed',
      });

      expect(transaction.status).toBe('confirmed');
    });

    test('should create transaction with Stellar data', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'confirmed',
        stellarTxId: 'mock_abc123',
        stellarLedger: 1234567,
      });

      expect(transaction.stellarTxId).toBe('mock_abc123');
      expect(transaction.stellarLedger).toBe(1234567);
    });
  });

  describe('Status Updates', () => {
    test('should update transaction status', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
      });

      const updated = Transaction.updateStatus(transaction.id, 'confirmed');

      expect(updated.status).toBe('confirmed');
      expect(updated.statusUpdatedAt).toBeDefined();
      expect(new Date(updated.statusUpdatedAt).getTime()).toBeGreaterThan(
        new Date(transaction.statusUpdatedAt).getTime()
      );
    });

    test('should update status with Stellar transaction data', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
      });

      const updated = Transaction.updateStatus(transaction.id, 'confirmed', {
        transactionId: 'stellar_tx_123',
        ledger: 9876543,
        confirmedAt: new Date().toISOString(),
      });

      expect(updated.status).toBe('confirmed');
      expect(updated.stellarTxId).toBe('stellar_tx_123');
      expect(updated.stellarLedger).toBe(9876543);
      expect(updated.confirmedAt).toBeDefined();
    });

    test('should throw error for non-existent transaction', () => {
      expect(() => {
        Transaction.updateStatus('invalid_id', 'confirmed');
      }).toThrow('Transaction not found');
    });

    test('should persist status updates', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
      });

      Transaction.updateStatus(transaction.id, 'confirmed', {
        transactionId: 'stellar_tx_456',
      });

      const retrieved = Transaction.getById(transaction.id);
      expect(retrieved.status).toBe('confirmed');
      expect(retrieved.stellarTxId).toBe('stellar_tx_456');
    });
  });

  describe('Query by Status', () => {
    test('should retrieve transactions by status', () => {
      Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'pending',
      });

      Transaction.create({
        amount: 200,
        donor: 'Charlie',
        recipient: 'Dave',
        status: 'confirmed',
      });

      Transaction.create({
        amount: 300,
        donor: 'Eve',
        recipient: 'Frank',
        status: 'pending',
      });

      const pending = Transaction.getByStatus('pending');
      const confirmed = Transaction.getByStatus('confirmed');

      expect(pending.length).toBe(2);
      expect(confirmed.length).toBe(1);
      expect(pending.every(tx => tx.status === 'pending')).toBe(true);
      expect(confirmed.every(tx => tx.status === 'confirmed')).toBe(true);
    });

    test('should return empty array for status with no transactions', () => {
      const failed = Transaction.getByStatus('failed');
      expect(failed).toEqual([]);
    });
  });

  describe('Query by Stellar Transaction ID', () => {
    test('should retrieve transaction by Stellar TX ID', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        stellarTxId: 'stellar_unique_123',
      });

      const found = Transaction.getByStellarTxId('stellar_unique_123');

      expect(found).toBeDefined();
      expect(found.id).toBe(transaction.id);
      expect(found.stellarTxId).toBe('stellar_unique_123');
    });

    test('should return undefined for non-existent Stellar TX ID', () => {
      const found = Transaction.getByStellarTxId('non_existent');
      expect(found).toBeUndefined();
    });
  });

  describe('Integration with MockStellarService', () => {
    let service;

    beforeEach(() => {
      service = new MockStellarService();
    });

    test('should create transaction and update with Stellar confirmation', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      await service.fundTestnetWallet(destination.publicKey);

      // Create pending transaction
      const transaction = Transaction.create({
        amount: 100,
        donor: source.publicKey,
        recipient: destination.publicKey,
        status: 'pending',
      });

      // Send on Stellar
      const stellarResult = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '100',
        memo: 'Test donation',
      });

      // Update transaction with Stellar confirmation
      const updated = Transaction.updateStatus(transaction.id, 'confirmed', {
        transactionId: stellarResult.transactionId,
        ledger: stellarResult.ledger,
        confirmedAt: stellarResult.confirmedAt,
      });

      expect(updated.status).toBe('confirmed');
      expect(updated.stellarTxId).toBe(stellarResult.transactionId);
      expect(updated.stellarLedger).toBe(stellarResult.ledger);
      expect(updated.confirmedAt).toBeDefined();
    });

    test('should verify transaction status from Stellar', async () => {
      const source = await service.createWallet();
      const destination = await service.createWallet();

      await service.fundTestnetWallet(source.publicKey);
      await service.fundTestnetWallet(destination.publicKey);

      const stellarResult = await service.sendDonation({
        sourceSecret: source.secretKey,
        destinationPublic: destination.publicKey,
        amount: '50',
        memo: 'Verification test',
      });

      const verification = await service.verifyTransaction(stellarResult.transactionId);

      expect(verification.verified).toBe(true);
      expect(verification.status).toBe('confirmed');
      expect(verification.transaction.id).toBe(stellarResult.transactionId);
    });

    test('should handle failed transaction status', async () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'pending',
      });

      // Simulate failed transaction
      const updated = Transaction.updateStatus(transaction.id, 'failed');

      expect(updated.status).toBe('failed');
      expect(updated.stellarTxId).toBeNull();
    });
  });

  describe('Transaction History with Status', () => {
    test('should include status in transaction history', () => {
      Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'confirmed',
        stellarTxId: 'tx_001',
      });

      Transaction.create({
        amount: 200,
        donor: 'Charlie',
        recipient: 'Dave',
        status: 'pending',
      });

      const all = Transaction.getAll();

      expect(all.length).toBe(2);
      expect(all[0]).toHaveProperty('status');
      expect(all[0]).toHaveProperty('statusUpdatedAt');
      expect(all[1]).toHaveProperty('status');
    });

    test('should filter history by date range and include status', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'confirmed',
      });

      const transactions = Transaction.getByDateRange(yesterday, tomorrow);

      expect(transactions.length).toBe(1);
      expect(transactions[0].status).toBe('confirmed');
    });
  });

  describe('Status Validation', () => {
    test('should handle lifecycle transitions', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'pending',
      });

      // Pending -> Submitted
      let updated = Transaction.updateStatus(transaction.id, 'submitted', {
        transactionId: 'tx_123',
      });
      expect(updated.status).toBe('submitted');

      // Submitted -> Confirmed
      updated = Transaction.updateStatus(transaction.id, 'confirmed', {
        transactionId: 'tx_123',
      });
      expect(updated.status).toBe('confirmed');

      // Confirmed -> Failed (supported for reconciliation scenarios)
      updated = Transaction.updateStatus(transaction.id, 'failed');
      expect(updated.status).toBe('failed');
    });

    test('should block invalid transitions', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'failed',
      });

      expect(() => {
        Transaction.updateStatus(transaction.id, 'confirmed');
      }).toThrow('Invalid transaction state transition');
    });

    test('should normalize legacy statuses', () => {
      const transaction = Transaction.create({
        amount: 100,
        donor: 'Alice',
        recipient: 'Bob',
        status: 'completed',
      });

      expect(transaction.status).toBe('confirmed');
    });
  });
});
