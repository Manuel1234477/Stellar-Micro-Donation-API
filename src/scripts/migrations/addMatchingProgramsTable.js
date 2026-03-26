/**
 * Migration: Add matching_programs table
 *
 * Creates the matching_programs table for donation matching program support.
 * Sponsors can configure programs that automatically match qualifying donations.
 */

const Database = require('../../utils/database');
const log = require('../../utils/log');

async function up() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS matching_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sponsor_wallet_id TEXT NOT NULL,
      match_ratio REAL NOT NULL DEFAULT 1.0,
      max_match_amount REAL NOT NULL,
      remaining_match_amount REAL NOT NULL,
      campaign_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    )
  `);

  await Database.run(`
    CREATE INDEX IF NOT EXISTS idx_matching_programs_campaign
    ON matching_programs(campaign_id)
  `);

  await Database.run(`
    CREATE INDEX IF NOT EXISTS idx_matching_programs_status
    ON matching_programs(status)
  `);

  await Database.run(`
    CREATE TABLE IF NOT EXISTS matching_donations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      matching_program_id INTEGER NOT NULL,
      original_donation_id INTEGER NOT NULL,
      matched_amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (matching_program_id) REFERENCES matching_programs(id),
      FOREIGN KEY (original_donation_id) REFERENCES transactions(id)
    )
  `);

  log.info('MIGRATION', 'Created matching_programs and matching_donations tables');
}

async function down() {
  await Database.run('DROP TABLE IF EXISTS matching_donations');
  await Database.run('DROP INDEX IF EXISTS idx_matching_programs_status');
  await Database.run('DROP INDEX IF EXISTS idx_matching_programs_campaign');
  await Database.run('DROP TABLE IF EXISTS matching_programs');
  log.info('MIGRATION', 'Dropped matching_programs and matching_donations tables');
}

module.exports = { up, down };
