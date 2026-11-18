/**
 * Migration 040: Add rotation lock tracking table
 *
 * Creates a table to track encryption key rotation state, allowing the API
 * to safely reject donation writes during a key rotation operation.
 *
 * The `rotation_locks` table stores per-key rotation state with:
 * - name: identifier for the rotating key (e.g., 'memoEncryption', 'userEncryption')
 * - status: 'idle', 'in_progress', or 'failed'
 * - startedAt: when the rotation began
 * - completedAt: when it finished (null if still running or failed)
 * - error: descriptive error message if status is 'failed'
 *
 * The API middleware checks this table before accepting donations and returns
 * HTTP 503 Service Unavailable with Retry-After header if rotation is in progress.
 */

exports.name = '040_rotation_lock';

// Uses db.run (one statement per call): the Database wrapper passed in by
// the migration runner has no exec(), so a multi-statement exec() here
// never created the table (#1697).
exports.up = async (db) => {
  await db.run(`
    CREATE TABLE IF NOT EXISTS rotation_locks (
      name TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle',
      startedAt TEXT,
      completedAt TEXT,
      error TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    INSERT OR IGNORE INTO rotation_locks (name, status, createdAt, updatedAt)
    VALUES ('memoEncryption', 'idle', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
};

exports.down = async (db) => {
  await db.run('DROP TABLE IF EXISTS rotation_locks');
};
