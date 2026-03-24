/**
 * Transaction Reconciliation Service - Data Consistency Layer
 *
 * RESPONSIBILITY: Ensures local transaction state matches blockchain reality,
 *                 detects orphaned Stellar transactions, and compensates by
 *                 creating local records for any blockchain tx missing from the DB.
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database, Transaction model, log
 *
 * Background service that periodically:
 *  1. Verifies pending/submitted transactions against the Stellar network.
 *  2. Detects orphaned Stellar transactions (on-chain but no local DB record).
 *  3. Compensates by inserting a local record for each orphaned transaction.
 *  4. Emits alerts when the orphan count exceeds a configurable threshold.
 */

const Database = require('../utils/database');
const Transaction = require('../routes/models/transaction');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const log = require('../utils/log');
const WebhookService = require('./WebhookService');

/** Orphan count threshold that triggers an alert */
const ORPHAN_ALERT_THRESHOLD = parseInt(process.env.ORPHAN_ALERT_THRESHOLD || '1', 10);

class TransactionReconciliationService {
  /**
   * @param {object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
    this.intervalId = null;
    this.isRunning = false;
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.reconciliationInProgress = false;

    /** Running tally of orphaned transactions detected across all reconciliation cycles */
    this.orphanedTransactionCount = 0;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Start the background reconciliation loop */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.reconcile();

    this.intervalId = setInterval(() => {
      this.reconcile();
    }, this.checkInterval);

