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
const Transaction = require('../models/transaction');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const log = require('../utils/log');
const WebhookService = require('./WebhookService');
const timerRegistry = require('../utils/timerRegistry');

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
    this.checkInterval = 10 * 60 * 1000; // 10 minutes
    this.reconciliationInProgress = false;

    /** Running tally of orphaned transactions detected across all reconciliation cycles */
    this.orphanedTransactionCount = 0;
  }

  /**
   * Set the FeeBumpService for automatic fee bumping during reconciliation.
   * @param {Object} feeBumpService - FeeBumpService instance
   */
  setFeeBumpService(feeBumpService) {
    this.feeBumpService = feeBumpService;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Start the background reconciliation loop */
  start() {
    if (this.isRunning) return;

    this.isRunning = true;
    this.reconcile();

    this.intervalId = timerRegistry.createInterval(
      () => this.reconcile(),
      this.checkInterval,
      'tx-reconciliation'
    );
    this.intervalId.unref();

    log.info('RECONCILIATION', 'Service started', {
      checkIntervalMinutes: this.checkInterval / 60000,
    });
  }

  /** Stop the background reconciliation loop */
  stop() {
    if (!this.isRunning) return;

    if (this.intervalId) {
      this.intervalId.clear();
      this.intervalId = null;
    }
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
      return { corrected: 0, errors: 0, orphansDetected: 0, orphansCompensated: 0, feeBumpsApplied: 0, feeBumpErrors: 0 };
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

      // 3. Process stuck transactions with fee bumps
      let feeBumpsApplied = 0;
      let feeBumpErrors = 0;
      if (this.feeBumpService) {
        try {
          const feeBumpResult = await this.feeBumpService.processStuckTransactions();
          feeBumpsApplied = feeBumpResult.succeeded;
          feeBumpErrors = feeBumpResult.failed;
        } catch (error) {
          log.error('RECONCILIATION', 'Fee bump processing failed', { error: error.message });
        }
      }

      log.info('RECONCILIATION', 'Cycle complete', {
        corrected,
        errors,
        orphansDetected: detected,
        orphansCompensated: compensated,
        feeBumpsApplied,
        feeBumpErrors,
      });

      return { corrected, errors, orphansDetected: detected, orphansCompensated: compensated, feeBumpsApplied, feeBumpErrors };
    } catch (error) {
      log.error('RECONCILIATION', 'Error during reconciliation cycle', {
        error: error.message,
      });
      return { corrected: 0, errors: 1, orphansDetected: 0, orphansCompensated: 0, feeBumpsApplied: 0, feeBumpErrors: 0 };
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

      if (result.verified) {
        // Check for amount/memo drift against the on-chain record
        this._checkFieldDrift(tx, result);

        if (tx.status !== TRANSACTION_STATES.CONFIRMED) {
          // Try to auto-confirm; if the state machine rejects the transition, flag for manual review
          try {
            Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED, {
              transactionId: tx.stellarTxId,
              ledger: result.transaction && result.transaction.ledger,
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

            WebhookService.deliver('transaction.confirmed', {
              id: tx.id,
              stellarTxId: tx.stellarTxId,
              previousStatus: tx.status,
            }).catch(err => {
              log.warn('RECONCILIATION', 'Failed to deliver confirmation webhook', { error: err.message });
            });

            return true;
          } catch (stateErr) {
            log.warn('RECONCILIATION', 'State transition rejected — flagging for manual review', {
              id: tx.id,
              error: stateErr.message,
            });
            return false;
          }
        }
      }

      return false;
    } catch (error) {
      log.error('RECONCILIATION', 'Failed to verify transaction', {
        id: tx.id,
        stellarTxId: tx.stellarTxId,
        error: error.message,
      });
      throw error;
    }
  }

  // ─── Orphan detection & compensation ─────────────────────────────────────

  /**
   * Detect on-chain transactions that have no local DB record and compensate
   * by inserting a local record for each orphaned transaction.
   *
   * Batch-safe: each candidate is processed independently so a single failure
   * never aborts the whole batch.
   *
   * @returns {Promise<{detected: number, compensated: number}>}
   */
  async detectAndCompensateOrphans() {
    let detected = 0;
    let compensated = 0;

    let candidates = [];
    try {
      candidates = await this._fetchOrphanCandidates();
    } catch (error) {
      log.error('RECONCILIATION', 'Failed to fetch orphan candidates', { error: error.message });
      return { detected: 0, compensated: 0 };
    }

    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { detected: 0, compensated: 0 };
    }

    for (const candidate of candidates) {
      try {
        const isOrphan = await this._isOrphan(candidate);
        if (!isOrphan) continue;

        detected += 1;
        this.orphanedTransactionCount += 1;

        await this._compensateOrphan(candidate);
        compensated += 1;
      } catch (error) {
        // Per-item error handling: log and continue with the rest of the batch
        log.error('RECONCILIATION', 'Failed to compensate orphaned transaction', {
          candidate: candidate && (candidate.id || candidate.transactionId || candidate.hash),
          error: error.message,
        });
      }
    }

    if (detected >= ORPHAN_ALERT_THRESHOLD) {
      log.warn('RECONCILIATION', 'Orphaned transactions detected', {
        detected,
        compensated,
        threshold: ORPHAN_ALERT_THRESHOLD,
      });
    }

    return { detected, compensated };
  }

  /**
   * Fetch candidate on-chain transactions that may be missing locally.
   * Prefers a Horizon-backed lookup by memo/idempotency key when available.
   *
   * @returns {Promise<Array<object>>}
   */
  async _fetchOrphanCandidates() {
    if (typeof this.stellarService.getRecentTransactions === 'function') {
      return await this.stellarService.getRecentTransactions();
    }
    if (typeof this.stellarService.listRecentTransactions === 'function') {
      return await this.stellarService.listRecentTransactions();
    }
    return [];
  }

  /**
   * Determine whether a candidate on-chain transaction lacks a local record.
   * Matches by stellarTxId/hash first, then by memo/idempotency key.
   *
   * @param {object} candidate
   * @returns {Promise<boolean>}
   */
  async _isOrphan(candidate) {
    const hash = candidate.hash || candidate.transactionId || candidate.stellarTxId;
    if (hash) {
      const existing = Transaction.findByStellarTxId
        ? Transaction.findByStellarTxId(hash)
        : null;
      if (existing) return false;
    }

    const memo = candidate.memo || candidate.idempotencyKey;
    if (memo && typeof Transaction.findByIdempotencyKey === 'function') {
      const existing = Transaction.findByIdempotencyKey(memo);
      if (existing) return false;
    }

    return true;
  }

  /**
   * Insert a local record for an orphaned on-chain transaction.
   *
   * @param {object} candidate
   * @returns {Promise<void>}
   */
  async _compensateOrphan(candidate) {
    const hash = candidate.hash || candidate.transactionId || candidate.stellarTxId;
    const memo = candidate.memo || candidate.idempotencyKey;

    const record = {
      id: candidate.id || hash || memo,
      stellarTxId: hash,
      idempotencyKey: memo,
      amount: candidate.amount,
      asset: candidate.asset,
      senderId: candidate.senderId,
      receiverId: candidate.receiverId,
      status: TRANSACTION_STATES.CONFIRMED,
      reconciled: true,
      reconciledAt: new Date().toISOString(),
    };

    if (typeof Transaction.create === 'function') {
      Transaction.create(record);
    } else if (typeof Transaction.insert === 'function') {
      Transaction.insert(record);
    } else {
      throw new Error('Transaction model does not support creating reconciled records');
    }

    log.info('RECONCILIATION', 'Compensated orphaned transaction', {
      id: record.id,
      stellarTxId: hash,
      idempotencyKey: memo,
    });

    WebhookService.deliver('transaction.reconciled', {
      id: record.id,
      stellarTxId: hash,
      idempotencyKey: memo,
    }).catch(err => {
      log.warn('RECONCILIATION', 'Failed to deliver reconciliation webhook', { error: err.message });
    });
  }

  /**
   * Compare on-chain fields against the local record and log any drift.
   *
   * @param {object} tx - Local transaction record
   * @param {object} result - Verification result from StellarService
   */
  _checkFieldDrift(tx, result) {
    const onChain = result.transaction || {};

    if (onChain.amount !== undefined && tx.amount !== undefined && Number(onChain.amount) !== Number(tx.amount)) {
      log.warn('RECONCILIATION', 'Amount drift detected', {
        id: tx.id,
        localAmount: tx.amount,
        onChainAmount: onChain.amount,
      });
    }

    if (onChain.memo !== undefined && tx.memo !== undefined && onChain.memo !== tx.memo) {
      log.warn('RECONCILIATION', 'Memo drift detected', {
        id: tx.id,
        localMemo: tx.memo,
        onChainMemo: onChain.memo,
      });
    }
  }
}

module.exports = TransactionReconciliationService;
