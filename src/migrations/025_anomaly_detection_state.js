'use strict';

exports.name = '025_anomaly_detection_state';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS anomaly_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id TEXT NOT NULL,
      ip TEXT,
      country TEXT,
      hour INTEGER,
      request_timestamp INTEGER NOT NULL,
      endpoint TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_anomaly_history_key_id
    ON anomaly_history(key_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_anomaly_history_request_timestamp
    ON anomaly_history(request_timestamp)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS anomaly_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_id TEXT NOT NULL,
      type TEXT NOT NULL,
      detail TEXT,
      timestamp INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_anomaly_records_key_id
    ON anomaly_records(key_id)
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_anomaly_records_timestamp
    ON anomaly_records(timestamp)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_anomaly_history_key_id');
  await db.run('DROP INDEX IF EXISTS idx_anomaly_history_request_timestamp');
  await db.run('DROP TABLE IF EXISTS anomaly_history');
  await db.run('DROP INDEX IF EXISTS idx_anomaly_records_key_id');
  await db.run('DROP INDEX IF EXISTS idx_anomaly_records_timestamp');
  await db.run('DROP TABLE IF EXISTS anomaly_records');
};
