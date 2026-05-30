/**
 * RoundRobinStrategy
 *
 * Selects the recipient at the given currentIndex in the pool.
 * No exclusions — all pool members are eligible.
 */

class RoundRobinStrategy {
  /**
   * @param {Array<{id: string}>} pool
   * @param {{ currentIndex: number }} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, { currentIndex }) {
    const recipient = pool[currentIndex];
    return { selectedId: recipient.id, excludedIds: [] };
  }
}

module.exports = RoundRobinStrategy;
