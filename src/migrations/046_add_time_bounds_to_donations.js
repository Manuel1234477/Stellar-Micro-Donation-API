'use strict';

exports.name = '046_add_time_bounds_to_donations';

exports.up = async (db) => {
  await db.run(`
    ALTER TABLE donations_store ADD COLUMN valid_after INTEGER DEFAULT 0
  `);
  await db.run(`
    ALTER TABLE donations_store ADD COLUMN valid_before INTEGER DEFAULT 0
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_valid_after ON donations_store(valid_after)
  `);
  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_donations_store_valid_before ON donations_store(valid_before)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_donations_store_valid_before');
  await db.run('DROP INDEX IF EXISTS idx_donations_store_valid_after');
  await db.run('ALTER TABLE donations_store DROP COLUMN valid_before');
  await db.run('ALTER TABLE donations_store DROP COLUMN valid_after');
};
