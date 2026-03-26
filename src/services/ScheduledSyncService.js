/**
 * Scheduled Transaction Sync Service - Automatic Blockchain Synchronization
 *
 * RESPONSIBILITY: Schedule and manage automatic transaction synchronization for all wallets
 * OWNER: Backend Team
 * DEPENDENCIES: TransactionSyncService, Wallet model, log
 *
 * Runs transaction synchronization on a configurable schedule (default: every 15 minutes)
 * for all registered wallets, ensuring local database stays in sync with Stellar network.
 * Supports manual sync triggers and tracks sync status.
 */

const TransactionSyncService = require('./TransactionSyncService');
const Wallet = require('../routes/models/wallet');
const log = require('../utils/log');

/**
 * Sync status tracking
 * @typedef {Object} SyncStatus
 * @property {boolean} isRunning - Indicates if sync is currently running
 * @property {number} lastSyncAt - Timestamp of last completed sync
 * @property {number} nextSyncAt - Timestamp of next scheduled sync
 * @property {number} totalSynced - Total transactions synced across all wallets
 * @property {number} walletsProcessed - Number of wallets processed in current/last sync
 * @property {number} syncDurationMs - Duration of last sync in milliseconds
 * @property {Object} lastError - Last error encountered during sync
 * @property {number} successCount - Number of successful sync cycles
 * @property {number} failureCount - Number of failed sync cycles
 */

class ScheduledSyncService {
  /**
   * Create a new ScheduledSyncService instance
   * @param {Object} options - Configuration options
   * @param {number} [options.syncIntervalMinutes=15] - Sync interval in minutes
   * @param {Object} [options.stellarService] - Stellar service instance
   * @param {string} [options.horizonUrl] - Horizon server URL
   */
  constructor(options = {}) {
    this.syncIntervalMinutes = options.syncIntervalMinutes || 15;
    this.syncIntervalMs = this.syncIntervalMinutes * 60 * 1000;
    this.transactionSyncService = new TransactionSyncService(
      options.stellarService,
      options.horizonUrl
    );
    
    this.isScheduled = false;
    this.scheduleTimeoutId = null;
    this.isRunning = false;
    this.lastSyncAt = null;
    this.nextSyncAt = null;
    this.totalSynced = 0;
    this.walletsProcessed = 0;
    this.syncDurationMs = 0;
    this.lastError = null;
    this.successCount = 0;
    this.failureCount = 0;
  }

  /**
   * Get current sync status
   * @returns {SyncStatus} Current sync status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: this.isScheduled,
      lastSyncAt: this.lastSyncAt,
      nextSyncAt: this.nextSyncAt,
      totalSynced: this.totalSynced,
      walletsProcessed: this.walletsProcessed,
      syncDurationMs: this.syncDurationMs,
      lastError: this.lastError,
      successCount: this.successCount,
      failureCount: this.failureCount,
      syncIntervalMinutes: this.syncIntervalMinutes
    };
  }

  /**
   * Start scheduled sync
   * Begins periodic synchronization for all wallets
   */
  start() {
    if (this.isScheduled) {
      log.warn('TX_SYNC_SCHEDULE', 'Sync already scheduled');
      return;
    }

    this.isScheduled = true;
    log.info('TX_SYNC_SCHEDULE', 'Starting scheduled sync', {
      intervalMinutes: this.syncIntervalMinutes
    });

    // Run initial sync immediately
    this.scheduleNextSync(0);
  }

  /**
   * Stop scheduled sync
   * Cancels all pending sync operations
   */
  stop() {
    if (!this.isScheduled) {
      return;
    }

    if (this.scheduleTimeoutId) {
      clearTimeout(this.scheduleTimeoutId);
      this.scheduleTimeoutId = null;
    }

    this.isScheduled = false;
    this.nextSyncAt = null;
    
    log.info('TX_SYNC_SCHEDULE', 'Scheduled sync stopped');
  }

  /**
   * Schedule next sync after specified delay
   * @private
   * @param {number} [delayMs] - Delay before next sync (default: syncIntervalMs)
   */
  scheduleNextSync(delayMs) {
    if (!this.isScheduled) return;

    const delay = delayMs !== undefined ? delayMs : this.syncIntervalMs;
    this.nextSyncAt = Date.now() + delay;

    if (this.scheduleTimeoutId) {
      clearTimeout(this.scheduleTimeoutId);
    }

    this.scheduleTimeoutId = setTimeout(async () => {
      try {
        await this.syncAllWallets();
      } catch (error) {
        log.error('TX_SYNC_SCHEDULE', 'Scheduled sync failed', {
          error: error.message,
          stack: error.stack
        });
      } finally {
        // Schedule next sync regardless of success/failure
        this.scheduleNextSync();
      }
    }, delay);
  }

