/**
 * LowestTotalStrategy
 *
 * Selects the recipient with the lowest total donations received.
 * Helps balance distribution across a portfolio of charities.
 */

class LowestTotalStrategy {
  /**
   * @param {Array<{id: string}>} pool
   * @param {{ donationTotals: Map<string, number> }} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, { donationTotals = new Map() }) {
    if (pool.length === 0) {
      throw new Error('Pool is empty');
    }

    // Sort recipients by total donations received (ascending)
    const sorted = pool.map(r => ({
      id: r.id,
      total: donationTotals.get(r.id) || 0,
    })).sort((a, b) => a.total - b.total);

    return { selectedId: sorted[0].id, excludedIds: [] };
  }
}

module.exports = LowestTotalStrategy;
