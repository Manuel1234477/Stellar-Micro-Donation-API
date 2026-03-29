'use strict';

const Database = require('../../utils/database');

/**
 * Migration: Add cors_origins table for runtime per-origin allowlist management.
 */
async function up() {
  await Database.run(`
    CREATE TABLE IF NOT EXISTS cors_origins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origin TEXT NOT NULL UNIQUE,
      allowCredentials INTEGER NOT NULL DEFAULT 1,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdBy TEXT
    )
  `);
}

async function down() {
  await Database.run('DROP TABLE IF EXISTS cors_origins');
}

module.exports = { up, down };
