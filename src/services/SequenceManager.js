/**
 * Enhanced Stellar Sequence Number Manager with Concurrency and Cross-Instance Support
 * 
 * Implements proper reserve/commit/release lifecycle for sequence allocation.
 * Supports cross-instance coordination via database locking.
 * Reconciles with Horizon to recover from gaps and drift.
 *
 * Issue #1105: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1105
 */

const crypto = require('crypto');
const db = require('../utils/database');
const log = require('../utils/log');

const DEFAULT_CONFIG = {
  lockTimeoutMs: 30000,           // 30s lock timeout
  reservationExpiryMs: 300000,    // 5min before reservation times out
  reconciliationIntervalMs: 60000, // 1min reconciliation interval
};

/**
 * Initialize sequence management tables for distributed coordination
 */
async function initSequenceTables() {
  await db.run(`
    CREATE TABLE IF NOT EXISTS sequence_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_address TEXT NOT NULL,
      sequence_number TEXT NOT NULL,
      state TEXT NOT NULL, -- 'reserved', 'committed', 'released'
      instance_id TEXT NOT NULL,
      reserved_at INTEGER NOT NULL,
      committed_at INTEGER,
      released_at INTEGER,
      transaction_hash TEXT,
      error_reason TEXT,
      UNIQUE(account_address, sequence_number)
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS sequence_locks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_address TEXT UNIQUE NOT NULL,
      locked_by TEXT NOT NULL,
      locked_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      UNIQUE(account_address)
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_allocations_account 
    ON sequence_allocations(account_address, state)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_allocations_instance
    ON sequence_allocations(instance_id, state)
  `);

  log.info('SEQ_MANAGER', 'Sequence management tables initialized');
}

/**
 * Creates a new SequenceManager with distributed coordination
 */
