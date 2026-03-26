/**
 * Quota Reset Job
 * 
 * RESPONSIBILITY: Reset monthly API quotas on the first of each month
 * OWNER: Platform Team
 * 
 * Runs periodically to check for expired quotas and reset them.
 * Fires webhook events when quotas are reset.
 */

const { resetExpiredQuotas } = require('../models/apiKeys');
const WebhookService = require('../services/WebhookService');
const log = require('../utils/log');

const QUOTA_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour

/**
 * Start the quota reset job
 * Checks hourly for quotas that need to be reset
 */
function startQuotaResetJob() {
  log.info('QUOTA_RESET_JOB', 'Starting quota reset job', {
    checkInterval: `${QUOTA_CHECK_INTERVAL_MS / 1000}s`,
  });

  // Run immediately on startup
  checkAndResetQuotas();

  // Then run periodically
  const intervalId = setInterval(checkAndResetQuotas, QUOTA_CHECK_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    log.info('QUOTA_RESET_JOB', 'Quota reset job stopped');
  };
}

/**
 * Check for expired quotas and reset them
 */
async function checkAndResetQuotas() {
  try {
    const resetCount = await resetExpiredQuotas();
    
    if (resetCount > 0) {
      log.info('QUOTA_RESET_JOB', 'Monthly quotas reset', {
        keysReset: resetCount,
        timestamp: new Date().toISOString(),
      });

      // Fire quota.reset webhook event
      WebhookService.deliver('quota.reset', {
        keysReset: resetCount,
        resetAt: new Date().toISOString(),
      }).catch((error) => {
        log.error('QUOTA_RESET_JOB', 'Failed to deliver quota.reset webhook', {
          error: error.message,
        });
      });
    }
  } catch (error) {
    log.error('QUOTA_RESET_JOB', 'Error resetting quotas', {
      error: error.message,
      stack: error.stack,
    });
  }
}

module.exports = {
  startQuotaResetJob,
  checkAndResetQuotas,
};
