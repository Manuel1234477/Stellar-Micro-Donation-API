/**
 * Memo Collision Detector
 *
 * RESPONSIBILITY: Detect duplicate memo usage within a time window and flag
 *   suspicious transactions where the same memo (e.g. student ID) is reused
 *   by different donors or with mismatched secondary validation fields.
 * OWNER: Security Team
 * DEPENDENCIES: Logger
 *
 * Strategy:
 *   1. Track every memo seen within a rolling time window (in-memory).
 *   2. On each new payment, check whether the same memo has already been used
 *      within the window — a "collision".
 *   3. Apply secondary validation: if the expected amount or session ID does
 *      not match the original payment, flag the transaction as suspicious.
 *   4. Emit structured log warnings (observability only — no blocking).
 */

const log = require('./log');

/**
 * Default configuration
 */
const DEFAULTS = {
  windowMs: 5 * 60 * 1000,   // 5-minute rolling window
  cleanupIntervalMs: 60 * 1000, // cleanup every 60 s
};

class MemoCollisionDetector {
  /**
   * @param {Object} [options]
   * @param {number} [options.windowMs]          - Collision detection window in ms
   * @param {number} [options.cleanupIntervalMs] - Cleanup timer interval in ms
   */
  constructor(options = {}) {
    this.windowMs = options.windowMs !== undefined
      ? options.windowMs
      : parseInt(process.env.MEMO_COLLISION_WINDOW_MS || String(DEFAULTS.windowMs), 10);

    this.cleanupIntervalMs = options.cleanupIntervalMs !== undefined
      ? options.cleanupIntervalMs
      : DEFAULTS.cleanupIntervalMs;

    /**
     * memo -> Array<{ donor, recipient, amount, sessionId, timestamp, transactionId }>
     * @type {Map<string, Array>}
     */
    this.memoStore = new Map();

    this._startCleanup();
  }

  /**
   * Record a payment and check for memo collisions.
   *
   * @param {Object} payment
   * @param {string}  payment.memo          - The memo value (e.g. student ID)
   * @param {string}  payment.donor         - Donor identifier
   * @param {string}  payment.recipient     - Recipient identifier
   * @param {number}  payment.amount        - Payment amount
   * @param {string}  [payment.sessionId]   - Optional session ID for secondary validation
   * @param {string}  [payment.transactionId] - Transaction ID for logging
   * @returns {{
   *   collision: boolean,
   *   suspicious: boolean,
   *   reason: string|null,
   *   priorPayments: Array
   * }}
   */
  check(payment) {
    const { memo, donor, recipient, amount, sessionId, transactionId } = payment;

    if (!memo || typeof memo !== 'string' || memo.trim() === '') {
      return { collision: false, suspicious: false, reason: null, priorPayments: [] };
    }

    const normalizedMemo = memo.trim();
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Retrieve and prune stale entries for this memo
    const prior = (this.memoStore.get(normalizedMemo) || [])
      .filter(p => p.timestamp >= cutoff);

    const result = this._evaluate(prior, { memo: normalizedMemo, donor, recipient, amount, sessionId, transactionId, timestamp: now });

    // Store the new entry
    prior.push({ donor, recipient, amount, sessionId: sessionId || null, timestamp: now, transactionId: transactionId || null });
    this.memoStore.set(normalizedMemo, prior);

    if (result.collision) {
      log.warn('MEMO_COLLISION', 'Memo collision detected', {
        memo: normalizedMemo,
        suspicious: result.suspicious,
        reason: result.reason,
        priorCount: prior.length - 1,
        transactionId: transactionId || null,
        donor,
        recipient,
      });
    }

    return result;
  }

  /**
   * Evaluate whether a new payment collides with prior ones and whether it
   * should be flagged as suspicious.
   *
   * @private
   */
  _evaluate(prior, current) {
    if (prior.length === 0) {
      return { collision: false, suspicious: false, reason: null, priorPayments: [] };
    }

    // Collision: same memo seen at least once in the window
    const collision = true;

    // Suspicious conditions (secondary validation failures)
    let suspicious = false;
    let reason = null;

    for (const p of prior) {
      // Different donor using the same memo → likely misattribution risk
      if (p.donor !== current.donor) {
        suspicious = true;
        reason = 'DIFFERENT_DONOR_SAME_MEMO';
        break;
      }

      // Same donor, but amount mismatch → possible tampering
      if (p.amount !== current.amount) {
        suspicious = true;
        reason = 'AMOUNT_MISMATCH';
        break;
      }

      // Session ID provided and mismatched → session hijack risk
      if (current.sessionId && p.sessionId && current.sessionId !== p.sessionId) {
        suspicious = true;
        reason = 'SESSION_ID_MISMATCH';
        break;
      }
    }

    return {
      collision,
      suspicious,
      reason,
      priorPayments: prior.map(p => ({
        donor: p.donor,
        recipient: p.recipient,
        amount: p.amount,
        timestamp: p.timestamp,
        transactionId: p.transactionId,
      })),
    };
  }

  /**
   * Return current in-memory stats (for observability endpoints).
   * @returns {{ trackedMemos: number, windowMs: number }}
   */
  getStats() {
    return {
      trackedMemos: this.memoStore.size,
      windowMs: this.windowMs,
    };
  }

  /**
   * Remove memo entries that have fully expired from the window.
   */
  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [memo, entries] of this.memoStore.entries()) {
      const fresh = entries.filter(e => e.timestamp >= cutoff);
      if (fresh.length === 0) {
        this.memoStore.delete(memo);
      } else {
        this.memoStore.set(memo, fresh);
      }
    }
  }

  /** @private */
  _startCleanup() {
    if (process.env.NODE_ENV !== 'test') {
      this._cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    }
  }

  stop() {
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
    }
  }
}

// Singleton for use across the application
const memoCollisionDetector = new MemoCollisionDetector();

module.exports = memoCollisionDetector;
module.exports.MemoCollisionDetector = MemoCollisionDetector;
module.exports.DEFAULTS = DEFAULTS;