  /**
   * Manually trigger sync for all wallets
   * Used by POST /admin/sync endpoint
   * @returns {Promise<{success: boolean, walletssynced: number, totalTransactions: number}>}
   */
  async triggerManualSync() {
    if (this.isRunning) {
      throw new Error('Sync already in progress');
    }

    log.info('TX_SYNC_SCHEDULE', 'Manual sync triggered');

    try {
      const result = await this.syncAllWallets();
      return {
        success: true,
        walletsSync: result.walletsProcessed,
        totalTransactions: result.totalSynced
      };
    } catch (error) {
      log.error('TX_SYNC_SCHEDULE', 'Manual sync failed', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Synchronize transactions for all registered wallets
   * Runs sequentially to avoid overloading Horizon API
   * @private
   * @returns {Promise<{totalSynced: number, walletsProcessed: number, duration: number}>}
   */
  async syncAllWallets() {
    if (this.isRunning) {
      log.warn('TX_SYNC_SCHEDULE', 'Sync already in progress, skipping');
      return {
        totalSynced: 0,
        walletsProcessed: 0,
        duration: 0
      };
    }

    this.isRunning = true;
    const startTime = Date.now();
    let totalSynced = 0;
    let walletsProcessed = 0;
    let hasError = false;

    try {
      const wallets = Wallet.getAll();

      if (wallets.length === 0) {
        log.info('TX_SYNC_SCHEDULE', 'No wallets to sync');
        return {
          totalSynced: 0,
          walletsProcessed: 0,
          duration: 0
        };
      }

      log.info('TX_SYNC_SCHEDULE', 'Starting sync for all wallets', {
        walletCount: wallets.length
      });

      // Process wallets sequentially to avoid API rate limiting
      for (const wallet of wallets) {
        try {
          const result = await this.transactionSyncService.syncWalletTransactions(
            wallet.address
          );

          totalSynced += result.synced;
          walletsProcessed++;

          // Update wallet with sync timestamp
          Wallet.update(wallet.id, {
            last_synced_at: new Date().toISOString()
          });

          log.debug('TX_SYNC_SCHEDULE', 'Wallet synced', {
            address: wallet.address,
            transactionsSynced: result.synced
          });
        } catch (error) {
          hasError = true;
          log.warn('TX_SYNC_SCHEDULE', 'Failed to sync wallet', {
            address: wallet.address,
            error: error.message
          });
          // Continue with next wallet instead of failing entirely
        }
      }

      const duration = Date.now() - startTime;
      
      // Update sync statistics
      this.lastSyncAt = Date.now();
      this.totalSynced = totalSynced;
      this.walletsProcessed = walletsProcessed;
      this.syncDurationMs = duration;
      this.lastError = null;
      this.successCount++;

      log.info('TX_SYNC_SCHEDULE', 'Sync cycle completed', {
        walletsProcessed,
        totalTransactionsSynced: totalSynced,
        durationMs: duration,
        hasErrors: hasError
      });

      return {
        totalSynced,
        walletsProcessed,
        duration
      };
    } catch (error) {
      this.lastError = {
        message: error.message,
        timestamp: new Date().toISOString()
      };
      this.failureCount++;

      log.error('TX_SYNC_SCHEDULE', 'Sync cycle failed', {
        error: error.message,
        walletsProcessed,
        transactionsSynced: totalSynced
      });

      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check if a wallet needs synchronization
   * @param {Object} wallet - Wallet object
   * @param {number} [maxAgeMinutes=15] - Maximum age of last sync before needing update
   * @returns {boolean} True if wallet needs sync
   */
  needsSync(wallet, maxAgeMinutes = 15) {
    if (!wallet.last_synced_at) {
      return true; // Never synced
    }

    const lastSyncTime = new Date(wallet.last_synced_at).getTime();
    const ageMs = Date.now() - lastSyncTime;
    const maxAgeMs = maxAgeMinutes * 60 * 1000;

    return ageMs > maxAgeMs;
  }

  /**
   * Get sync statistics for all wallets
   * @returns {Object} Sync statistics
   */
  getSyncStatistics() {
    const wallets = Wallet.getAll();
    const now = Date.now();
    const metricsMinutes = 60; // Last hour

    const stats = {
      totalWallets: wallets.length,
      syncedWallets: 0,
      unsyncedWallets: 0,
      neededSyncWallets: 0,
      pendingSyncWallets: 0,
      averageSyncAgeMinutes: 0,
      oldestSyncAgeMinutes: 0,
      newestSyncAgeMinutes: Number.MAX_VALUE
    };

    let totalAgeMs = 0;

    for (const wallet of wallets) {
      if (wallet.last_synced_at) {
        stats.syncedWallets++;
        const ageMs = now - new Date(wallet.last_synced_at).getTime();
        const ageMinutes = ageMs / (60 * 1000);

        totalAgeMs += ageMs;
        stats.oldestSyncAgeMinutes = Math.max(stats.oldestSyncAgeMinutes, ageMinutes);
        stats.newestSyncAgeMinutes = Math.min(stats.newestSyncAgeMinutes, ageMinutes);

        if (this.needsSync(wallet)) {
          stats.neededSyncWallets++;
        }
      } else {
        stats.unsyncedWallets++;
        stats.pendingSyncWallets++;
      }
    }

    if (stats.syncedWallets > 0) {
      stats.averageSyncAgeMinutes = totalAgeMs / stats.syncedWallets / (60 * 1000);
      stats.newestSyncAgeMinutes = stats.newestSyncAgeMinutes === Number.MAX_VALUE ? 0 : stats.newestSyncAgeMinutes;
    }

    return stats;
  }

  /**
   * Reset all statistics (for testing)
   * @private
   */
  resetStatistics() {
    this.totalSynced = 0;
    this.walletsProcessed = 0;
    this.syncDurationMs = 0;
    this.lastError = null;
    this.successCount = 0;
    this.failureCount = 0;
    this.lastSyncAt = null;
    this.nextSyncAt = null;
  }
}

module.exports = ScheduledSyncService;
