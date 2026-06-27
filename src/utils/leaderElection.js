'use strict';

/**
 * Leader Election / Single-flight — DB-backed distributed lease for background schedulers.
 *
 * Each instance has a unique instanceId (hostname + PID).  Before a scheduled
 * job tick runs, it calls acquireLease(name, ttlMs).  The call performs an
 * atomic upsert on the scheduler_locks table:
 *
 *   • If no lock exists for that name → INSERT, return true (we are leader).
 *   • If a lock exists but has expired OR we already hold it → UPDATE, return true.
 *   • If a valid lock is held by another instance → no change, return false (skip tick).
 *
 * Because SQLite serialises writes, only one concurrent caller can win the INSERT
 * for a given name; subsequent callers always read the winner's holder_id.
 *
 * Crashed leaders are superseded automatically once their lease TTL expires.
 * Recommended TTL: ~1.5 × tick interval so a healthy leader always renews before
 * expiry while a crashed leader's slot reopens within 1.5 ticks.
 *
 * Requires migration 024_scheduler_locks (scheduler_locks table).
 */

const os = require('os');
const log = require('./log');

function getDb() {
  try {
    return require('./database');
  } catch (_) {
    return null;
  }
}

class LeaderElection {
  constructor(options = {}) {
    this.instanceId = options.instanceId ||
      `${os.hostname()}-${process.pid}`;
  }

  /**
   * Attempt to acquire (or renew) the named lease.
   *
   * @param {string} name   - Unique job name (e.g. 'recurring_donation_scheduler')
   * @param {number} ttlMs  - Lease duration in milliseconds
   * @returns {Promise<boolean>} true if this instance holds the lease, false otherwise
   */
  async acquireLease(name, ttlMs) {
    const db = getDb();
    if (!db) return true; // No DB available — fail-open (single-instance safe)

    const now = Date.now();
    const expires = now + ttlMs;

    try {
      // Single atomic upsert:
      //   New row     → INSERT with our id.
      //   Expired row → CASE WHEN updates holder_id/times to ours.
      //   Our row     → CASE WHEN renews expiry.
      //   Other live  → CASE WHEN keeps existing values (no change for us).
      await db.run(
        `INSERT INTO scheduler_locks (name, holder_id, acquired_at, expires_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           holder_id   = CASE WHEN expires_at < ? OR holder_id = ?
                              THEN excluded.holder_id   ELSE holder_id   END,
           acquired_at = CASE WHEN expires_at < ? OR holder_id = ?
                              THEN excluded.acquired_at ELSE acquired_at END,
           expires_at  = CASE WHEN expires_at < ? OR holder_id = ?
                              THEN excluded.expires_at  ELSE expires_at  END`,
        [name, this.instanceId, now, expires,
         now, this.instanceId,
         now, this.instanceId,
         now, this.instanceId]
      );

      const row = await db.get(
        'SELECT holder_id FROM scheduler_locks WHERE name = ?',
        [name]
      );

      const isLeader = Boolean(row && row.holder_id === this.instanceId);

      if (!isLeader) {
        log.debug('LEADER_ELECTION', 'Lease held by another instance — skipping tick', {
          job: name,
          holder: row && row.holder_id,
          ourId: this.instanceId,
        });
      }

      return isLeader;
    } catch (err) {
      log.warn('LEADER_ELECTION', 'acquireLease error — failing open', {
        job: name,
        error: err.message,
      });
      return true; // fail-open: if DB is broken, let the job run
    }
  }

  /**
   * Release a lease early (e.g. on graceful shutdown so another instance takes over sooner).
   * Fails silently — non-critical.
   *
   * @param {string} name
   * @returns {Promise<void>}
   */
  async releaseLease(name) {
    const db = getDb();
    if (!db) return;
    try {
      await db.run(
        'DELETE FROM scheduler_locks WHERE name = ? AND holder_id = ?',
        [name, this.instanceId]
      );
    } catch (_) { /* non-critical */ }
  }
}

module.exports = new LeaderElection();
module.exports.LeaderElection = LeaderElection;
