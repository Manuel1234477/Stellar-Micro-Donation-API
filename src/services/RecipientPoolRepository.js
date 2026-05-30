/**
 * RecipientPoolRepository - Data Access Layer
 *
 * RESPONSIBILITY: CRUD operations for recipient pools and their members
 * OWNER: Backend Team
 * DEPENDENCIES: Database utility, errors
 */

const Database = require('../utils/database');
const { NotFoundError, DuplicateError, ValidationError, ERROR_CODES } = require('../utils/errors');

class RecipientPoolRepository {
  /**
   * Create a new named pool with an initial set of recipient IDs.
   * @param {string} name
   * @param {Array<{id: string, displayName?: string, latitude?: number, longitude?: number, campaignDeadline?: string}>} recipients
   */
  async create(name, recipients = []) {
    try {
      await Database.run(
        `INSERT INTO recipient_pools (name) VALUES (?)`,
        [name]
      );
    } catch (err) {
      if (Database.isUniqueConstraintError(err)) {
        throw new DuplicateError(`Pool '${name}' already exists`, ERROR_CODES.POOL_ALREADY_EXISTS);
      }
      throw err;
    }

    if (recipients.length > 0) {
      await this._insertMembers(name, recipients);
    }
  }

  /**
   * Get pool metadata by name. Throws NotFoundError if absent.
   */
  async getByName(name) {
    const pool = await Database.get(
      `SELECT id, name, createdAt FROM recipient_pools WHERE name = ?`,
      [name]
    );
    if (!pool) {
      throw new NotFoundError(`Pool '${name}' not found`, ERROR_CODES.POOL_NOT_FOUND);
    }
    return pool;
  }

  /**
   * Add members to an existing pool. Resets round-robin state.
   * @param {string} name
   * @param {Array<{id: string, displayName?: string, latitude?: number, longitude?: number, campaignDeadline?: string}>} recipients
   * @param {Object} [roundRobinStateRepo] - optional, injected to reset state
   */
  async addMembers(name, recipients, roundRobinStateRepo = null) {
    await this.getByName(name); // throws if not found
    await this._insertMembers(name, recipients);
    if (roundRobinStateRepo) {
      await roundRobinStateRepo.reset(name);
    }
  }

  /**
   * Remove members from a pool. Throws RECIPIENT_NOT_IN_POOL if any id is absent.
   * @param {string} name
   * @param {string[]} recipientIds
   * @param {Object} [roundRobinStateRepo]
   */
  async removeMembers(name, recipientIds, roundRobinStateRepo = null) {
    await this.getByName(name); // throws if not found

    for (const id of recipientIds) {
      const row = await Database.get(
        `SELECT recipient_id FROM recipient_pool_members WHERE pool_name = ? AND recipient_id = ?`,
        [name, id]
      );
      if (!row) {
        throw new ValidationError(
          `Recipient '${id}' is not a member of pool '${name}'`,
          null,
          ERROR_CODES.RECIPIENT_NOT_IN_POOL
        );
      }
    }

    for (const id of recipientIds) {
      await Database.run(
        `DELETE FROM recipient_pool_members WHERE pool_name = ? AND recipient_id = ?`,
        [name, id]
      );
    }

    if (roundRobinStateRepo) {
      await roundRobinStateRepo.reset(name);
    }
  }

  /**
   * Delete a pool and all its members (cascade).
   */
  async delete(name) {
    await this.getByName(name); // throws if not found
    await Database.run(`DELETE FROM recipient_pools WHERE name = ?`, [name]);
  }

  /**
   * List all members of a pool as Recipient objects.
   * @returns {Array<{id, displayName, latitude, longitude, campaignDeadline}>}
   */
  async listMembers(name) {
    await this.getByName(name); // throws if not found
    const rows = await Database.all(
      `SELECT recipient_id, display_name, latitude, longitude, campaign_deadline, weight, priority
       FROM recipient_pool_members WHERE pool_name = ?`,
      [name]
    );
    return rows.map(r => ({
      id: r.recipient_id,
      displayName: r.display_name || null,
      latitude: r.latitude !== undefined ? r.latitude : null,
      longitude: r.longitude !== undefined ? r.longitude : null,
      campaignDeadline: r.campaign_deadline || null,
      weight: r.weight !== undefined && r.weight !== null ? r.weight : 1,
      priority: r.priority !== undefined && r.priority !== null ? r.priority : 0,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  async _insertMembers(poolName, recipients) {
    for (const r of recipients) {
      await Database.run(
        `INSERT OR REPLACE INTO recipient_pool_members
           (pool_name, recipient_id, display_name, latitude, longitude, campaign_deadline, weight, priority)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          poolName,
          r.id,
          r.displayName || null,
          r.latitude !== undefined ? r.latitude : null,
          r.longitude !== undefined ? r.longitude : null,
          r.campaignDeadline || null,
          typeof r.weight === 'number' ? r.weight : 1,
          typeof r.priority === 'number' ? r.priority : 0,
        ]
      );
    }
  }
}

module.exports = RecipientPoolRepository;
