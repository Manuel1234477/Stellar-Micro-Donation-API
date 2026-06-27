'use strict';

exports.name = '026_api_key_usage_records';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS api_key_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      latency_ms INTEGER NOT NULL,
      status_code INTEGER NOT NULL,
      path TEXT NOT NULL DEFAULT '/',
      method TEXT NOT NULL DEFAULT 'GET'
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key
    ON api_key_usage(api_key)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_api_key_usage_api_key_timestamp
    ON api_key_usage(api_key, timestamp)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_api_key_usage_api_key');
  await db.run('DROP INDEX IF EXISTS idx_api_key_usage_api_key_timestamp');
  await db.run('DROP TABLE IF EXISTS api_key_usage');
};
