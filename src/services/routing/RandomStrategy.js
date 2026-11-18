/**
 * RandomStrategy
 *
 * Randomly selects a recipient from the pool.
 * All pool members are eligible.
 */

class RandomStrategy {
  /**
   * @param {Array<{id: string}>} pool
   * @param {Object} context
   * @returns {{ selectedId: string, excludedIds: string[] }}
   */
  select(pool, context = {}) {
    if (pool.length === 0) {
      throw new Error('Pool is empty');
    }

    const randomIndex = Math.floor(Math.random() * pool.length);
    const recipient = pool[randomIndex];

    return { selectedId: recipient.id, excludedIds: [] };
  }
}

module.exports = RandomStrategy;
