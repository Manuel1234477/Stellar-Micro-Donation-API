#!/usr/bin/env node
'use strict';

/**
 * initDB.js — Database initialisation entry point (npm run init-db)
 *
 * Previously this script re-declared every CREATE TABLE statement by hand,
 * which caused it to silently diverge from the real migration sequence (e.g.
 * the amount column was still REAL even after migration 021 converted it to
 * INTEGER stroops, and tables added after 001 were missing entirely).
 *
 * It now delegates entirely to the migration runner so that `npm run init-db`
 * and `npm run migrate` are always equivalent and can never drift apart.
 * Closes #1357.
 */

const fs = require('fs');
const path = require('path');
require('../config/env'); // single .env loader (#1943, #2112)

const { runMigrations } = require('../utils/migrationRunner');

const DATA_DIR = path.resolve(process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, '../../data'));

/**
 * Ensure the data directory exists with restrictive permissions (owner only).
 * This mirrors the directory-creation logic that existed in the previous script
 * (Issue #890) and must happen before the database file is opened.
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`✓ Created data directory: ${DATA_DIR}`);
    // Issue #890: owner-only permissions on the data directory
    fs.chmodSync(DATA_DIR, 0o700);
    console.log(`✓ Set data directory permissions to 0700 (owner only)`);
  }
}

async function main() {
  console.log('Initializing Stellar Micro-Donation API database…\n');

  try {
    ensureDataDir();

    const { applied, skipped } = await runMigrations();

    console.log(`\n✓ Database initialisation complete.`);
    console.log(`  Migrations applied : ${applied}`);
    console.log(`  Already applied    : ${skipped}`);
  } catch (err) {
    console.error('\n✗ Database initialisation failed:', err.message);
    process.exit(1);
  }
}

main();
