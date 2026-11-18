'use strict';

/**
 * Webhook Retry Worker — processes the webhook delivery retry queue
 *
 * Runs every 30 seconds to retry failed webhook deliveries with exponential backoff.
 * Moves permanently failed deliveries (>5 attempts) to dead-letter storage.
 * Uses leader election to ensure only one instance in a cluster processes retries.
 */

const WebhookService = require('../services/WebhookService');
const log = require('../utils/log');
const timerRegistry = require('../utils/timerRegistry');
const leaderElection = require('../utils/leaderElection');

const INTERVAL_MS = parseInt(process.env.WEBHOOK_RETRY_INTERVAL_MS || '30000', 10);
const LOCK_NAME = 'webhook_retry_worker';

let _handle = null;

function start() {
  if (_handle) return;

  _handle = timerRegistry.createInterval(async () => {
    try {
      const isLeader = await leaderElection.acquireLease(LOCK_NAME, INTERVAL_MS * 2);
      if (!isLeader) return;

      const { processed, moved } = await WebhookService.processRetryQueue();
      if (processed > 0 || moved > 0) {
        log.info('WEBHOOK_RETRY_WORKER', `Processed webhook retries`, {
          processed,
          movedToDeadLetter: moved,
          instanceId: leaderElection.instanceId,
        });
      }
    } catch (err) {
      log.error('WEBHOOK_RETRY_WORKER', 'Error during webhook retry processing', {
        error: err.message,
        stack: err.stack,
      });
    }
  }, INTERVAL_MS, 'webhook-retry');

  _handle.unref();
  log.info('WEBHOOK_RETRY_WORKER', `Webhook retry worker started (interval: ${INTERVAL_MS}ms)`, {
    processRetryInterval: INTERVAL_MS,
  });
}

function stop() {
  if (_handle) {
    _handle.clear();
    _handle = null;
  }
  log.info('WEBHOOK_RETRY_WORKER', 'Webhook retry worker stopped');
}

module.exports = { start, stop };
