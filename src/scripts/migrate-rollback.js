#!/usr/bin/env node
'use strict';

require('../config/env'); // single .env loader (#1943, #2112)

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
