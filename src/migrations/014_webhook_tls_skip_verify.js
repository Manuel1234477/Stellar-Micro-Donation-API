'use strict';

exports.name = '014_webhook_tls_skip_verify';

exports.up = async (db) => {
  try {
    await db.run(`ALTER TABLE webhooks ADD COLUMN tls_skip_verify INTEGER NOT NULL DEFAULT 0`);
  } catch (_) { /* column already exists */ }
};

exports.down = async (db) => {
  // SQLite: recreate table without the column is complex; log and skip
  console.log('ℹ Rollback of tls_skip_verify column not supported (SQLite limitation)');
};
