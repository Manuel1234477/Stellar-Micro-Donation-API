/**
 * HighestNeedStrategy
 *
 * Selects the recipient with the lowest total donations received within the
 * lookback window. Tiebreaks by lexicographically smallest id.
 */

class HighestNeedStrategy {
  /**
   * @param {Array<{id: string}>} pool  - pool members
   * @param {{ donationTotals: Map<string, number> }} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, { donationTotals }) {
    let minTotal = Infinity;
    let selectedId = null;

    for (const recipient of pool) {
      const total = donationTotals.get(recipient.id) ?? 0;
      if (
        total < minTotal ||
        (total === minTotal && recipient.id < selectedId)
      ) {
        minTotal = total;
        selectedId = recipient.id;
      }
    }

    return { selectedId, excludedIds: [] };
  }
}

module.exports = HighestNeedStrategy;
