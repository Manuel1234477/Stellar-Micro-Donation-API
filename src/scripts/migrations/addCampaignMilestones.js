'use strict';

const Database = require('../../utils/database');

/**
 * Migration: Add campaign_milestones table for milestone-based fund release.
 */
async function up() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS campaign_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      target_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      verified_at DATETIME,
      verified_by TEXT,
      fund_release_tx TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);
}

async function down() {
  await Database.run('DROP TABLE IF EXISTS campaign_milestones');
}

module.exports = { up, down };
