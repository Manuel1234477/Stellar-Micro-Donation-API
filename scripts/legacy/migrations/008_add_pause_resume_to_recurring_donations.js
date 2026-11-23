'use strict';

/**
 * Migration: Add pausedAt and resumedAt columns to recurring_donations table.
 * Supports pause/resume functionality for recurring donation schedules.
 */
const Database = require('../../utils/database');

async function up() {
  await Database.run(`ALTER TABLE recurring_donations ADD COLUMN pausedAt DATETIME`);
  await Database.run(`ALTER TABLE recurring_donations ADD COLUMN resumedAt DATETIME`);
}

async function down() {
  // SQLite does not support DROP COLUMN in older versions; migration is one-way
}

module.exports = { up, down };
