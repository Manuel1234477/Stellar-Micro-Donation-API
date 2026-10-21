'use strict';

module.exports = async function createTestTables() {
  const { runMigrations } = require('../../src/utils/migrationRunner');
  await runMigrations();
};
