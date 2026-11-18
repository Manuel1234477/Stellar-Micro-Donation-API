'use strict';

/**
 * Tag Service - Business & Persistence Layer (#1530)
 *
 * RESPONSIBILITY: Manage donation tags and their many-to-many associations
 * OWNER: Backend Team
 * DEPENDENCIES: Database, log
 */

const Database = require('../utils/database');
const log = require('../utils/log');

let ensureTablesPromise = null;

class TagService {
  /**
   * Ensure tags and donation_tags tables exist before querying.
   * @returns {Promise<void>}
   */
  static async ensureTables() {
    if (ensureTablesPromise) return ensureTablesPromise;

    ensureTablesPromise = (async () => {
      await Database.run(`
        CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await Database.run('CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)');

      await Database.run(`
        CREATE TABLE IF NOT EXISTS donation_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          donation_id TEXT NOT NULL,
          tag_id INTEGER NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(donation_id, tag_id),
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
      `);
      await Database.run('CREATE INDEX IF NOT EXISTS idx_donation_tags_donation_id ON donation_tags(donation_id)');
      await Database.run('CREATE INDEX IF NOT EXISTS idx_donation_tags_tag_id ON donation_tags(tag_id)');
    })();

    try {
      await ensureTablesPromise;
    } catch (err) {
      ensureTablesPromise = null;
      throw err;
    }
  }

  /**
   * Normalize a tag name.
   * @param {string} name
   * @returns {string}
   */
  static normalizeTag(name) {
    return String(name || '').trim().toLowerCase();
  }

  /**
   * Get or create a unique tag idempotently.
   * @param {string} tagName
   * @returns {Promise<{ id: number, name: string }>}
   */
  static async getOrCreateTag(tagName) {
    await this.ensureTables();
    const normalized = this.normalizeTag(tagName);
    if (!normalized) {
      throw new Error('Tag name must be a non-empty string');
    }

    try {
      await Database.run(
        'INSERT OR IGNORE INTO tags (name) VALUES (?)',
        [normalized]
      );

      const row = await Database.get(
        'SELECT id, name FROM tags WHERE name = ?',
        [normalized]
      );

      return row;
    } catch (err) {
      log.error('TAG_SERVICE', 'Failed to getOrCreateTag', { tagName: normalized, error: err.message });
      throw err;
    }
  }

  /**
   * Associate an array of tag names with a donation. Idempotent.
   * @param {string|number} donationId
   * @param {string[]} tagNames
   * @returns {Promise<string[]>} List of associated tag names
   */
  static async associateTags(donationId, tagNames = []) {
    if (!donationId || !Array.isArray(tagNames) || tagNames.length === 0) {
      return [];
    }

    await this.ensureTables();
    const strDonationId = String(donationId);
    const associated = [];

    for (const rawName of tagNames) {
      const normalized = this.normalizeTag(rawName);
      if (!normalized) continue;

      try {
        const tag = await this.getOrCreateTag(normalized);
        if (tag && tag.id) {
          await Database.run(
            'INSERT OR IGNORE INTO donation_tags (donation_id, tag_id) VALUES (?, ?)',
            [strDonationId, tag.id]
          );
          associated.push(normalized);
        }
      } catch (err) {
        log.warn('TAG_SERVICE', 'Failed to associate tag with donation', {
          donationId: strDonationId,
          tag: normalized,
          error: err.message,
        });
      }
    }

    return [...new Set(associated)];
  }

  /**
   * Remove a tag association from a donation.
   * @param {string|number} donationId
   * @param {string} tagName
   * @returns {Promise<boolean>} True if removed
   */
  static async removeTagFromDonation(donationId, tagName) {
    await this.ensureTables();
    const strDonationId = String(donationId);
    const normalized = this.normalizeTag(tagName);

    const result = await Database.run(
      `DELETE FROM donation_tags
       WHERE donation_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ?)`,
      [strDonationId, normalized]
    );

    return (result && result.changes > 0);
  }

  /**
   * Get all tags associated with a donation.
   * @param {string|number} donationId
   * @returns {Promise<string[]>}
   */
  static async getTagsForDonation(donationId) {
    await this.ensureTables();
    const strDonationId = String(donationId);

    const rows = await Database.query(
      `SELECT t.name
       FROM tags t
       JOIN donation_tags dt ON t.id = dt.tag_id
       WHERE dt.donation_id = ?
       ORDER BY t.name ASC`,
      [strDonationId]
    );

    return rows.map((r) => r.name);
  }

  /**
   * Get all known tags with their donation counts.
   * @returns {Promise<Array<{ id: number, name: string, count: number, donationCount: number }>>}
   */
  static async getAllWithCounts() {
    await this.ensureTables();

    const rows = await Database.query(
      `SELECT t.id, t.name, COUNT(dt.donation_id) as donationCount
       FROM tags t
       LEFT JOIN donation_tags dt ON t.id = dt.tag_id
       GROUP BY t.id, t.name
       ORDER BY donationCount DESC, t.name ASC`,
      []
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      count: Number(r.donationCount) || 0,
      donationCount: Number(r.donationCount) || 0,
    }));
  }

  /**
   * Find donation IDs that have ALL specified tags (AND filter).
   * @param {string[]} tagNames
   * @returns {Promise<string[]>} Matching donation IDs
   */
  static async getDonationIdsMatchingAllTags(tagNames = []) {
    await this.ensureTables();

    const normalizedTags = tagNames
      .map((t) => this.normalizeTag(t))
      .filter(Boolean);

    if (normalizedTags.length === 0) {
      return [];
    }

    const uniqueTags = [...new Set(normalizedTags)];
    const placeholders = uniqueTags.map(() => '?').join(', ');

    const rows = await Database.query(
      `SELECT dt.donation_id
       FROM donation_tags dt
       JOIN tags t ON dt.tag_id = t.id
       WHERE t.name IN (${placeholders})
       GROUP BY dt.donation_id
       HAVING COUNT(DISTINCT dt.tag_id) = ?`,
      [...uniqueTags, uniqueTags.length]
    );

    return rows.map((r) => String(r.donation_id));
  }
}

module.exports = TagService;
