'use strict';

/**
 * DonationTotalsRepository - Data Access Layer
 *
 * RESPONSIBILITY: Maintain and query per-recipient/global donation totals.
 *
 * Pre-aggregated totals live in the `donation_totals` and
 * `donation_totals_global` tables, written atomically with each donation.
 * A periodic reconciliation job recomputes totals from the source-of-truth
 * `transactions` table and corrects any drift.
 *
 * All stroop amounts are accumulated as BigInt and stored as TEXT strings so
 * they survive the JavaScript Number ↔ SQLite INTEGER round-trip without
 * precision loss beyond 2^53.
 */

const Database = require('../utils/database');
const log = require('../utils/log');


/** Simple in-process drift metric counter. */
const driftMetrics = {
  lastRunAt: null,
  driftCorrectionCount: 0,
  lastDriftDetectedAt: null,
};

class DonationTotalsRepository {
  /**
   * Read pre-aggregated totals for the given recipient IDs from the
   * `donation_totals` table.  Falls back to a live `SUM` from `transactions`
   * for any recipient not yet in the totals table.
   *
   * Returns amounts as BigInt (stroops).
   *
   * @param {string[]} recipientIds
   * @param {number} lookbackWindowMs - milliseconds to look back from now
   * @returns {Promise<Map<string, BigInt>>}
   */
  async getTotalsForPool(recipientIds, lookbackWindowMs) {
    const totals = new Map();
    if (recipientIds.length === 0) return totals;

    for (const id of recipientIds) {
      totals.set(id, 0n);
    }

    const cutoff = new Date(Date.now() - lookbackWindowMs).toISOString();
    const placeholders = recipientIds.map(() => '?').join(', ');

    // Cast the SUM to INTEGER then TEXT so the sqlite3 driver delivers an exact
    // integer string to JavaScript — avoiding the lossy Number round-trip that
    // would occur for totals larger than 2^53 stroops.
    const rows = await Database.all(
      `SELECT CAST(receiverId AS TEXT) AS recipient_id,
              CAST(CAST(ROUND(SUM(amount)) AS INTEGER) AS TEXT) AS total
       FROM transactions
       WHERE CAST(receiverId AS TEXT) IN (${placeholders})
         AND deleted_at IS NULL
         AND timestamp >= ?
       GROUP BY receiverId`,
      [...recipientIds, cutoff]
    );

    for (const row of rows) {
      totals.set(row.recipient_id, BigInt(row.total || '0'));
    }

    return totals;
  }

  /**
   * Increment the pre-aggregated totals for a recipient within a DB
   * transaction. Must be called with the `tx` object from
   * `Database.runTransaction()` so the update is atomic with the donation
   * INSERT.
   *
   * @param {string} recipientId
   * @param {bigint|number} amountStroops
   * @param {{ run: Function }} tx - Bound DB helpers from runTransaction
   */
  async incrementTotal(recipientId, amountStroops, tx) {
    const stroops = String(BigInt(amountStroops));
    const id = String(recipientId);

    await tx.run(
      `INSERT INTO donation_totals (recipient_id, total_stroops, donation_count, updated_at)
       VALUES (?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(recipient_id) DO UPDATE SET
         total_stroops = CAST(CAST(total_stroops AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
         donation_count = donation_count + 1,
         updated_at = CURRENT_TIMESTAMP`,
      [id, stroops, stroops]
    );

    await tx.run(
      `UPDATE donation_totals_global SET
         total_stroops = CAST(CAST(total_stroops AS INTEGER) + CAST(? AS INTEGER) AS TEXT),
         donation_count = donation_count + 1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [stroops]
    );
  }

  /**
   * Recompute totals from the source-of-truth `transactions` table and
   * correct any drift in the pre-aggregated `donation_totals` table.
   *
   * Emits a log warning and increments driftMetrics when drift is found.
   *
   * @returns {Promise<{ checked: number, corrected: number }>}
   */
  async reconcile() {
    driftMetrics.lastRunAt = new Date().toISOString();

    const sourceRows = await Database.all(
      `SELECT CAST(receiverId AS TEXT) AS recipient_id,
              CAST(CAST(ROUND(SUM(amount)) AS INTEGER) AS TEXT) AS true_total,
              COUNT(*) AS true_count
       FROM transactions
       WHERE deleted_at IS NULL
       GROUP BY receiverId`
    );

    let corrected = 0;

    for (const row of sourceRows) {
      const trueTotal = BigInt(row.true_total || '0');
      const trueCount = Number(row.true_count);

      const existing = await Database.get(
        'SELECT total_stroops, donation_count FROM donation_totals WHERE recipient_id = ?',
        [row.recipient_id]
      );

      const cachedTotal = BigInt(existing?.total_stroops || '0');
      const cachedCount = existing?.donation_count || 0;

      if (cachedTotal !== trueTotal || cachedCount !== trueCount) {
        driftMetrics.driftCorrectionCount += 1;
        driftMetrics.lastDriftDetectedAt = new Date().toISOString();

        log.warn('DONATION_TOTALS', 'Drift detected — correcting pre-aggregated totals', {
          recipientId: row.recipient_id,
          cachedTotal: cachedTotal.toString(),
          trueTotal: trueTotal.toString(),
          cachedCount,
          trueCount,
        });

        await Database.run(
          `INSERT INTO donation_totals (recipient_id, total_stroops, donation_count, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(recipient_id) DO UPDATE SET
             total_stroops = excluded.total_stroops,
             donation_count = excluded.donation_count,
             updated_at = excluded.updated_at`,
          [row.recipient_id, trueTotal.toString(), trueCount]
        );

        corrected += 1;
      }
    }

    // Reconcile global row
    const globalSource = await Database.get(
      `SELECT CAST(CAST(ROUND(SUM(amount)) AS INTEGER) AS TEXT) AS true_total, COUNT(*) AS true_count
       FROM transactions WHERE deleted_at IS NULL`
    );
    const trueGlobalTotal = BigInt(globalSource?.true_total || '0');
    const trueGlobalCount = Number(globalSource?.true_count || 0);
    const globalRow = await Database.get(
      'SELECT total_stroops, donation_count FROM donation_totals_global WHERE id = 1'
    );
    const cachedGlobalTotal = BigInt(globalRow?.total_stroops || '0');

    if (cachedGlobalTotal !== trueGlobalTotal) {
      await Database.run(
        `UPDATE donation_totals_global SET
           total_stroops = ?, donation_count = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = 1`,
        [trueGlobalTotal.toString(), trueGlobalCount]
      );
      corrected += 1;
    }

    if (corrected > 0) {
      log.warn('DONATION_TOTALS', 'Reconciliation corrected drift', {
        corrected,
        totalDriftCorrections: driftMetrics.driftCorrectionCount,
      });
    }

    return { checked: sourceRows.length, corrected };
  }

  /** Return a snapshot of reconciliation metrics for observability. */
  getMetrics() {
    return { ...driftMetrics };
  }
}

module.exports = DonationTotalsRepository;
