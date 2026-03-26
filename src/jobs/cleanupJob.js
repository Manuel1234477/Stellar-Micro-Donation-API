/**
 * Soft Delete Cleanup Job
 * RESPONSIBILITY: Permanently delete records older than the 30-day retention period.
 */
const Database = require('../utils/database');
const AuditLogService = require('../services/AuditLogService');

async function runCleanup() {
  console.log('--- Starting Soft Delete Cleanup Job ---');
  
  try {
    const retentionPeriod = "30 days";

    // 1. Hard delete transactions older than 30 days
    const txResult = await Database.run(
      `DELETE FROM transactions WHERE deleted_at < date('now', '-${retentionPeriod}')`
    );

    // 2. Hard delete users (wallets) older than 30 days
    const userResult = await Database.run(
      `DELETE FROM users WHERE deleted_at < date('now', '-${retentionPeriod}')`
    );

    console.log(`✓ Cleaned up expired transactions.`);
    console.log(`✓ Cleaned up expired wallets.`);

    // 3. Log the cleanup for audit purposes
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
    console.error('✗ Cleanup Job Failed:', error.message);
  }
  
  console.log('--- Cleanup Job Finished ---');
}

// Export for use in a cron job or manual trigger
module.exports = { runCleanup };