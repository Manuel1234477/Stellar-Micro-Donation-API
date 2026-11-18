'use strict';

exports.name = '060_security_scan_jobs';

exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS security_scan_jobs (
      job_id      TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT 'running',
      findings    TEXT NOT NULL DEFAULT '[]',
      summary     TEXT NOT NULL DEFAULT '{"high":0,"medium":0,"low":0}',
      started_at  TEXT NOT NULL,
      scanned_at  TEXT,
      expires_at  INTEGER NOT NULL
    )
  `);

  await db.run(`
    CREATE INDEX IF NOT EXISTS idx_security_scan_jobs_expires_at
    ON security_scan_jobs(expires_at)
  `);
};

exports.down = async (db) => {
  await db.run('DROP INDEX IF EXISTS idx_security_scan_jobs_expires_at');
  await db.run('DROP TABLE IF EXISTS security_scan_jobs');
};
