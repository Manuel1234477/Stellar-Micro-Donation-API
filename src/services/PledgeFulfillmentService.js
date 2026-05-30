'use strict';

/**
 * PledgeFulfillmentService — atomically fulfills all pending pledges when a
 * campaign reaches its goal, and exposes the expiry logic used by the worker.
 *
 * Atomicity: SQLite serialises writes, so a single UPDATE inside a transaction
 * is sufficient to prevent double-fulfillment without SELECT FOR UPDATE.
 */

const Database = require('../utils/database');
const Pledge = require('../models/Pledge');
const WebhookService = require('./WebhookService');
const log = require('../utils/log');

/**
 * Called after any donation is recorded against a campaign.
 * If current_amount >= goal_amount, fulfills all pending pledges atomically.
 *
 * @param {number} campaignId
 * @returns {Promise<{fulfilled: number}>}
 */
async function checkAndFulfill(campaignId) {
  const campaign = await Database.get(
    `SELECT id, goal_amount, current_amount FROM campaigns WHERE id = ?`,
    [campaignId]
  );

  if (!campaign || campaign.current_amount < campaign.goal_amount) {
    return { fulfilled: 0 };
  }

  // Atomic update — only rows still 'pending' are touched
  await Database.run(
    `UPDATE pledges SET status = 'fulfilled'
     WHERE campaign_id = ? AND status = 'pending'`,
    [campaignId]
  );

  const fulfilled = await Database.query(
    `SELECT * FROM pledges WHERE campaign_id = ? AND status = 'fulfilled'`,
    [campaignId]
  );

  for (const pledge of fulfilled) {
    WebhookService.deliver('pledge.fulfilled', { pledge }).catch(() => {});
  }

  log.info('PLEDGE', `Fulfilled ${fulfilled.length} pledges for campaign ${campaignId}`);
  return { fulfilled: fulfilled.length };
}

/**
 * Expire all pending pledges whose expires_at has passed.
 * Called by the expiry worker every minute.
 *
 * @param {string} [now] - ISO timestamp (injectable for testing)
 * @returns {Promise<{expired: number}>}
 */
async function expireOverdue(now = new Date().toISOString()) {
  const changed = await Pledge.expireOverdue(now);

  if (changed > 0) {
    const expired = await Pledge.getExpiredPledges(now);
    for (const pledge of expired) {
      WebhookService.deliver('pledge.expired', { pledge }).catch(() => {});
    }
    log.info('PLEDGE', `Expired ${changed} overdue pledges`);
  }

  return { expired: changed };
}

module.exports = { checkAndFulfill, expireOverdue };
