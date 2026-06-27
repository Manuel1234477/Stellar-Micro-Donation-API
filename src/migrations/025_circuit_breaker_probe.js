'use strict';

exports.name = '025_circuit_breaker_probe';

exports.up = async (db) => {
  // Add probeHolder for cross-instance half-open probe coordination.
  // Only the instance that wins the atomic UPDATE gets to run the probe.
  // Ignored silently if the column already exists.
  try {
    await db.run(`
      ALTER TABLE circuit_breaker_state ADD COLUMN probeHolder TEXT DEFAULT NULL
    `);
    console.log('✓ Added probeHolder column to circuit_breaker_state');
  } catch (err) {
    if (!err.message.includes('duplicate column')) throw err;
  }
};

exports.down = async (db) => {
  // SQLite does not support DROP COLUMN before 3.35.0; recreate the table.
  await db.run(`
    CREATE TABLE IF NOT EXISTS circuit_breaker_state_backup AS
      SELECT name, state, failureCount, lastFailureAt, openedAt
      FROM circuit_breaker_state
  `);
  await db.run('DROP TABLE IF EXISTS circuit_breaker_state');
  await db.run(`
    ALTER TABLE circuit_breaker_state_backup RENAME TO circuit_breaker_state
  `);
};