    log.info('RECONCILIATION', 'Service started', {
      checkIntervalMinutes: this.checkInterval / 60000,
    });
  }

  /** Stop the background reconciliation loop */
  stop() {
    if (!this.isRunning) return;

    clearInterval(this.intervalId);
    this.isRunning = false;
    log.info('RECONCILIATION', 'Service stopped');
  }

  // ─── Main reconciliation cycle ────────────────────────────────────────────

  /**
   * Run one full reconciliation cycle:
   *  - Reconcile known pending/submitted transactions
   *  - Detect and compensate orphaned Stellar transactions
   *
   * @returns {Promise<{corrected: number, errors: number, orphansDetected: number, orphansCompensated: number}>}
   */
  async reconcile() {
    if (this.reconciliationInProgress) {
      log.debug('RECONCILIATION', 'Skipping — reconciliation already in progress');
      return { corrected: 0, errors: 0, orphansDetected: 0, orphansCompensated: 0 };
    }

    this.reconciliationInProgress = true;

    try {
      // 1. Reconcile known transactions
      const pendingTxs = Transaction.getByStatus(TRANSACTION_STATES.PENDING);
      const submittedTxs = Transaction.getByStatus(TRANSACTION_STATES.SUBMITTED);
      const txsToCheck = [...pendingTxs, ...submittedTxs];

      let corrected = 0;
      let errors = 0;

      if (txsToCheck.length > 0) {
        log.info('RECONCILIATION', 'Reconciling known transactions', {
          count: txsToCheck.length,
        });

        const results = await Promise.allSettled(
          txsToCheck.map(tx => this.reconcileTransaction(tx))
        );

        corrected = results.filter(r => r.status === 'fulfilled' && r.value).length;
        errors = results.filter(r => r.status === 'rejected').length;
      }

      // 2. Detect and compensate orphaned Stellar transactions
      const { detected, compensated } = await this.detectAndCompensateOrphans();

      log.info('RECONCILIATION', 'Cycle complete', {
        corrected,
        errors,
        orphansDetected: detected,
        orphansCompensated: compensated,
      });

      return { corrected, errors, orphansDetected: detected, orphansCompensated: compensated };
    } catch (error) {
      log.error('RECONCILIATION', 'Error during reconciliation cycle', {
        error: error.message,
      });
      return { corrected: 0, errors: 1, orphansDetected: 0, orphansCompensated: 0 };
    } finally {
      this.reconciliationInProgress = false;
    }
  }

  // ─── Known-transaction reconciliation ────────────────────────────────────

  /**
   * Verify a single known transaction against the Stellar network and update
   * its local state if it has been confirmed on-chain.
   *
   * @param {object} tx - Transaction object from the JSON store
   * @returns {Promise<boolean>} true if the local record was updated
   */
  async reconcileTransaction(tx) {
    if (!tx.stellarTxId) {
      log.debug('RECONCILIATION', 'Skipping transaction without stellarTxId', {
        id: tx.id,
      });
      return false;
    }

    try {
      const result = await this.stellarService.verifyTransaction(tx.stellarTxId);

      if (result.verified && tx.status !== TRANSACTION_STATES.CONFIRMED) {
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED, {
          transactionId: tx.stellarTxId,
          ledger: result.transaction.ledger,
          confirmedAt: new Date().toISOString(),
        });
        
        // Invalidate caching for wallets involved in this transaction
        const Cache = require('../utils/cache');
        const Database = require('../utils/database');
        
        try {
          if (tx.senderId) {
            const sender = await Database.get('SELECT publicKey FROM users WHERE id = ?', [tx.senderId]);
            if (sender) Cache.delete(`wallet_balance_${sender.publicKey}`);
          }
          if (tx.receiverId) {
            const receiver = await Database.get('SELECT publicKey FROM users WHERE id = ?', [tx.receiverId]);
            if (receiver) Cache.delete(`wallet_balance_${receiver.publicKey}`);
          }
        } catch (cacheErr) {
          log.warn('RECONCILIATION', 'Failed to clear cache for confirmed transaction', { error: cacheErr.message });
        }

        log.info('RECONCILIATION', 'Transaction corrected to confirmed', {
          id: tx.id,
          stellarTxId: tx.stellarTxId,
          previousStatus: tx.status,
        });

        // Deliver webhook for state change
        WebhookService.deliver('transaction.confirmed', {
          id: tx.id,
          stellarTxId: tx.stellarTxId,
          previousStatus: tx.status,
          status: TRANSACTION_STATES.CONFIRMED,
          ledger: result.transaction && result.transaction.ledger,
          confirmedAt: new Date().toISOString(),
        }).catch(err => log.warn('RECONCILIATION', 'Webhook delivery error', { error: err.message }));

        return true;
      }

      return false;
    } catch (error) {
      if (error.status === 404 || (error.statusCode === 404)) {
        log.debug('RECONCILIATION', 'Transaction not found on network', {
          id: tx.id,
          stellarTxId: tx.stellarTxId,
        });
        return false;
      }

      log.error('RECONCILIATION', 'Error verifying transaction', {
        id: tx.id,
        stellarTxId: tx.stellarTxId,
        error: error.message,
      });

      throw error;
    }
  }

  // ─── Orphan detection & compensation ─────────────────────────────────────

  /**
   * Detect orphaned Stellar transactions — those that exist on-chain but have
   * no corresponding local DB record — and compensate by inserting a local record.
   *
   * An orphan arises when the Stellar transaction succeeds but the subsequent
   * database write fails (partial failure scenario).
   *
   * @returns {Promise<{detected: number, compensated: number, orphans: Array}>}
   */
  async detectAndCompensateOrphans() {
    // Fetch all stellar_tx_ids already recorded in the DB
    let knownStellarIds;
    try {
      const rows = await Database.query(
        'SELECT stellar_tx_id FROM transactions WHERE stellar_tx_id IS NOT NULL',
        []
      );
      knownStellarIds = new Set(rows.map(r => r.stellar_tx_id));
    } catch (err) {
      log.error('RECONCILIATION', 'Failed to fetch known stellar_tx_ids', {
        error: err.message,
      });
      return { detected: 0, compensated: 0, orphans: [] };
    }

    // Collect all Stellar transactions from the mock/real service
    const stellarTxs = this._getAllStellarTransactions();

    const orphans = stellarTxs.filter(tx => !knownStellarIds.has(tx.transactionId));

    if (orphans.length === 0) {
      return { detected: 0, compensated: 0, orphans: [] };
    }

    log.warn('RECONCILIATION', 'Orphaned Stellar transactions detected', {
      count: orphans.length,
    });

    // Alert if threshold exceeded
    this.orphanedTransactionCount += orphans.length;
    if (orphans.length >= ORPHAN_ALERT_THRESHOLD) {
      this._emitOrphanAlert(orphans);
    }

    // Compensate each orphan
    let compensated = 0;
    for (const orphan of orphans) {
      const success = await this.compensateOrphan(orphan);
      if (success) compensated++;
    }

    return { detected: orphans.length, compensated, orphans };
  }

  /**
   * Create a local DB record for a single orphaned Stellar transaction.
   *
   * @param {object} orphan - Stellar transaction object
   * @param {string} orphan.transactionId - Stellar transaction ID
   * @param {string} orphan.source - Source public key
   * @param {string} orphan.destination - Destination public key
   * @param {string|number} orphan.amount - Amount in XLM
   * @param {string} [orphan.memo] - Optional memo
   * @param {string} [orphan.timestamp] - ISO timestamp
   * @returns {Promise<boolean>} true if compensation succeeded
   */
  async compensateOrphan(orphan) {
    try {
      // Resolve sender and receiver user IDs from public keys
      const sender = await Database.get(
        'SELECT id FROM users WHERE publicKey = ?',
        [orphan.source]
      );
      const receiver = await Database.get(
        'SELECT id FROM users WHERE publicKey = ?',
        [orphan.destination]
      );

      const senderId = sender ? sender.id : null;
      const receiverId = receiver ? receiver.id : null;

      await Database.run(
        `INSERT OR IGNORE INTO transactions
           (senderId, receiverId, amount, memo, timestamp, stellar_tx_id, is_orphan)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [
          senderId,
          receiverId,
          parseFloat(orphan.amount),
          orphan.memo || null,
          orphan.timestamp || new Date().toISOString(),
          orphan.transactionId,
        ]
      );

      log.info('RECONCILIATION', 'Orphan compensated — local record created', {
        stellarTxId: orphan.transactionId,
        source: orphan.source,
        destination: orphan.destination,
        amount: orphan.amount,
      });

      return true;
    } catch (err) {
      log.error('RECONCILIATION', 'Failed to compensate orphan', {
        stellarTxId: orphan.transactionId,
        error: err.message,
      });
      return false;
    }
  }

  // ─── Alerting ─────────────────────────────────────────────────────────────

  /**
   * Emit an alert when orphaned transactions exceed the configured threshold.
   * Logs at ERROR level so it surfaces in monitoring pipelines.
   *
   * @param {Array} orphans - Array of orphaned transaction objects
   */
  _emitOrphanAlert(orphans) {
    log.error('RECONCILIATION', 'ALERT: Orphaned transactions exceed threshold', {
      threshold: ORPHAN_ALERT_THRESHOLD,
      count: orphans.length,
      totalLifetime: this.orphanedTransactionCount,
      stellarTxIds: orphans.map(o => o.transactionId),
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Collect all transactions from the Stellar service's in-memory store.
   * Works with MockStellarService; real implementations would query Horizon.
   *
   * @returns {Array} Flat, deduplicated list of Stellar transaction objects
   * @private
   */
  _getAllStellarTransactions() {
    // MockStellarService exposes this.stellarService.transactions (Map)
    if (
      this.stellarService &&
      this.stellarService.transactions instanceof Map
    ) {
      const seen = new Set();
      const all = [];
      for (const txList of this.stellarService.transactions.values()) {
        for (const tx of txList) {
          const id = tx.transactionId || tx.hash;
          if (id && !seen.has(id)) {
            seen.add(id);
            // Normalise hash-based records (sendPayment) to transactionId
            all.push({ ...tx, transactionId: id });
          }
        }
      }
      return all;
    }
    return [];
  }

  // ─── Status ───────────────────────────────────────────────────────────────

  /**
   * Return current service status for health-check and stats endpoints.
   *
   * @returns {{isRunning: boolean, checkIntervalMinutes: number, reconciliationInProgress: boolean, orphanedTransactionCount: number}}
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMinutes: this.checkInterval / 60000,
      reconciliationInProgress: this.reconciliationInProgress,
      orphanedTransactionCount: this.orphanedTransactionCount,
    };
  }

  /**
   * Return the total number of orphaned transactions detected since service start.
   *
   * @returns {number}
   */
  getOrphanedTransactionCount() {
    return this.orphanedTransactionCount;
  }
}

module.exports = TransactionReconciliationService;
