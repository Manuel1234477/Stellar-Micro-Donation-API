'use strict';

const Database = require('../../utils/database');

/**
 * Migration: Add tier column to api_keys table for subscription tier feature gating.
 */
async function up() {
  // Add tier column to api_keys if not present
  try {
    await Database.run(`ALTER TABLE api_keys ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`);
  } catch (err) {
    if (!err.message || !err.message.includes('duplicate column')) throw err;
  }
}

async function down() {
  // SQLite does not support DROP COLUMN in older versions — no-op
}

module.exports = { up, down };
