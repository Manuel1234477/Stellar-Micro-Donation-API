/**
 * RoutingConfigRepository - Data Access Layer
 *
 * RESPONSIBILITY: Persist and retrieve the active routing strategy per pool
 * OWNER: Backend Team
 * DEPENDENCIES: Database utility
 */

const Database = require('../utils/database');

class RoutingConfigRepository {
  /**
   * Set (upsert) the active strategy for a pool.
   * @param {string} poolName
   * @param {string} strategy
   * @returns {Promise<void>}
   */
  async setStrategy(poolName, strategy) {
    await Database.run(
      `INSERT INTO routing_config (pool_name, strategy, updatedAt)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(pool_name) DO UPDATE SET strategy = excluded.strategy, updatedAt = excluded.updatedAt`,
      [poolName, strategy]
    );
  }

  /**
   * Get the active strategy for a pool. Returns null if not configured.
   * @param {string} poolName
   * @returns {Promise<{poolName: string, strategy: string, updatedAt: string}|null>}
   */
  async getStrategy(poolName) {
    const row = await Database.get(
      `SELECT pool_name, strategy, updatedAt FROM routing_config WHERE pool_name = ?`,
      [poolName]
    );
    if (!row) return null;
    return { poolName: row.pool_name, strategy: row.strategy, updatedAt: row.updatedAt };
  }

  /**
   * List all configured pool strategies.
   * @returns {Promise<Array<{poolName: string, strategy: string, updatedAt: string}>>}
   */
  async listAll() {
    const rows = await Database.all(
      `SELECT pool_name, strategy, updatedAt FROM routing_config ORDER BY updatedAt DESC`
    );
    return rows.map(r => ({ poolName: r.pool_name, strategy: r.strategy, updatedAt: r.updatedAt }));
  }
}

module.exports = RoutingConfigRepository;