class SequenceManager {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.instanceId = process.env.INSTANCE_ID || crypto.randomUUID();
    this.cache = new Map(); // Local cache of highest committed sequence per account
    this.metrics = { reserved: 0, committed: 0, released: 0, gaps_detected: 0 };
  }

  /**
   * Reserve the next sequence number for an account.
   * Acquires a global lock, fetches current on-chain sequence, allocates next, and returns it.
   * Must be followed by commit() or release().
   *
   * @param {string} accountAddress - Stellar account public key
   * @param {Object} [horizonClient] - Optional Horizon client for fetching on-chain state
   * @returns {Promise<{ sequence: string, reservationId: string }>}
   */
  async reserve(accountAddress, horizonClient) {
    await initSequenceTables();

    // Acquire global lock for this account
    const lock = await this._acquireLock(accountAddress);
    if (!lock) {
      throw new Error(`Could not acquire lock for account ${accountAddress}`);
    }

    try {
      // Fetch current on-chain sequence
      let onChainSequence;
      try {
        onChainSequence = horizonClient
          ? await this._fetchFromHorizon(horizonClient, accountAddress)
          : await this._getLastCommittedSequence(accountAddress);
      } catch (err) {
        log.warn('SEQ_MANAGER', 'Failed to fetch from Horizon, using cache', { accountAddress, error: err.message });
        onChainSequence = this.cache.get(accountAddress) || '0';
      }

      // Allocate next sequence
      const nextSequence = String(BigInt(onChainSequence) + 1n);

      // Reserve in database
      const now = Date.now();
      await db.run(`
        INSERT INTO sequence_allocations
        (account_address, sequence_number, state, instance_id, reserved_at)
        VALUES (?, ?, 'reserved', ?, ?)
      `, [accountAddress, nextSequence, this.instanceId, now]);

      this.metrics.reserved++;

      log.info('SEQ_MANAGER', 'Sequence reserved', {
        account: accountAddress,
        sequence: nextSequence,
        instanceId: this.instanceId,
      });

      return {
        sequence: nextSequence,
        reservationId: `${accountAddress}:${nextSequence}:${this.instanceId}`,
      };
    } finally {
      // Release lock
      await this._releaseLock(accountAddress);
    }
  }

  /**
   * Commit a reserved sequence after transaction submission succeeds.
   *
   * @param {string} reservationId - ID returned from reserve()
   * @param {string} [transactionHash] - Optional transaction hash from Stellar
   * @returns {Promise<void>}
   */
  async commit(reservationId, transactionHash = null) {
    await initSequenceTables();
    const [accountAddress, sequence] = reservationId.split(':');

    const now = Date.now();
    const result = await db.run(`
      UPDATE sequence_allocations
      SET state = 'committed', committed_at = ?, transaction_hash = ?
      WHERE account_address = ? AND sequence_number = ? AND state = 'reserved'
    `, [now, transactionHash, accountAddress, sequence]);

    if (result.changes === 0) {
      throw new Error(`Reservation not found or already processed: ${reservationId}`);
    }

    // Update cache
    this.cache.set(accountAddress, sequence);
    this.metrics.committed++;

    log.info('SEQ_MANAGER', 'Sequence committed', {
      account: accountAddress,
      sequence,
      transactionHash,
    });
  }

  /**
   * Release a reserved sequence if transaction submission fails.
   * Allows reclamation on next reconciliation.
   *
   * @param {string} reservationId - ID returned from reserve()
   * @param {string} [reason] - Reason for release (e.g., 'submission_failed')
   * @returns {Promise<void>}
   */
  async release(reservationId, reason = null) {
    await initSequenceTables();
    const [accountAddress, sequence] = reservationId.split(':');

    const now = Date.now();
    await db.run(`
      UPDATE sequence_allocations
      SET state = 'released', released_at = ?, error_reason = ?
      WHERE account_address = ? AND sequence_number = ? AND state = 'reserved'
    `, [now, reason, accountAddress, sequence]);

    this.metrics.released++;

    log.warn('SEQ_MANAGER', 'Sequence released', {
      account: accountAddress,
      sequence,
      reason,
    });
  }

  /**
   * Reconcile local view with Horizon and recover from gaps.
   * Detects abandoned reservations and out-of-band transactions.
   *
   * @param {string} accountAddress - Stellar account public key
   * @param {Object} horizonClient - Horizon client for fetching on-chain state
   * @returns {Promise<{ gap_detected: boolean, recovered: number }>}
   */
  async reconcile(accountAddress, horizonClient) {
    await initSequenceTables();

    try {
      const onChainSequence = await this._fetchFromHorizon(horizonClient, accountAddress);
      const lastCommitted = this.cache.get(accountAddress) || '0';

      // Check for gaps or drift
      const onChainBig = BigInt(onChainSequence);
      const committedBig = BigInt(lastCommitted);

      if (onChainBig > committedBig + 1n) {
        this.metrics.gaps_detected++;
        log.warn('SEQ_MANAGER', 'Gap detected during reconciliation', {
          account: accountAddress,
          onChain: onChainSequence,
          lastCommitted,
          gap: onChainBig - committedBig - 1n,
        });

        // Mark gap-filling reservations as reconciled
        const gap = onChainBig - committedBig - 1n;
        this.cache.set(accountAddress, onChainSequence);
        return { gap_detected: true, recovered: Number(gap) };
      }

      // Clean up abandoned (released) reservations older than expiry window
      const expiryTime = Date.now() - this.cfg.reservationExpiryMs;
      const result = await db.run(`
        DELETE FROM sequence_allocations
        WHERE account_address = ? AND state = 'released' AND released_at < ?
      `, [accountAddress, expiryTime]);

      return { gap_detected: false, recovered: result.changes || 0 };
    } catch (err) {
      log.error('SEQ_MANAGER', 'Reconciliation failed', {
        account: accountAddress,
        error: err.message,
      });
      throw err;
    }
  }

  /**
   * Clean up expired reservations (crash recovery).
   * Called periodically by a background job.
   *
   * @returns {Promise<number>} Number of expired reservations reclaimed
   */
  async cleanupExpiredReservations() {
    await initSequenceTables();

    const expiryTime = Date.now() - this.cfg.reservationExpiryMs;
    const result = await db.run(`
      UPDATE sequence_allocations
      SET state = 'released', released_at = ?
      WHERE state = 'reserved' AND reserved_at < ?
    `, [Date.now(), expiryTime]);

    const count = result.changes || 0;
    if (count > 0) {
      log.info('SEQ_MANAGER', 'Expired reservations reclaimed', { count });
    }
    return count;
  }

  // ─── Private Helpers ───────────────────────────────────────

  async _acquireLock(accountAddress) {
    const now = Date.now();
    const expiresAt = now + this.cfg.lockTimeoutMs;

    try {
      // Try to insert lock (fails if already locked)
      await db.run(`
        INSERT INTO sequence_locks (account_address, locked_by, locked_at, expires_at)
        VALUES (?, ?, ?, ?)
      `, [accountAddress, this.instanceId, now, expiresAt]);
      return true;
    } catch (err) {
      // Check if existing lock has expired
      const existingLock = await db.get(`
        SELECT expires_at FROM sequence_locks WHERE account_address = ?
      `, [accountAddress]);

      if (existingLock && existingLock.expires_at > now) {
        // Lock is still active
        return false;
      }

      // Stale lock, update it
      await db.run(`
        UPDATE sequence_locks
        SET locked_by = ?, locked_at = ?, expires_at = ?
        WHERE account_address = ?
      `, [this.instanceId, now, expiresAt, accountAddress]);
      return true;
    }
  }

  async _releaseLock(accountAddress) {
    await db.run(`
      DELETE FROM sequence_locks WHERE account_address = ?
    `, [accountAddress]);
  }

  async _getLastCommittedSequence(accountAddress) {
    const row = await db.get(`
      SELECT sequence_number FROM sequence_allocations
      WHERE account_address = ? AND state = 'committed'
      ORDER BY sequence_number DESC LIMIT 1
    `, [accountAddress]);

    return row ? row.sequence_number : '0';
  }

  async _fetchFromHorizon(horizonClient, accountAddress) {
    try {
      const account = await horizonClient.accounts().accountId(accountAddress).call();
      return account.sequence;
    } catch (err) {
      throw new Error(`Failed to fetch from Horizon: ${err.message}`);
    }
  }

  getMetrics() {
    return { ...this.metrics, instanceId: this.instanceId };
  }
}

module.exports = { SequenceManager, initSequenceTables };
