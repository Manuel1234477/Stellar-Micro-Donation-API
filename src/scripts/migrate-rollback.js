#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });

const { rollbackMigration } = require('../src/utils/migrationRunner');

rollbackMigration()
  .then(({ rolledBack }) => {
    if (rolledBack) {
      console.log(`\nRollback complete — reverted: ${rolledBack}`);
    } else {
      console.log('\nNothing to roll back.');
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗', err.message);
    process.exit(1);
  });
