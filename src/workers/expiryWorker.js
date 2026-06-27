'use strict';

/**
 * Expiry worker — runs every 60 s and marks overdue pledges as expired.
 * Uses the timer registry so the handle is cleared at shutdown, and the
 * leader-election lease so only one instance in the cluster runs each tick.
 */

const { expireOverdue } = require('../services/PledgeFulfillmentService');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');

const INTERVAL_MS = parseInt(process.env.PLEDGE_EXPIRY_INTERVAL_MS || '60000', 10);
const LOCK_NAME = 'expiry_worker';

let _handle = null;

function start() {
  if (_handle) return;
  _handle = timerRegistry.createInterval(async () => {
    try {
      const isLeader = await leaderElection.acquireLease(LOCK_NAME, INTERVAL_MS * 2);
      if (!isLeader) return;

      const { expired } = await expireOverdue();
      if (expired > 0) log.info('EXPIRY_WORKER', `Expired ${expired} pledges`, { instanceId: leaderElection.instanceId });
    } catch (err) {
      log.error('EXPIRY_WORKER', 'Error during expiry run', { error: err.message });
    }
  }, INTERVAL_MS, 'pledge-expiry');
  _handle.unref();
  log.info('EXPIRY_WORKER', `Pledge expiry worker started (interval: ${INTERVAL_MS}ms)`);
}

function stop() {
  if (_handle) {
    _handle.clear();
    _handle = null;
  }
}

module.exports = { start, stop };
