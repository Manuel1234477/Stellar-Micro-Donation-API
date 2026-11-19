#!/usr/bin/env node
'use strict';

require('../config/loadEnv'); // single .env loader (#1943)

const { rollbackMigration } = require('../utils/migrationRunner');

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
