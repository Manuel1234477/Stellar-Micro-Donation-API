/**
 * Test Suite: Stellar Transaction History Synchronization (Issue #386)
 * 
 * Tests scheduled transaction synchronization for all registered wallets,
 * including incremental sync, manual triggers, and health check integration.
 
 * Test Coverage:
 * - Scheduled sync initialization and lifecycle
 * - Manual sync triggers via admin endpoint
 * - Incremental sync with last_synced_at tracking
 * - Concurrent sync prevention
 * - Error handling and recovery
 * - Statistics and status reporting
 * - Wallet sync status updates
 */

const ScheduledSyncService = require('../src/services/ScheduledSyncService');
const TransactionSyncService = require('../src/services/TransactionSyncService');
const Wallet = require('../src/routes/models/wallet');
const Transaction = require('../src/routes/models/transaction');

describe('Stellar Transaction History Synchronization (Issue #386)', () => {

  let syncService;
  let mockStellarService;

  beforeEach(() => {
    // Initialize fresh sync service for each test
    syncService = new ScheduledSyncService({
      syncIntervalMinutes: 1 // 1 minute for testing
    });

    // Mock stellar service
    mockStellarService = {
      getAccountTransactions: jest.fn()
    };

    // Clear any wallets from previous tests
    Wallet.saveWallets([]);
    Transaction.saveTransactions([]);
  });

  afterEach(() => {
    if (syncService && syncService.isScheduled) {
      syncService.stop();
    }
  });

  describe('ScheduledSyncService Initialization', () => {

    test('should initialize with default 15-minute interval', () => {
      const service = new ScheduledSyncService();
      expect(service.syncIntervalMinutes).toBe(15);
      expect(service.syncIntervalMs).toBe(15 * 60 * 1000);
    });

    test('should initialize with custom interval', () => {
      const service = new ScheduledSyncService({
        syncIntervalMinutes: 30
      });
      expect(service.syncIntervalMinutes).toBe(30);
      expect(service.syncIntervalMs).toBe(30 * 60 * 1000);
    });

    test('should start in unscheduled state', () => {
      expect(syncService.isScheduled).toBe(false);
      expect(syncService.isRunning).toBe(false);
      expect(syncService.lastSyncAt).toBeNull();
    });

    test('should provide initial sync status', () => {
      const status = syncService.getStatus();
      expect(status).toHaveProperty('isRunning', false);
      expect(status).toHaveProperty('isScheduled', false);
      expect(status).toHaveProperty('totalSynced', 0);
      expect(status).toHaveProperty('successCount', 0);
      expect(status).toHaveProperty('failureCount', 0);
    });
  });

  describe('Schedule Lifecycle', () => {

    test('should start and stop scheduling', () => {
      syncService.start();
      expect(syncService.isScheduled).toBe(true);
      expect(syncService.nextSyncAt).not.toBeNull();

      syncService.stop();
      expect(syncService.isScheduled).toBe(false);
      expect(syncService.nextSyncAt).toBeNull();
    });

    test('should prevent double-start', () => {
      syncService.start();
      syncService.start(); // Should be no-op
      expect(syncService.isScheduled).toBe(true);
    });

    test('should allow stop when not started', () => {
      syncService.stop(); // Should not throw
      expect(syncService.isScheduled).toBe(false);
    });

    test('should schedule next sync after start', (done) => {
      syncService = new ScheduledSyncService({
        syncIntervalMinutes: 0.01 // ~600ms for testing
      });

      const beforeStart = Date.now();
      syncService.start();

      setTimeout(() => {
        // After ~1 second, nextSyncAt should be set  
        const nextSync = syncService.nextSyncAt;
        expect(nextSync).not.toBeNull();
        expect(nextSync).toBeGreaterThan(beforeStart);
        syncService.stop();
        done();
      }, 500);
    });
  });

  describe('Manual Sync Trigger', () => {

    test('should trigger manual sync for all wallets', async () => {
      // Create test wallets
      const wallet1 = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet 1'
      });

      const wallet2 = Wallet.create({
        address: 'GCXVJWERO756YZY3MNXVJdadixgabe7KNMEYUCOW5JMKIVIIOZOZTEXF',
        label: 'Test Wallet 2'
      });

      // Mock sync for both wallets
      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockResolvedValueOnce({ synced: 5, transactions: [] })
        .mockResolvedValueOnce({ synced: 3, transactions: [] });

      const result = await syncService.triggerManualSync();

      expect(result.success).toBe(true);
      expect(result.walletsSync).toBe(2);
      expect(result.totalTransactions).toBe(8);
    });

    test('should prevent concurrent manual sync', async () => {
      syncService.isRunning = true;

      try {
        await syncService.triggerManualSync();
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toBe('Sync already in progress');
      }
    });

    test('should update wallet last_synced_at on manual sync', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      const beforeSync = Date.now();

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockResolvedValueOnce({ synced: 2, transactions: [] });

      await syncService.triggerManualSync();

      const updatedWallet = Wallet.getById(wallet.id);
      expect(updatedWallet.last_synced_at).toBeDefined();
      const syncTime = new Date(updatedWallet.last_synced_at).getTime();
      expect(syncTime).toBeGreaterThanOrEqual(beforeSync);
    });

    test('should handle sync errors gracefully', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockRejectedValueOnce(new Error('Network error'));

      try {
        await syncService.triggerManualSync();
        fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Network error' || 'failed');
      }

      const status = syncService.getStatus();
      expect(status.failureCount).toBe(1);
    });
  });

  describe('Incremental Sync', () => {

    test('should sync only new transactions with last_synced_at', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet',
        last_synced_at: new Date(Date.now() - 5 * 60000).toISOString() // 5 mins ago
      });

      const syncSpy = jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions');
      syncSpy.mockResolvedValueOnce({ synced: 3, transactions: [] });

      await syncService.syncAllWallets();

      expect(syncSpy).toHaveBeenCalledWith(wallet.address);
      const updatedWallet = Wallet.getById(wallet.id);
      expect(updatedWallet.last_synced_at).toBeDefined();
    });

    test('should track last_synced_at for newly synced wallets', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Unsynced Wallet'
      });

      expect(wallet.last_synced_at).toBeUndefined();

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockResolvedValueOnce({ synced: 1, transactions: [] });

      await syncService.syncAllWallets();

      const updatedWallet = Wallet.getById(wallet.id);
      expect(updatedWallet.last_synced_at).toBeDefined();
    });
  });

  describe('Sync Statistics', () => {

    test('should provide sync status information', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockResolvedValueOnce({ synced: 5, transactions: [] });

      await syncService.syncAllWallets();

      const status = syncService.getStatus();
      expect(status.isRunning).toBe(false);
      expect(status.lastSyncAt).not.toBeNull();
      expect(status.totalSynced).toBe(5);
      expect(status.walletsProcessed).toBe(1);
      expect(status.successCount).toBe(1);
      expect(status.failureCount).toBe(0);
    });

    test('should track sync duration', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockImplementationOnce(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return { synced: 1, transactions: [] };
        });

      await syncService.syncAllWallets();

      const status = syncService.getStatus();
      expect(status.syncDurationMs).toBeGreaterThanOrEqual(100);
    });

    test('should provide wallet statistics', async () => {
      Wallet.create({ address: 'addr1', label: 'Wallet 1' });
      Wallet.create({ address: 'addr2', label: 'Wallet 2', last_synced_at: new Date().toISOString() });
      Wallet.create({ address: 'addr3', label: 'Wallet 3' });

      const stats = syncService.getSyncStatistics();

      expect(stats.totalWallets).toBe(3);
      expect(stats.syncedWallets).toBe(1);
      expect(stats.unsyncedWallets).toBe(2);
    });

    test('should identify wallets needing sync', () => {
      const recentSync = new Date().toISOString();
      const oldSync = new Date(Date.now() - 30 * 60000).toISOString(); // 30 mins ago

      const wallet1 = {
        id: '1',
        last_synced_at: recentSync
      };

      const wallet2 = {
        id: '2',
        last_synced_at: oldSync
      };

      expect(syncService.needsSync(wallet1, 15)).toBe(false); // Recent sync
      expect(syncService.needsSync(wallet2, 15)).toBe(true);  // Old sync
    });
  });

  describe('Error Handling and Recovery', () => {

    test('should continue sync after individual wallet failure', async () => {
      Wallet.create({ address: 'addr1', label: 'Wallet 1' });
      Wallet.create({ address: 'addr2', label: 'Wallet 2' });
      Wallet.create({ address: 'addr3', label: 'Wallet 3' });

      const syncSpy = jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions');
      syncSpy
        .mockResolvedValueOnce({ synced: 1, transactions: [] })
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ synced: 2, transactions: [] });

      const result = await syncService.syncAllWallets();

      expect(result.walletsProcessed).toBe(2); // Only successful ones
      expect(result.totalSynced).toBe(3);
      expect(syncSpy).toHaveBeenCalledTimes(3);
    });

    test('should track errors in sync status', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      const error = new Error('Horizon API timeout');
      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockRejectedValueOnce(error);

      try {
        await syncService.syncAllWallets();
      } catch (e) {
        // Expected to propagate error
      }

      const status = syncService.getStatus();
      expect(status.lastError).toBeDefined();
      expect(status.lastError.message).toContain('timeout');
      expect(status.failureCount).toBe(1);
    });

    test('should not sync if already running', async () => {
      syncService.isRunning = true;

      const result = await syncService.syncAllWallets();

      expect(result.totalSynced).toBe(0);
      expect(result.walletsProcessed).toBe(0);
    });
  });

  describe('Multiple Wallet Synchronization', () => {

    test('should sync multiple wallets sequentially', async () => {
      const wallets = [
        Wallet.create({ address: 'addr1', label: 'Wallet 1' }),
        Wallet.create({ address: 'addr2', label: 'Wallet 2' }),
        Wallet.create({ address: 'addr3', label: 'Wallet 3' })
      ];

      const syncOrder = [];
      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockImplementation(async (address) => {
          syncOrder.push(address);
          return { synced: 1, transactions: [] };
        });

      await syncService.syncAllWallets();

      expect(syncOrder.length).toBe(3);
      expect(syncOrder).toEqual(['addr1', 'addr2', 'addr3']);
    });

    test('should handle mixed success and failure across wallets', async () => {
      Wallet.create({ address: 'addr1', label: 'Wallet 1' });
      Wallet.create({ address: 'addr2', label: 'Wallet 2' });
      Wallet.create({ address: 'addr3', label: 'Wallet 3' });

      const syncSpy = jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions');
      syncSpy
        .mockResolvedValueOnce({ synced: 5 })
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce({ synced: 3 });

      await syncService.syncAllWallets();

      const status = syncService.getStatus();
      expect(status.walletsProcessed).toBe(2);
      expect(status.totalSynced).toBe(8);
      expect(status.lastError).toBeDefined();
    });
  });

  describe('Edge Cases', () => {

    test('should handle empty wallet list', async () => {
      const result = await syncService.syncAllWallets();

      expect(result.totalSynced).toBe(0);
      expect(result.walletsProcessed).toBe(0);

      const status = syncService.getStatus();
      expect(status.successCount).toBe(0);
    });

    test('should handle very long sync duration', async () => {
      Wallet.create({ address: 'addr1', label: 'Wallet 1' });

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockImplementationOnce(async () => {
          await new Promise(resolve => setTimeout(resolve, 500));
          return { synced: 10, transactions: [] };
        });

      await syncService.syncAllWallets();

      const status = syncService.getStatus();
      expect(status.syncDurationMs).toBeGreaterThanOrEqual(500);
    });

    test('should handle zero transactions synced', async () => {
      Wallet.create({ address: 'addr1', label: 'Wallet 1' });

      jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockResolvedValueOnce({ synced: 0, transactions: [] });

      await syncService.syncAllWallets();

      const status = syncService.getStatus();
      expect(status.totalSynced).toBe(0);
      expect(status.successCount).toBe(1);
    });

    test('should reset statistics', () => {
      const status1 = syncService.getStatus();
      expect(status1.totalSynced).toBe(0);

      syncService.totalSynced = 100;
      syncService.successCount = 5;

      const status2 = syncService.getStatus();
      expect(status2.totalSynced).toBe(100);
      expect(status2.successCount).toBe(5);

      syncService.resetStatistics();

      const status3 = syncService.getStatus();
      expect(status3.totalSynced).toBe(0);
      expect(status3.successCount).toBe(0);
    });
  });

  describe('Concurrent Operations', () => {

    test('should prevent concurrent sync operations', async () => {
      const wallet = Wallet.create({
        address: 'GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIRUDZC2K6E3PORTS5NUAE3HF7I',
        label: 'Test Wallet'
      });

      const slowSync = jest.spyOn(syncService.transactionSyncService, 'syncWalletTransactions')
        .mockImplementationOnce(async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
          return { synced: 1, transactions: [] };
        });

      // Start first sync
      const sync1 = syncService.syncAllWallets();

      // Try to start second sync immediately
      const result2 = await syncService.syncAllWallets();

      expect(result2.totalSynced).toBe(0);
      expect(result2.walletsProcessed).toBe(0);

      // Wait for first sync to complete
      await sync1;
      expect(slowSync).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status and Configuration', () => {

    test('should provide complete status object', () => {
      const status = syncService.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('isScheduled');
      expect(status).toHaveProperty('lastSyncAt');
      expect(status).toHaveProperty('nextSyncAt');
      expect(status).toHaveProperty('totalSynced');
      expect(status).toHaveProperty('walletsProcessed');
      expect(status).toHaveProperty('syncDurationMs');
      expect(status).toHaveProperty('lastError');
      expect(status).toHaveProperty('successCount');
      expect(status).toHaveProperty('failureCount');
      expect(status).toHaveProperty('syncIntervalMinutes');
    });

    test('should provide complete sync statistics', () => {
      Wallet.create({ address: 'addr1' });

      const stats = syncService.getSyncStatistics();

      expect(stats).toHaveProperty('totalWallets');
      expect(stats).toHaveProperty('syncedWallets');
      expect(stats).toHaveProperty('unsyncedWallets');
      expect(stats).toHaveProperty('neededSyncWallets');
      expect(stats).toHaveProperty('pendingSyncWallets');
      expect(stats).toHaveProperty('averageSyncAgeMinutes');
      expect(stats).toHaveProperty('oldestSyncAgeMinutes');
      expect(stats).toHaveProperty('newestSyncAgeMinutes');
    });
  });
});
