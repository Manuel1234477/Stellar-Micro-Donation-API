/**
 * Transaction Sync Service Failure Tests
 * Tests for consistency checks, reconciliation failures, and sync errors
 */

const TransactionSyncService = require('../../../src/services/TransactionSyncService');
const Transaction = require('../../../src/routes/models/transaction');

describe('Transaction Sync Failure Scenarios', () => {
  let syncService;

  beforeEach(() => {
    syncService = new TransactionSyncService('https://horizon-testnet.stellar.org');
  });

  describe('Sync Consistency Check Failures', () => {
    test('should detect missing local transactions', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      // Mock Horizon returning transactions that don't exist locally
      const mockHorizonTxs = [
        { id: 'tx1', hash: 'hash1', ledger: 1000, created_at: new Date().toISOString() },
        { id: 'tx2', hash: 'hash2', ledger: 1001, created_at: new Date().toISOString() }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves(mockHorizonTxs);
      syncService._getLocalTransactionsForWallet = jest.fn().returns([]);

      const report = await syncService.performConsistencyCheck(publicKey, mockHorizonTxs);

      expect(report.inconsistencies.length).toBeGreaterThan(0);
      expect(report.inconsistencies.some(i => i.type === 'MISSING_LOCAL')).toBe(true);
    });

    test('should detect orphaned local transactions', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      // Mock local transactions that don't exist on Horizon
      const mockLocalTxs = [
        { stellarTxId: 'tx1', status: 'confirmed' },
        { stellarTxId: 'tx2', status: 'confirmed' }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._getLocalTransactionsForWallet = jest.fn().returns(mockLocalTxs);

      const report = await syncService.performConsistencyCheck(publicKey, []);

      expect(report.inconsistencies.length).toBeGreaterThan(0);
      expect(report.inconsistencies.some(i => i.type === 'ORPHANED_LOCAL')).toBe(true);
    });

    test('should detect status mismatches', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const mockHorizonTxs = [
        { id: 'tx1', successful: true, ledger: 1000 }
      ];

      const mockLocalTxs = [
        { stellarTxId: 'tx1', status: 'pending' }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves(mockHorizonTxs);
      syncService._getLocalTransactionsForWallet = jest.fn().returns(mockLocalTxs);

      const report = await syncService.performConsistencyCheck(publicKey, mockHorizonTxs);

      expect(report.inconsistencies.some(i => i.type === 'STATUS_MISMATCH')).toBe(true);
    });

    test('should detect ledger mismatches', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const mockHorizonTxs = [
        { id: 'tx1', ledger: 1000 }
      ];

      const mockLocalTxs = [
        { stellarTxId: 'tx1', ledger: 999 }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves(mockHorizonTxs);
      syncService._getLocalTransactionsForWallet = jest.fn().returns(mockLocalTxs);

      const report = await syncService.performConsistencyCheck(publicKey, mockHorizonTxs);

      expect(report.inconsistencies.some(i => i.type === 'LEDGER_MISMATCH')).toBe(true);
    });
  });

  describe('Reconciliation Failures', () => {
    test('should handle reconciliation of missing transactions', async () => {
      const inconsistencies = [
        {
          type: 'MISSING_LOCAL',
          horizonTx: { id: 'tx1', hash: 'hash1', ledger: 1000 }
        }
      ];

      Transaction.create = jest.fn().mockReturnValue({ id: 1 });

      await expect(
        syncService.reconcileInconsistencies(inconsistencies)
      ).resolves.not.toThrow();

      expect(Transaction.create).toHaveBeenCalled();
    });

    test('should handle reconciliation failure gracefully', async () => {
      const inconsistencies = [
        {
          type: 'MISSING_LOCAL',
          horizonTx: { id: 'tx1' }
        }
      ];

      Transaction.create = jest.fn().mockImplementation(() => {
        throw new Error('Database error');
      });

      await expect(
        syncService.reconcileInconsistencies(inconsistencies)
      ).rejects.toThrow();
    });

    test('should handle orphaned transaction reconciliation', async () => {
      const inconsistencies = [
        {
          type: 'ORPHANED_LOCAL',
          localTx: { id: 1, stellarTxId: 'tx1', status: 'confirmed' }
        }
      ];

      Transaction.update = jest.fn();

      await syncService.reconcileInconsistencies(inconsistencies);

      expect(Transaction.update).toHaveBeenCalledWith(1, { status: 'failed' });
    });

    test('should handle status mismatch reconciliation', async () => {
      const inconsistencies = [
        {
          type: 'STATUS_MISMATCH',
          localTx: { id: 1, status: 'pending' },
          horizonTx: { successful: true }
        }
      ];

      Transaction.update = jest.fn();

      await syncService.reconcileInconsistencies(inconsistencies);

      expect(Transaction.update).toHaveBeenCalledWith(1, { status: 'confirmed' });
    });
  });

  describe('Horizon API Failures', () => {
    test('should handle Horizon API timeout', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService.server.transactions = jest.fn().mockReturnValue({
        forAccount: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              call: jest.fn().mockRejectedValue(new Error('Request timeout'))
            })
          })
        })
      });

      await expect(
        syncService.syncWalletTransactions(publicKey)
      ).rejects.toThrow('Request timeout');
    });

    test('should handle Horizon API rate limiting', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const rateLimitError = new Error('Rate limit exceeded');
      rateLimitError.response = { status: 429 };

      syncService._fetchHorizonTransactions = jest.fn().rejects(rateLimitError);

      await expect(
        syncService.syncWalletTransactions(publicKey)
      ).rejects.toThrow('Rate limit exceeded');
    });

    test('should handle Horizon API server error', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const serverError = new Error('Internal server error');
      serverError.response = { status: 500 };

      syncService._fetchHorizonTransactions = jest.fn().rejects(serverError);

      await expect(
        syncService.syncWalletTransactions(publicKey)
      ).rejects.toThrow('Internal server error');
    });

    test('should handle malformed Horizon response', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([
        { id: null, hash: undefined }
      ]);

      await expect(
        syncService.syncWalletTransactions(publicKey)
      ).resolves.toBeDefined();
    });
  });

  describe('Delayed Confirmation Handling', () => {
    test('should detect delayed confirmations', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const oldDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago

      const mockLocalTxs = [
        {
          stellarTxId: 'tx1',
          status: 'pending',
          createdAt: oldDate.toISOString()
        }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._getLocalTransactionsForWallet = jest.fn().returns(mockLocalTxs);

      const report = await syncService.performConsistencyCheck(publicKey, []);

      expect(report.inconsistencies.some(i => i.type === 'DELAYED_CONFIRMATION')).toBe(true);
    });

    test('should not flag recent pending transactions', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      const recentDate = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes ago

      const mockLocalTxs = [
        {
          stellarTxId: 'tx1',
          status: 'pending',
          createdAt: recentDate.toISOString()
        }
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._getLocalTransactionsForWallet = jest.fn().returns(mockLocalTxs);

      const report = await syncService.performConsistencyCheck(publicKey, []);

      expect(report.inconsistencies.some(i => i.type === 'DELAYED_CONFIRMATION')).toBe(false);
    });
  });

  describe('Sync Options and Configuration', () => {
    test('should skip consistency check when disabled', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);

      const result = await syncService.syncWalletTransactions(publicKey, {
        performConsistencyCheck: false
      });

      expect(result.consistencyReport).toBeNull();
    });

    test('should skip auto-reconcile when disabled', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);
      syncService.performConsistencyCheck = jest.fn().resolves({
        inconsistencies: [{ type: 'MISSING_LOCAL' }]
      });
      syncService.reconcileInconsistencies = jest.fn();

      await syncService.syncWalletTransactions(publicKey, {
        performConsistencyCheck: true,
        autoReconcile: false
      });

      expect(syncService.reconcileInconsistencies).not.toHaveBeenCalled();
    });

    test('should respect custom limit parameter', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);

      await syncService.syncWalletTransactions(publicKey, { limit: 50 });

      expect(syncService._fetchHorizonTransactions).toHaveBeenCalledWith(publicKey, 50);
    });
  });

  describe('Concurrent Sync Operations', () => {
    test('should handle multiple concurrent syncs for same wallet', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);

      const promises = Array(5).fill(null).map(() =>
        syncService.syncWalletTransactions(publicKey)
      );

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });

    test('should handle syncs for multiple wallets simultaneously', async () => {
      const wallets = [
        'GWALLET1',
        'GWALLET2',
        'GWALLET3'
      ];

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);

      const promises = wallets.map(wallet =>
        syncService.syncWalletTransactions(wallet)
      );

      await expect(Promise.all(promises)).resolves.toBeDefined();
    });
  });

  describe('Sync Logging', () => {
    test('should log sync operations', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().resolves([]);
      syncService._syncNewTransactions = jest.fn().resolves([]);

      const result = await syncService.syncWalletTransactions(publicKey);

      expect(result.syncLog).toBeDefined();
      expect(result.syncLog.length).toBeGreaterThan(0);
    });

    test('should log errors during sync', async () => {
      const publicKey = 'GTEST123456789012345678901234567890123456';

      syncService._fetchHorizonTransactions = jest.fn().rejects(new Error('Sync error'));

      try {
        await syncService.syncWalletTransactions(publicKey);
      } catch (error) {
        expect(syncService.syncLog.some(log => log.level === 'ERROR')).toBe(true);
      }
    });
  });
});
