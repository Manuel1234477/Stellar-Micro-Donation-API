'use strict';

/**
 * Migration 042: Add SDG tags to campaigns and wallets, and sdg_mappings table.
 */

module.exports = {
  name: '042_add_sdg_tags_to_campaigns_and_wallets',

  async up(db) {
    const runQuery = async (query) => {
      if (typeof db.run === 'function') {
        return db.run(query);
      }
      if (typeof db.exec === 'function') {
        return db.exec(query);
      }
    };

    try {
      await runQuery("ALTER TABLE campaigns ADD COLUMN sdg_tags TEXT DEFAULT '[]'");
    } catch (_) { /* column might already exist */ }

    try {
      await runQuery("ALTER TABLE wallets ADD COLUMN sdg_tags TEXT DEFAULT '[]'");
    } catch (_) { /* column might already exist */ }

    await runQuery(`
      CREATE TABLE IF NOT EXISTS sdg_mappings (
        tag TEXT PRIMARY KEY,
        sdg_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  },

  async down(db) {
    const runQuery = async (query) => {
      if (typeof db.run === 'function') {
        return db.run(query);
      }
      if (typeof db.exec === 'function') {
        return db.exec(query);
      }
    };

    try {
      await runQuery('DROP TABLE IF EXISTS sdg_mappings');
    } catch (_) {}
  },
};
