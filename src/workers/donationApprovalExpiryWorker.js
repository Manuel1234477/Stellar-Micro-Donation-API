'use strict';

/**
 * Donation approval expiry worker (#1498) — runs periodically and marks
 * donations that have been awaiting multi-sig approval past their window
 * (default 72h, MULTISIG_APPROVAL_WINDOW_MS) as expired.
 * Uses the timer registry so the handle is cleared at shutdown, and the
 * leader-election lease so only one instance in the cluster runs each tick.
 */

const { getStellarService } = require('../config/stellar');
const DonationService = require('../services/DonationService');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');

const INTERVAL_MS = parseInt(process.env.DONATION_APPROVAL_EXPIRY_INTERVAL_MS || '300000', 10);
const LOCK_NAME = 'donation_approval_expiry_worker';

let _handle = null;

function start() {
  if (_handle) return;

  const donationService = new DonationService(getStellarService());

  _handle = timerRegistry.createInterval(async () => {
    try {
      const isLeader = await leaderElection.acquireLease(LOCK_NAME, INTERVAL_MS * 2);
      if (!isLeader) return;

      const { expired } = await donationService.expireOverdueApprovals();
      if (expired > 0) {
        log.info('DONATION_APPROVAL_EXPIRY_WORKER', `Expired ${expired} donation(s) awaiting approval`, {
          instanceId: leaderElection.instanceId,
        });
      }
    } catch (err) {
      log.error('DONATION_APPROVAL_EXPIRY_WORKER', 'Error during expiry run', { error: err.message });
    }
  }, INTERVAL_MS, 'donation-approval-expiry');
  _handle.unref();
  log.info('DONATION_APPROVAL_EXPIRY_WORKER', `Donation approval expiry worker started (interval: ${INTERVAL_MS}ms)`);
}

function stop() {
  if (_handle) {
    _handle.clear();
    _handle = null;
  }
}

module.exports = { start, stop };
