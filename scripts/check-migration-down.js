'use strict';

/**
 * CI check: ensure every migration file in src/migrations/ exports a
 * callable down() function so it can be rolled back.
 * Exits with code 1 if any migration is missing one.
 */

const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '../src/migrations');

const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+.*\.js$/.test(f))
  .sort();

const missing = [];

for (const file of files) {
  const filePath = path.join(MIGRATIONS_DIR, file);
  let migration;
  try {
    migration = require(filePath);
  } catch (err) {
    console.error(`ERROR: Failed to load ${file}: ${err.message}`);
    process.exitCode = 1;
    continue;
  }

  if (typeof migration.down !== 'function') {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error('ERROR: The following migrations are missing a down() function:\n');
  for (const file of missing) console.error(`  - ${file}`);
  console.error('\nEvery migration must export both up() and down() so it can be rolled back.');
  process.exit(1);
}

console.log(`OK — ${files.length} migration(s), all export a down() function.`);
