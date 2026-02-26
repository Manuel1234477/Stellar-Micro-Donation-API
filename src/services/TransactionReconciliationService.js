/**
 * Transaction Reconciliation Service - Data Consistency Layer
 * 
 * RESPONSIBILITY: Ensures local transaction state matches blockchain reality
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Database, Transaction model
 * 
 * Background service that periodically verifies pending/submitted transactions against
 * the Stellar network and updates local state to maintain data consistency.
 */

const Database = require('../utils/database');
const Transaction = require('../routes/models/transaction');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const log = require('../utils/log');
const { v4: uuidv4 } = require('uuid');

class TransactionReconciliationService {
  constructor(stellarService) {
    this.stellarService = stellarService;
    this.intervalId = null;
    this.isRunning = false;
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.reconciliationInProgress = false;
  }

  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.reconcile();

    this.intervalId = setInterval(() => {
      this.reconcile();
    }, this.checkInterval);

    log.info('RECONCILIATION', 'Service started', { checkIntervalMinutes: this.checkInterval / 60000 });
  }

  stop() {
    if (!this.isRunning) {
      return;
    }

    clearInterval(this.intervalId);
    this.isRunning = false;
    log.info('RECONCILIATION', 'Service stopped');
  }

  async reconcile() {
    if (this.reconciliationInProgress) {
      log.debug('RECONCILIATION', 'Skipping - reconciliation already in progress');
      return;
    }

    this.reconciliationInProgress = true;

    try {
      const pendingTxs = Transaction.getByStatus(TRANSACTION_STATES.PENDING);
      const submittedTxs = Transaction.getByStatus(TRANSACTION_STATES.SUBMITTED);

      const txsToCheck = [...pendingTxs, ...submittedTxs];

      if (txsToCheck.length === 0) {
        log.debug('RECONCILIATION', 'No transactions to reconcile');
        return;
      }

      log.info('RECONCILIATION', 'Starting reconciliation', { count: txsToCheck.length });

      const results = await Promise.allSettled(
        txsToCheck.map(tx => this.reconcileTransaction(tx))
      );

      const corrected = results.filter(r => r.status === 'fulfilled' && r.value).length;
      const errors = results.filter(r => r.status === 'rejected').length;

      log.info('RECONCILIATION', 'Completed', { total: txsToCheck.length, corrected, errors });
      } catch (error) {
        log.error('RECONCILIATION', 'Error during reconciliation', { error: error.message });
      } finally {
        this.reconciliationInProgress = false;
      }
    });
  }

  async reconcileTransaction(tx) {
    if (!tx.stellarTxId) {
      log.debug('RECONCILIATION', 'Skipping transaction without stellarTxId', { id: tx.id });
      return false;
    }

    try {
      const result = await this.stellarService.verifyTransaction(tx.stellarTxId);

      if (result.verified && tx.status !== TRANSACTION_STATES.CONFIRMED) {
        Transaction.updateStatus(tx.id, TRANSACTION_STATES.CONFIRMED, {
          transactionId: tx.stellarTxId,
          ledger: result.transaction.ledger,
          confirmedAt: new Date().toISOString()
        });

        log.info('RECONCILIATION', 'Transaction corrected to confirmed', {
          id: tx.id,
          stellarTxId: tx.stellarTxId,
          previousStatus: tx.status
        });

        return true;
      }

      return false;
    } catch (error) {
      if (error.status === 404) {
        log.debug('RECONCILIATION', 'Transaction not found on network', {
          id: tx.id,
          stellarTxId: tx.stellarTxId
        });
        return false;
      }

      log.error('RECONCILIATION', 'Error verifying transaction', {
        id: tx.id,
        stellarTxId: tx.stellarTxId,
        error: error.message
      });

      throw error;
    }
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      checkIntervalMinutes: this.checkInterval / 60000,
      reconciliationInProgress: this.reconciliationInProgress
    };
  }
}

module.exports = TransactionReconciliationService;
