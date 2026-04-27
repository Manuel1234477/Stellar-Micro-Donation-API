/**
 * RoutingDecisionRepository - Data Access Layer
 *
 * RESPONSIBILITY: Insert-only persistence of routing decision audit records
 * OWNER: Backend Team
 * DEPENDENCIES: Database utility, crypto (UUID)
 */

const { randomUUID } = require('crypto');
const Database = require('../utils/database');

class RoutingDecisionRepository {
  /**
   * Persist a new routing decision. Records are immutable after creation.
   * @param {Object} decision
   * @param {string} decision.donationId
   * @param {string} decision.poolName
   * @param {string} decision.strategy
   * @param {string} decision.selectedId
   * @param {string[]} decision.candidates
   * @param {Array<{id: string, reason: string}>} decision.excluded
   * @param {string|Date} decision.decidedAt  ISO 8601 string or Date
   * @returns {Promise<string>} the generated UUID id
   */
  async create(decision) {
    const id = randomUUID();
    const decidedAt = decision.decidedAt instanceof Date
      ? decision.decidedAt.toISOString()
      : decision.decidedAt;

    await Database.run(
      `INSERT INTO routing_decisions
         (id, donation_id, pool_name, strategy, selected_id, candidates, excluded, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        decision.donationId,
        decision.poolName,
        decision.strategy,
        decision.selectedId,
        JSON.stringify(decision.candidates),
        JSON.stringify(decision.excluded),
        decidedAt,
      ]
    );
    return id;
  }

  /**
   * Find all routing decisions, ordered by most recent first.
   * @returns {Promise<Object[]>}
   */
  async findAll() {
    const rows = await Database.all(
      `SELECT * FROM routing_decisions ORDER BY createdAt DESC`
    );
    return rows.map(this._deserialize);
  }

  /**
   * Find all decisions for a given donation ID.
   * @param {string} donationId
   * @returns {Promise<Object[]>}
   */
  async findByDonationId(donationId) {
    const rows = await Database.all(
      `SELECT * FROM routing_decisions WHERE donation_id = ? ORDER BY createdAt DESC`,
      [donationId]
    );
    return rows.map(this._deserialize);
  }

  /**
   * Find all decisions for a given pool name.
   * @param {string} poolName
   * @returns {Promise<Object[]>}
   */
  async findByPoolName(poolName) {
    const rows = await Database.all(
      `SELECT * FROM routing_decisions WHERE pool_name = ? ORDER BY createdAt DESC`,
      [poolName]
    );
    return rows.map(this._deserialize);
  }

  /**
   * Find all decisions for a given strategy.
   * @param {string} strategy
   * @returns {Promise<Object[]>}
   */
  async findByStrategy(strategy) {
    const rows = await Database.all(
      `SELECT * FROM routing_decisions WHERE strategy = ? ORDER BY createdAt DESC`,
      [strategy]
    );
    return rows.map(this._deserialize);
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _deserialize(row) {
    return {
      id: row.id,
      donationId: row.donation_id,
      poolName: row.pool_name,
      strategy: row.strategy,
      selectedId: row.selected_id,
      candidates: JSON.parse(row.candidates),
      excluded: JSON.parse(row.excluded),
      decidedAt: row.decided_at,
      createdAt: row.createdAt,
    };
  }
}

module.exports = RoutingDecisionRepository;
