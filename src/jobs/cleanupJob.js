/**
 * Soft Delete Cleanup Job
 * RESPONSIBILITY: Permanently delete records older than the 30-day retention period.
 */
const Database = require('../utils/database');
const AuditLogService = require('../services/AuditLogService');
const DonationExportService = require('../services/DonationExportService');
const log = require('../utils/log');

async function runCleanup() {
  log.info('CLEANUP_JOB', 'Starting soft delete cleanup job');

  try {
    const retentionPeriod = "30 days";

    // 1. Hard delete transactions older than 30 days
    await Database.run(
      `DELETE FROM transactions WHERE deleted_at < date('now', '-${retentionPeriod}')`
    );

    // 2. Hard delete users (wallets) older than 30 days
    await Database.run(
      `DELETE FROM users WHERE deleted_at < date('now', '-${retentionPeriod}')`
    );

    log.info('CLEANUP_JOB', 'Cleaned up expired transactions and wallets');

    // 3. Clean up expired refresh token revocations (Issue #68)
    try {
      const { cleanupExpiredRevocations } = require('../services/JwtService');
      const deleted = await cleanupExpiredRevocations();
      log.info('CLEANUP_JOB', 'Cleaned up expired refresh token revocations', { deleted });
    } catch (_) { /* table may not exist yet */ }

    // 4. Clean up expired donation exports (Issue #123)
    try {
      const deletedExports = await DonationExportService.deleteExpiredExports();
      log.info('CLEANUP_JOB', 'Cleaned up expired donation exports', { deletedExports });
    } catch (err) {
      log.error('CLEANUP_JOB', 'Failed to clean up donation exports', { error: err.message });
    }

    // 5. Log the cleanup for audit purposes
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.SYSTEM,
      action: 'SOFT_DELETE_CLEANUP',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      details: {
        retention: retentionPeriod,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    log.error('CLEANUP_JOB', 'Cleanup job failed', { error: error.message });
  }

  log.info('CLEANUP_JOB', 'Cleanup job finished');
}

// Export for use in a cron job or manual trigger
module.exports = { runCleanup };
