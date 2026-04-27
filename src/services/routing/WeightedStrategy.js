/**
 * WeightedStrategy
 *
 * Selects a recipient by weighted random distribution based on each member's
 * `weight` field (defaults to 1 if absent). Higher weight = higher probability
 * of selection. All pool members are eligible.
 */

class WeightedStrategy {
  /**
   * @param {Array<{id: string, weight?: number}>} pool
   * @param {Object} _context  - unused, kept for interface consistency
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, _context = {}) {
    const weights = pool.map(r => (typeof r.weight === 'number' && r.weight > 0 ? r.weight : 1));
    const total = weights.reduce((sum, w) => sum + w, 0);

    let rand = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      rand -= weights[i];
      if (rand <= 0) {
        return { selectedId: pool[i].id, excludedIds: [] };
      }
    }

    // Fallback (floating-point edge case)
    return { selectedId: pool[pool.length - 1].id, excludedIds: [] };
  }
}

module.exports = WeightedStrategy;
