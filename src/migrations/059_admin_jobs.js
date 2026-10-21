'use strict';

exports.name = '059_admin_jobs';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS admin_jobs (
      job_id     TEXT PRIMARY KEY,
      type       TEXT NOT NULL,
      status     TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      duration_ms INTEGER,
      result_json TEXT,
      error      TEXT
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_admin_jobs_type_status ON admin_jobs(type, status)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_admin_jobs_type_status');
  await db.run('DROP TABLE IF EXISTS admin_jobs');
};
