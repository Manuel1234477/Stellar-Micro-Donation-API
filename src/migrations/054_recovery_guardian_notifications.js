'use strict';

/**
 * Migration 045: Guardian notification contact + 72h expiration window (#1552)
 *
 * - recovery_guardians.guardianEmail: optional email address to notify a
 *   guardian of a pending recovery request, alongside the existing webhook
 *   broadcast (WebhookService 'recovery.initiated' event).
 * - recovery_requests.expiresAt: strict 72-hour expiration window on pending
 *   requests. Distinct from the legacy `executeAfter` column, which is no
 *   longer read by SocialRecoveryService and is kept only for backward
 *   compatibility with any existing rows.
 */

exports.name = '045_recovery_guardian_notifications';

exports.up = async (db) => {
  try {
    await db.run(`ALTER TABLE recovery_guardians ADD COLUMN guardianEmail TEXT`);
  } catch (_) { /* column already exists */ }

  try {
    await db.run(`ALTER TABLE recovery_requests ADD COLUMN expiresAt DATETIME`);
  } catch (_) { /* column already exists */ }

  try {
    await db.run(`ALTER TABLE recovery_requests ADD COLUMN notifiedAt DATETIME`);
  } catch (_) { /* column already exists */ }
};

exports.down = async () => {
  // SQLite cannot drop columns without a full table rebuild; these additive
  // columns are harmless to leave in place on rollback.
};
