#!/usr/bin/env node
'use strict';

require('../config/loadEnv'); // single .env loader (#1943)

const { runMigrations } = require('../utils/migrationRunner');

runMigrations()
  .then(({ applied, skipped }) => {
    console.log(`\nMigrations complete — applied: ${applied}, already applied: ${skipped}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗', err.message);
    process.exit(1);
  });
