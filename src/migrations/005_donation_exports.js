/**
 * Migration 004: Donation Exports Table (Issue #123)
 * 
 * Creates table for tracking async donation export jobs.
 */

'use strict';

const Database = require('../utils/database');

exports.name = '005_donation_exports';

exports.up = async () => {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS donation_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      export_id TEXT UNIQUE NOT NULL,
      api_key_id TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      status_filter TEXT,
      sender_public_key TEXT,
      recipient_public_key TEXT,
      format TEXT NOT NULL,
      status TEXT NOT NULL,
      record_count INTEGER DEFAULT 0,
      file_path TEXT,
      error_message TEXT,
      signed_url TEXT,
      signed_url_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
    )
  `);

  console.log('✓ Migration 004: donation_exports table created');
};

exports.down = async () => {
  await Database.run('DROP TABLE IF EXISTS donation_exports');
  console.log('✓ Migration 004: donation_exports table dropped');
};
