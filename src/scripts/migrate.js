#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });

const { runMigrations } = require('../src/utils/migrationRunner');

runMigrations()
  .then(({ applied, skipped }) => {
    console.log(`\nMigrations complete — applied: ${applied}, already applied: ${skipped}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗', err.message);
    process.exit(1);
  });
