'use strict';

/**
 * PledgeFulfillmentService — atomically fulfills pending pledges when their
 * trigger condition becomes true and exposes the expiry logic used by the worker.
 */

const Database = require('../utils/database');
const Pledge = require('../models/Pledge');
const WebhookService = require('./WebhookService');
const log = require('../utils/log');
const { getStellarService } = require('../config/stellar');

function normalizeInternalConditionType(pledge) {
  if (!pledge || !pledge.condition_type) {
    return 'campaign_goal_percent';
  }
  return pledge.condition_type;
}

async function getCampaignByPledge(pledge) {
  if (!pledge || !pledge.campaign_id) return null;
  return Database.get(`SELECT * FROM campaigns WHERE id = ?`, [pledge.campaign_id]);
}

async function evaluateCondition(pledge, campaign = null, now = new Date()) {
  if (!pledge) {
    return { conditionMet: false, conditionStatus: 'pending' };
  }

  const conditionType = normalizeInternalConditionType(pledge);
  if (conditionType === 'manual') {
    return { conditionMet: false, conditionStatus: 'manual' };
  }

  if (conditionType === 'campaign_goal_percent') {
    const goalCampaign = campaign || (await getCampaignByPledge(pledge));
    const threshold = Number(pledge.condition_value ?? 100);

    if (!goalCampaign || !Number(goalCampaign.goal_amount) || Number(goalCampaign.goal_amount) <= 0) {
      return { conditionMet: false, conditionStatus: 'pending' };
    }

    const currentAmount = Number(goalCampaign.current_amount || 0);
    const goalAmount = Number(goalCampaign.goal_amount);
    const progressPercent = (currentAmount / goalAmount) * 100;
    const conditionMet = progressPercent >= threshold;
    return {
      conditionMet,
      conditionStatus: conditionMet ? 'met' : 'pending',
      threshold,
      progressPercent,
    };
  }

  if (conditionType === 'date') {
    const targetDate = new Date(pledge.condition_value || pledge.expires_at || now);
    const conditionMet = now.getTime() >= targetDate.getTime();
    return {
      conditionMet,
      conditionStatus: conditionMet ? 'met' : 'pending',
      targetDate: targetDate.toISOString(),
    };
  }

  return { conditionMet: false, conditionStatus: 'pending' };
}

/**
 * Fulfills a single pledge by submitting an on-chain Stellar payment transaction
 * before updating status to 'fulfilled' in the database and delivering the webhook.
 *
 * @param {Object|string} pledgeOrId
 * @returns {Promise<{success: boolean, pledge: Object}>}
 */
async function fulfillSinglePledge(pledgeOrId) {
  const pledge = typeof pledgeOrId === 'string' ? await Pledge.findById(pledgeOrId) : pledgeOrId;
  if (!pledge || pledge.status !== 'pending') {
    return { success: false, pledge };
  }

  const campaign = await getCampaignByPledge(pledge);
  const recipient = campaign ? await Database.get(`SELECT publicKey FROM users WHERE id = ?`, [campaign.created_by]) : null;
  const donor = await Database.get(
    `SELECT publicKey, encryptedSecret FROM users WHERE id = ? OR publicKey = ?`,
    [pledge.donor_wallet_id, pledge.donor_wallet_id]
  );

  const recipientPublic = recipient ? recipient.publicKey : (pledge.recipient_public_key || null);
  const donorSecret = donor ? donor.encryptedSecret : (pledge.donor_secret || null);

  const stellarSvc = getStellarService();
  if (donorSecret && recipientPublic && stellarSvc) {
    if (typeof stellarSvc.sendPayment === 'function') {
      await stellarSvc.sendPayment(donorSecret, recipientPublic, pledge.amount, `Pledge fulfillment ${pledge.id}`);
    } else if (typeof stellarSvc.sendDonation === 'function') {
      await stellarSvc.sendDonation({
        sourceSecret: donorSecret,
        destinationPublic: recipientPublic,
        amount: pledge.amount,
        memo: `Pledge fulfillment ${pledge.id}`,
      });
    }
  }

  await Database.run(
    `UPDATE pledges SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP, condition_status = 'met' WHERE id = ? AND status = 'pending'`,
    [pledge.id]
  );

  const updated = await Pledge.findById(pledge.id);
  try {
    await WebhookService.deliver('pledge.fulfilled', { pledge: updated });
    await Pledge.markWebhookSent(updated.id);
  } catch (error) {
    log.error('PLEDGE', `Failed to deliver webhook for pledge ${updated.id}: ${error.message}`);
  }
  return { success: true, pledge: updated };
}

