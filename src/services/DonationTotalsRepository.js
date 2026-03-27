/**
 * DonationTotalsRepository - Data Access Layer
 *
 * RESPONSIBILITY: Compute per-recipient donation totals from the transactions table
 * OWNER: Backend Team
 * DEPENDENCIES: Database utility
 */

const Database = require('../utils/database');

class DonationTotalsRepository {
  /**
   * Return a Map<recipientId, totalAmount> for the given recipient IDs within
   * the lookback window. Recipients with no transactions in the window get 0.
   *
   * @param {string[]} recipientIds  - array of recipient ID strings
   * @param {number}   lookbackWindowMs - milliseconds to look back from now
   * @returns {Promise<Map<string, number>>}
   */
  async getTotalsForPool(recipientIds, lookbackWindowMs) {
    const totals = new Map();
    if (recipientIds.length === 0) return totals;

    // Initialise all to 0
    for (const id of recipientIds) {
      totals.set(id, 0);
    }

    const cutoff = new Date(Date.now() - lookbackWindowMs).toISOString();
    const placeholders = recipientIds.map(() => '?').join(', ');

    const rows = await Database.all(
      `SELECT CAST(receiverId AS TEXT) AS recipient_id, SUM(amount) AS total
       FROM transactions
       WHERE CAST(receiverId AS TEXT) IN (${placeholders})
         AND deleted_at IS NULL
         AND timestamp >= ?
       GROUP BY receiverId`,
      [...recipientIds, cutoff]
    );

    for (const row of rows) {
      totals.set(row.recipient_id, row.total || 0);
    }

    return totals;
  }
}

module.exports = DonationTotalsRepository;
