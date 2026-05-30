'use strict';

/**
 * Expiry worker — runs every 60 s and marks overdue pledges as expired.
 */

const { expireOverdue } = require('../services/PledgeFulfillmentService');
const log = require('../utils/log');

const INTERVAL_MS = parseInt(process.env.PLEDGE_EXPIRY_INTERVAL_MS || '60000', 10);

let _timer = null;

function start() {
  if (_timer) return;
  _timer = setInterval(async () => {
    try {
      const { expired } = await expireOverdue();
      if (expired > 0) log.info('EXPIRY_WORKER', `Expired ${expired} pledges`);
    } catch (err) {
      log.error('EXPIRY_WORKER', 'Error during expiry run', { error: err.message });
    }
  }, INTERVAL_MS);
  log.info('EXPIRY_WORKER', `Pledge expiry worker started (interval: ${INTERVAL_MS}ms)`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

module.exports = { start, stop };
