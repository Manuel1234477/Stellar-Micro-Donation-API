#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../src/.env') });

const { migrationStatus } = require('../src/utils/migrationRunner');

migrationStatus()
  .then((statuses) => {
    console.log('\nMigration Status:');
    console.log('─'.repeat(60));
    for (const { name, status } of statuses) {
      const icon = status.startsWith('applied') ? '✓' : '○';
      console.log(`  ${icon}  ${name.padEnd(40)} ${status}`);
    }
    console.log('─'.repeat(60));
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n✗', err.message);
    process.exit(1);
  });
