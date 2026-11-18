'use strict';

/**
 * Confirmation Threshold Worker (#1606) — runs periodically and checks
 * transactions in PENDING_CONFIRMATION state, advancing them to CONFIRMED
 * once the required ledger confirmation threshold has been met.
 *
 * Uses the timer registry for graceful shutdown and leader-election lease
 * for cluster deployments (only one instance runs each tick).
 */

const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const { checkAllPendingConfirmations } = require('../utils/confirmationChecker');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');

// Poll every 5 seconds to match Stellar's ledger close time
const INTERVAL_MS = parseInt(process.env.CONFIRMATION_CHECK_INTERVAL_MS || '5000', 10);
const LOCK_NAME = 'confirmation_threshold_worker';

let _handle = null;

function start() {
  if (_handle) return;

  const stellarService = getStellarService();
  const donationService = new DonationService(stellarService);

  _handle = timerRegistry.createInterval(async () => {
    try {
      // Acquire leader lease — in clustered deployments, only one instance polls
      const isLeader = await leaderElection.acquireLease(LOCK_NAME, INTERVAL_MS * 2);
      if (!isLeader) return;

      // Check and update all pending_confirmation transactions
      const result = await checkAllPendingConfirmations(stellarService, donationService);

      if (result.checked > 0) {
        log.debug('CONFIRMATION_THRESHOLD_WORKER', 'Confirmation check cycle completed', {
          instanceId: leaderElection.instanceId,
          checked: result.checked,
          updated: result.updated,
          errors: result.errors,
        });

        if (result.updated > 0) {
          log.info('CONFIRMATION_THRESHOLD_WORKER', `Confirmed ${result.updated} transaction(s)`, {
            instanceId: leaderElection.instanceId,
            checked: result.checked,
            updated: result.updated,
          });
        }
      }
    } catch (err) {
      log.error('CONFIRMATION_THRESHOLD_WORKER', 'Error during confirmation check run', {
        error: err.message,
      });
    }
  }, INTERVAL_MS, 'confirmation-threshold');

  _handle.unref();
  log.info('CONFIRMATION_THRESHOLD_WORKER', `Confirmation threshold worker started (interval: ${INTERVAL_MS}ms)`);
}

function stop() {
  if (_handle) {
    _handle.clear();
    _handle = null;
  }
}

module.exports = { start, stop };
