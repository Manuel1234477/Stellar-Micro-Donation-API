/**
 * Transaction Sync Scheduler - Background Synchronization Service
 *
 * RESPONSIBILITY: Periodically syncs all registered wallets with the Stellar network
 * OWNER: Backend Team
 * DEPENDENCIES: TransactionSyncService, Wallet model
 *
 * Runs on a configurable interval (default: 15 minutes) and syncs each wallet
 * incrementally using the last_cursor stored on the wallet record.
 * Partial failures are logged and skipped — the scheduler continues to the next wallet.
 */

const Wallet = require('../routes/models/wallet');
const TransactionSyncService = require('./TransactionSyncService');
const log = require('../utils/log');

/** Default sync interval: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

class TransactionSyncScheduler {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   * @param {Object} [options]
   * @param {number} [options.intervalMs] - Override sync interval in milliseconds
   */
  constructor(stellarService, options = {}) {
    this.syncService = new TransactionSyncService(stellarService);
    this.intervalMs = options.intervalMs
      || parseInt(process.env.TX_SYNC_INTERVAL_MS, 10)
      || DEFAULT_INTERVAL_MS;
    this.intervalId = null;
    this.isRunning = false;

    /** Timestamp of the last completed global sync (ISO string or null) */
    this.lastSyncAt = null;
    /** Result summary of the last completed global sync */
    this.lastSyncResult = null;
  }

  /**
   * Start the scheduler.
   * Runs an immediate sync, then repeats on every intervalMs.
   * @returns {void}
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    log.info('TX_SYNC_SCHEDULER', 'Scheduler started', {
      intervalMs: this.intervalMs,
    });
    this._runSync();
    this.intervalId = setInterval(() => this._runSync(), this.intervalMs);
  }

  /**
   * Stop the scheduler.
   * @returns {void}
   */
  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    log.info('TX_SYNC_SCHEDULER', 'Scheduler stopped');
  }

  /**
   * Trigger an immediate sync for all wallets.
   * Safe to call manually (e.g. from the admin endpoint).
   * @returns {Promise<{wallets: number, synced: number, errors: number, completedAt: string}>}
   */
  async syncAllWallets() {
    return this._runSync();
  }

  /**
   * Return the status of the last global sync for health reporting.
   * @returns {{lastSyncAt: string|null, lastSyncResult: Object|null}}
   */
  getSyncStatus() {
    return {
      lastSyncAt: this.lastSyncAt,
      lastSyncResult: this.lastSyncResult,
    };
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * Execute one full sync pass over all registered wallets.
   * Logs and continues on per-wallet errors (partial failure handling).
   * @returns {Promise<{wallets: number, synced: number, errors: number, completedAt: string}>}
   */
  async _runSync() {
    const wallets = Wallet.getAll();
    let totalSynced = 0;
    let errorCount = 0;

    log.info('TX_SYNC_SCHEDULER', 'Starting sync pass', { walletCount: wallets.length });

    for (const wallet of wallets) {
      try {
        const result = await this.syncService.syncWalletTransactions(wallet.address);
        totalSynced += result.synced;
      } catch (err) {
        errorCount++;
        log.error('TX_SYNC_SCHEDULER', 'Failed to sync wallet', {
          walletId: wallet.id,
          address: wallet.address,
          error: err.message,
        });
        // Continue to next wallet — partial failure handling
      }
    }

    const completedAt = new Date().toISOString();
    const result = {
      wallets: wallets.length,
      synced: totalSynced,
      errors: errorCount,
      completedAt,
    };

    this.lastSyncAt = completedAt;
    this.lastSyncResult = result;

    log.info('TX_SYNC_SCHEDULER', 'Sync pass complete', result);
    return result;
  }
}

module.exports = TransactionSyncScheduler;
