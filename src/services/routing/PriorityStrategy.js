/**
 * PriorityStrategy
 *
 * Selects the recipient with the highest `priority` value (numeric, higher = more urgent).
 * Defaults to 0 if absent. Tiebreaks by lexicographically smallest id.
 * All pool members are eligible.
 */

class PriorityStrategy {
  /**
   * @param {Array<{id: string, priority?: number}>} pool
   * @param {Object} _context  - unused, kept for interface consistency
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, _context = {}) {
    let maxPriority = -Infinity;
    let selectedId = null;

    for (const recipient of pool) {
      const p = typeof recipient.priority === 'number' ? recipient.priority : 0;
      if (p > maxPriority || (p === maxPriority && recipient.id < selectedId)) {
        maxPriority = p;
        selectedId = recipient.id;
      }
    }

    return { selectedId, excludedIds: [] };
  }
}

module.exports = PriorityStrategy;
