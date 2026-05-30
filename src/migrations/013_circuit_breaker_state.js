'use strict';

exports.name = '013_circuit_breaker_state';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_state (
      name TEXT PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'closed',
      failureCount INTEGER NOT NULL DEFAULT 0,
      lastFailureAt INTEGER,
      openedAt INTEGER
    )
  `);
  console.log('✓ Created circuit_breaker_state table');
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS circuit_breaker_state');
};