/**
 * Called after any donation is recorded against a campaign or when a new pledge
 * is created. Evaluates all pending pledges attached to the campaign and fulfills
 * any whose condition is satisfied.
 *
 * @param {number|Object} campaignIdOrPledge
 * @returns {Promise<{fulfilled: number}>}
 */
async function checkAndFulfill(campaignIdOrPledge) {
  let campaignId = null;
  let pledges = [];

  if (campaignIdOrPledge && typeof campaignIdOrPledge === 'object' && campaignIdOrPledge.id) {
    const pledge = campaignIdOrPledge;
    pledges = [pledge];
    campaignId = pledge.campaign_id || null;
  } else {
    campaignId = Number(campaignIdOrPledge);
    pledges = await Database.query(
      `SELECT * FROM pledges WHERE campaign_id = ? AND status = 'pending'`,
      [campaignId]
    );
  }

  if (!pledges.length && campaignId !== null && !Number.isNaN(campaignId)) {
    const legacyCampaign = await Database.get(
      `SELECT id, goal_amount, current_amount FROM campaigns WHERE id = ?`,
      [campaignId]
    );

    if (legacyCampaign && Number(legacyCampaign.current_amount) >= Number(legacyCampaign.goal_amount)) {
      pledges = await Database.query(
        `SELECT * FROM pledges WHERE campaign_id = ? AND status = 'pending'`,
        [campaignId]
      );
    }
  }

  let count = 0;
  for (const pledge of pledges) {
    if (!pledge || pledge.status !== 'pending') continue;

    const conditionType = normalizeInternalConditionType(pledge);
    const campaign = await getCampaignByPledge(pledge);

    if (conditionType === 'manual') {
      continue;
    }

    const legacyGoalReached =
      !pledge.condition_type &&
      campaign &&
      Number(campaign.current_amount || 0) >= Number(campaign.goal_amount || 0);

    if (!legacyGoalReached) {
      const { conditionMet } = await evaluateCondition(pledge, campaign, new Date());
      if (!conditionMet) continue;
    }

    const res = await fulfillSinglePledge(pledge);
    if (res.success) count++;
  }

  if (campaignId !== null && !Number.isNaN(campaignId)) {
    const newlyFulfilled = await Pledge.getNewlyFulfilledPledges(campaignId);
    for (const pledge of newlyFulfilled) {
      try {
        await WebhookService.deliver('pledge.fulfilled', { pledge });
        await Pledge.markWebhookSent(pledge.id);
      } catch (error) {
        log.error('PLEDGE', `Failed to deliver webhook for pledge ${pledge.id}: ${error.message}`);
      }
    }
  }

  log.info('PLEDGE', `Fulfilled ${count} pledges${campaignId !== null ? ` for campaign ${campaignId}` : ''}`);
  return { fulfilled: count };
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
    // Get only newly expired pledges (those without webhook_sent_at)
    const newlyExpired = await Pledge.getNewlyExpiredPledges(now);
    
    // Send webhooks and mark them as sent
    for (const pledge of newlyExpired) {
      try {
        await WebhookService.deliver('pledge.expired', { pledge });
        await Pledge.markWebhookSent(pledge.id);
      } catch (error) {
        log.error('PLEDGE', `Failed to deliver webhook for expired pledge ${pledge.id}: ${error.message}`);
        // Don't mark as sent if delivery failed
      }
    }
    
    log.info('PLEDGE', `Expired ${changed} overdue pledges, sent ${newlyExpired.length} webhooks`);
  }

  return { expired: changed };
}

module.exports = { checkAndFulfill, expireOverdue, fulfillSinglePledge };
