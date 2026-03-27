/**
 * RoundRobinStateRepository - Data Access Layer
 *
 * RESPONSIBILITY: Persist and update the per-pool round-robin index
 * OWNER: Backend Team
 * DEPENDENCIES: Database utility
 */

const Database = require('../utils/database');

class RoundRobinStateRepository {
  /**
   * Get the current next_index for a pool. Returns 0 if no row exists.
   * @param {string} poolName
   * @returns {Promise<number>}
   */
  async getIndex(poolName) {
    const row = await Database.get(
      `SELECT next_index FROM round_robin_state WHERE pool_name = ?`,
      [poolName]
    );
    return row ? row.next_index : 0;
  }

  /**
   * Atomically increment the index and wrap at poolSize.
   * Returns the index that was used BEFORE incrementing (i.e., the selection index).
   * @param {string} poolName
   * @param {number} poolSize
   * @returns {Promise<number>} the index used for this selection
   */
  async incrementAndWrap(poolName, poolSize) {
    const current = await this.getIndex(poolName);
    const next = (current + 1) % poolSize;
    await Database.run(
      `INSERT INTO round_robin_state (pool_name, next_index, updatedAt)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(pool_name) DO UPDATE SET next_index = excluded.next_index, updatedAt = excluded.updatedAt`,
      [poolName, next]
    );
    return current;
  }

  /**
   * Reset the index to 0 for a pool.
   * @param {string} poolName
   */
  async reset(poolName) {
    await Database.run(
      `INSERT INTO round_robin_state (pool_name, next_index, updatedAt)
       VALUES (?, 0, CURRENT_TIMESTAMP)
       ON CONFLICT(pool_name) DO UPDATE SET next_index = 0, updatedAt = CURRENT_TIMESTAMP`,
      [poolName]
    );
  }
}

module.exports = RoundRobinStateRepository;
