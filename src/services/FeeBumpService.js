/**
 * Fee Bump Service - Fee Bump Orchestration Layer
 *
 * RESPONSIBILITY: Detects stuck transactions and orchestrates fee bumps
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService, Transaction model, AuditLogService
 *
 * Handles automatic detection of stuck transactions (pending > 5 min),
 * fee bump execution with adaptive fees from Horizon, retry tracking
 * (max 3 attempts), and hard fee cap enforcement (0.1 XLM).
 */

const Transaction = require('../routes/models/transaction');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const { NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

/** Maximum number of fee bump attempts per transaction */
const MAX_FEE_BUMP_ATTEMPTS = 3;

/** Transactions in SUBMITTED state longer than this are considered stuck */
const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/** Hard cap on fee bump fee in stroops (0.1 XLM) */
const MAX_FEE_CAP_STROOPS = 1_000_000;

class FeeBumpService {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   * @param {Object} auditLogService - AuditLogService for logging fee bump events
   * @param {Object} [config={}] - Optional configuration overrides
   * @param {number} [config.maxAttempts] - Override MAX_FEE_BUMP_ATTEMPTS
   * @param {number} [config.stuckThresholdMs] - Override STUCK_THRESHOLD_MS
   * @param {number} [config.maxFeeCapStroops] - Override MAX_FEE_CAP_STROOPS
   * @param {string} [config.feeSourceSecret] - Secret key for fee source account
   */
  constructor(stellarService, auditLogService, config = {}) {
    this.stellarService = stellarService;
    this.auditLogService = auditLogService;
    this.maxAttempts = config.maxAttempts || MAX_FEE_BUMP_ATTEMPTS;
    this.stuckThresholdMs = config.stuckThresholdMs || STUCK_THRESHOLD_MS;
    this.maxFeeCapStroops = config.maxFeeCapStroops || MAX_FEE_CAP_STROOPS;
    this.feeSourceSecret = config.feeSourceSecret || null;
  }

  /**
   * Apply a fee bump to a transaction.
   * @param {string} transactionId - Internal transaction ID
   * @param {number|null} [newFee=null] - Fee in stroops. If null, queries network for recommended fee.
   * @param {string} [feeSourceSecret] - Override fee source secret key
   * @returns {Promise<{success: boolean, transactionId: string, originalFee: number, newFee: number, feeBumpCount: number, hash: string}>}
   */
  async feeBump(transactionId, newFee = null, feeSourceSecret = null) {
    const tx = Transaction.getById(transactionId);
    if (!tx) {
      throw new NotFoundError(
        `Transaction not found: ${transactionId}`,
        ERROR_CODES.TRANSACTION_NOT_FOUND
      );
    }

    if (tx.status !== TRANSACTION_STATES.SUBMITTED) {
      throw new BusinessLogicError(
        ERROR_CODES.FEE_BUMP_INVALID_STATE,
        `Transaction must be in submitted state to fee bump. Current state: ${tx.status}`
      );
    }

    if (!tx.envelopeXdr) {
      throw new BusinessLogicError(
        ERROR_CODES.FEE_BUMP_NO_ENVELOPE,
        'Transaction has no stored envelope XDR. Fee bump requires the original transaction envelope.'
      );
    }

    if (tx.feeBumpCount >= this.maxAttempts) {
      throw new BusinessLogicError(
        ERROR_CODES.FEE_BUMP_MAX_ATTEMPTS,
        `Transaction has reached maximum fee bump attempts (${this.maxAttempts}). Manual intervention required.`
      );
    }

    // Determine fee
    let feeStroops = newFee;
    const feeSource = feeSourceSecret || this.feeSourceSecret;

    try {
      if (feeStroops === null || feeStroops === undefined) {
        const feeEstimate = await this.stellarService.estimateFee(1);
        feeStroops = feeEstimate.feeStroops;
        // Ensure bumped fee is higher than current
        if (feeStroops <= (tx.currentFee || 0)) {
          feeStroops = (tx.currentFee || 100) * 2;
        }
      }

      // Enforce cap
      if (feeStroops > this.maxFeeCapStroops) {
        throw new BusinessLogicError(
          ERROR_CODES.FEE_BUMP_EXCEEDS_CAP,
          `Fee ${feeStroops} stroops exceeds cap of ${this.maxFeeCapStroops} stroops (${this.maxFeeCapStroops / 1e7} XLM).`
        );
      }
      const result = await this.stellarService.buildAndSubmitFeeBumpTransaction(
        tx.envelopeXdr,
        feeStroops,
        feeSource
      );

      const now = new Date().toISOString();
      const newCount = (tx.feeBumpCount || 0) + 1;

      Transaction.updateFeeBumpData(transactionId, {
        feeBumpCount: newCount,
        currentFee: feeStroops,
        lastFeeBumpAt: now,
        envelopeXdr: result.envelopeXdr,
        stellarTxId: result.hash,
      });

      // Audit log
      this.auditLogService.log({
        category: this.auditLogService.CATEGORY.ADMIN,
        action: this.auditLogService.ACTION.FEE_BUMP_APPLIED,
        severity: this.auditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        details: {
          transactionId,
          originalFee: tx.currentFee || tx.originalFee,
          newFee: feeStroops,
          feeBumpCount: newCount,
          stellarHash: result.hash,
        },
      }).catch(() => {});

      log.info('FEE_BUMP', 'Fee bump applied', {
        transactionId,
        originalFee: tx.currentFee || tx.originalFee,
        newFee: feeStroops,
        attempt: newCount,
      });

      return {
        success: true,
        transactionId,
        originalFee: tx.currentFee || tx.originalFee,
        newFee: feeStroops,
        feeBumpCount: newCount,
        hash: result.hash,
      };
    } catch (error) {
      // Don't re-throw our own validation errors
      if (error.errorCode && error.errorCode.startsWith && error.errorCode.startsWith('FEE_BUMP_')) {
        throw error;
      }

      this.auditLogService.log({
        category: this.auditLogService.CATEGORY.ADMIN,
        action: this.auditLogService.ACTION.FEE_BUMP_FAILED,
        severity: this.auditLogService.SEVERITY.HIGH,
        result: 'FAILURE',
        details: {
          transactionId,
          attemptedFee: feeStroops,
          error: error.message,
        },
      }).catch(() => {});

      log.error('FEE_BUMP', 'Fee bump failed', {
        transactionId,
        error: error.message,
      });

      throw new BusinessLogicError(
        ERROR_CODES.FEE_BUMP_FAILED,
        `Fee bump failed for transaction ${transactionId}: ${error.message}`
      );
    }
  }

  /**
   * Detect transactions stuck in SUBMITTED state longer than the threshold.
   * @returns {Array<Object>} List of stuck transactions
   */
  detectStuckTransactions() {
    const submitted = Transaction.getByStatus(TRANSACTION_STATES.SUBMITTED);
    const now = Date.now();

    return submitted.filter(tx => {
      const updatedAt = new Date(tx.statusUpdatedAt || tx.timestamp).getTime();
      const isStuck = (now - updatedAt) > this.stuckThresholdMs;
      const hasAttemptsLeft = (tx.feeBumpCount || 0) < this.maxAttempts;
      return isStuck && hasAttemptsLeft;
    });
  }

  /**
   * Automatically process all stuck transactions with fee bumps.
   * @returns {Promise<{processed: number, succeeded: number, failed: number, skipped: number}>}
   */
  async processStuckTransactions() {
    const stuckTransactions = this.detectStuckTransactions();

    if (stuckTransactions.length === 0) {
      return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };
    }

    log.info('FEE_BUMP', 'Processing stuck transactions', {
      count: stuckTransactions.length,
    });

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const tx of stuckTransactions) {
      if (!tx.envelopeXdr) {
        skipped++;
        continue;
      }

      try {
        await this.feeBump(tx.id);
        succeeded++;
      } catch (error) {
        failed++;
        log.warn('FEE_BUMP', 'Auto fee bump failed', {
          transactionId: tx.id,
          error: error.message,
        });
      }
    }

    const result = {
      processed: stuckTransactions.length,
      succeeded,
      failed,
      skipped,
    };

    log.info('FEE_BUMP', 'Stuck transaction processing complete', result);
    return result;
  }
}

module.exports = FeeBumpService;
