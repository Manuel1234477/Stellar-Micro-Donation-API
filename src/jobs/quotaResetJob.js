/**
 * Quota Reset Job
 *
 * RESPONSIBILITY: Reset monthly API quotas on the first of each month.
 * Uses the timer registry (tracked handle, cleared at shutdown) and the
 * leader-election lease (only one cluster instance resets per check).
 */

const { resetExpiredQuotas } = require('../models/apiKeys');
const WebhookService = require('../services/WebhookService');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');

const QUOTA_CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check every hour
const LOCK_NAME = 'quota_reset_job';

/**
 * Start the quota reset job.
 * Returns a stop function that cancels the interval.
 */
function startQuotaResetJob() {
  log.info('QUOTA_RESET_JOB', 'Starting quota reset job', {
    checkInterval: `${QUOTA_CHECK_INTERVAL_MS / 1000}s`,
  });

  checkAndResetQuotas();

  const handle = timerRegistry.createInterval(
    checkAndResetQuotas,
    QUOTA_CHECK_INTERVAL_MS,
    'quota-reset'
  );
  handle.unref();

  return () => {
    handle.clear();
    log.info('QUOTA_RESET_JOB', 'Quota reset job stopped');
  };
}

/**
 * Check for expired quotas and reset them (leader-only).
 */
async function checkAndResetQuotas() {
  try {
    const isLeader = await leaderElection.acquireLease(LOCK_NAME, QUOTA_CHECK_INTERVAL_MS * 2);
    if (!isLeader) return;

    const resetCount = await resetExpiredQuotas();

    if (resetCount > 0) {
      log.info('QUOTA_RESET_JOB', 'Monthly quotas reset', {
        keysReset: resetCount,
        timestamp: new Date().toISOString(),
      });

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
