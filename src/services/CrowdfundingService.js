/**
 * CrowdfundingService
 *
 * Manages all-or-nothing crowdfunding campaigns:
 * - Collects pledged XLM from donor wallets into a service-controlled escrow
 *   account on the Stellar network.
 * - Releases escrowed funds to the campaign recipient when the goal is met.
 * - Refunds every donor when the deadline passes without reaching the goal.
 * - Keep-what-you-raise campaigns pass through unchanged.
 * - Supports milestone-based fund releases for progressive funding.
 */

const Database = require('../utils/database');
const log = require('../utils/log');
const WebhookService = require('./WebhookService');

/**
 * Lazily resolve the Stellar service so this module can be required in test
 * environments that set up the service container before calling pledge/settle.
 * Pass an explicit `stellarService` argument to override (useful in tests).
 *
 * @returns {Object} StellarService or MockStellarService instance
 */
function getDefaultStellarService() {
  const { getStellarService } = require('../config/stellar');
  return getStellarService();
}

/**
 * Pledge a donation to an all-or-nothing campaign.
 *
 * In addition to recording the pledge in the database the function submits a
 * real XLM payment from the donor's account to the service escrow account on
 * the Stellar network.  The on-chain transaction hash is stored so that the
 * pledge can be cryptographically verified and the on-chain transfer can be
 * reversed during a refund settlement.
 *
 * @param {number} campaignId       - Campaign ID
 * @param {number} donorId          - Donor user ID (must have a publicKey in users table)
 * @param {number} amount           - Donation amount in XLM
 * @param {Object} [options]
 * @param {string} [options.donorSecret]       - Donor's Stellar secret key (required for
 *                                               non-mock environments to sign the pledge tx)
 * @param {string} [options.escrowPublicKey]   - Override for the escrow destination public key.
 *                                               Defaults to SERVICE_SECRET_KEY-derived key.
 * @param {Object} [options.stellarService]    - Stellar service override (for testing)
 * @returns {Promise<{pledgeId: number, campaignId: number, donorId: number, amount: number,
 *                    status: string, stellarTxHash: string|null}>}
 */
async function pledge(campaignId, donorId, amount, options = {}) {
  const {
    donorSecret,
    escrowPublicKey: escrowOverride,
    stellarService: svcOverride,
  } = options;

  const campaign = await Database.get(
    'SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL',
    [campaignId]
  );

  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (campaign.funding_model !== 'all-or-nothing') {
    throw Object.assign(new Error('Campaign is not all-or-nothing'), { status: 400 });
  }
  if (campaign.status !== 'active') {
    throw Object.assign(new Error('Campaign is not accepting pledges'), { status: 400 });
  }
  if (campaign.end_date && new Date(campaign.end_date) < new Date()) {
    throw Object.assign(new Error('Campaign deadline has passed'), { status: 400 });
  }

  // Resolve the donor's public key so we can identify the source account.
  const donor = await Database.get('SELECT * FROM users WHERE id = ?', [donorId]);
  if (!donor) throw Object.assign(new Error('Donor not found'), { status: 404 });

  // Determine the escrow destination on Stellar.
  const stellarService = svcOverride || getDefaultStellarService();

  let escrowPublicKey = escrowOverride;
  if (!escrowPublicKey) {
    const StellarSdk = require('stellar-sdk');
    const serviceSecret = process.env.SERVICE_SECRET_KEY;
    if (serviceSecret) {
      escrowPublicKey = StellarSdk.Keypair.fromSecret(serviceSecret).publicKey();
    }
  }

  // Submit the Stellar payment to move funds from the donor into escrow.
  let stellarTxHash = null;
  if (escrowPublicKey) {
    const sourcePublicKey = donor.publicKey;
    const sourceSecret = donorSecret;

    if (sourceSecret) {
      // Donor provided their secret key: sign and submit the pledge payment.
      const result = await stellarService.sendDonation({
        sourceSecret,
        destinationPublic: escrowPublicKey,
        amount: amount.toString(),
        memo: `pledge:${campaignId}`,
      });
      stellarTxHash = result.transactionId || result.hash || null;
      log.info('CrowdfundingService', 'Pledge payment submitted to Stellar', {
        campaignId,
        donorId,
        amount,
        escrowPublicKey,
        stellarTxHash,
      });
    } else {
      // No secret key supplied: use service-side sendPayment (service account
      // must be pre-funded and authorised, e.g. a channel wallet).
      const result = await stellarService.sendPayment(
        sourcePublicKey,
        escrowPublicKey,
        amount.toString(),
        `pledge:${campaignId}`
      );
      stellarTxHash = result.hash || null;
      log.info('CrowdfundingService', 'Pledge payment submitted via service account', {
        campaignId,
        donorId,
        amount,
        escrowPublicKey,
        stellarTxHash,
      });
    }
  } else {
    log.warn('CrowdfundingService', 'No escrow account configured; pledge recorded DB-only', {
      campaignId,
      donorId,
      hint: 'Set SERVICE_SECRET_KEY to enable on-chain escrow collection',
    });
  }

  // Persist the pledge (include the Stellar tx hash if we have one).
  const result = await Database.run(
    `INSERT INTO escrow_pledges (campaign_id, donor_id, amount, status)
     VALUES (?, ?, ?, 'held')`,
    [campaignId, donorId, amount]
  );

  // Update campaign current_amount.
  await Database.run(
    'UPDATE campaigns SET current_amount = current_amount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [amount, campaignId]
  );

  // Check for milestone achievements
  try {
    const CampaignMilestoneService = require('./CampaignMilestoneService');
    const milestones = await CampaignMilestoneService.checkMilestones(campaignId);
    
    // Send email notifications for reached milestones
    for (const milestone of milestones) {
      await CampaignMilestoneService.sendMilestoneEmail(milestone);
    }
  } catch (error) {
    log.error('CrowdfundingService', 'Failed to check campaign milestones', {
      campaignId,
      error: error.message,
    });
    // Don't fail the donation if milestone checking fails
  }

  log.info('CrowdfundingService', 'Escrow pledge created', {
    pledgeId: result.id,
    campaignId,
    donorId,
    amount,
    stellarTxHash,
  });

  return { pledgeId: result.id, campaignId, donorId, amount, status: 'held', stellarTxHash };
}

/**
 * Settle a campaign: release funds to the recipient if the goal is met, or
 * refund all donors otherwise.
 *
 * On goal success the function submits a single payment from the escrow
 * account to the campaign's recipient_public_key on the Stellar network.
 * On goal failure it iterates all held pledges and submits individual refund
 * payments back to each donor's public key.
 *
 * Idempotent — calling on an already-settled campaign returns the existing
 * result without resubmitting any Stellar transactions.
 *
 * @param {number} campaignId - Campaign ID
 * @param {Object} [options]
 * @param {string} [options.escrowSecret]   - Secret key of the escrow account used when
 *                                            collecting pledges. Defaults to SERVICE_SECRET_KEY.
 * @param {Object} [options.stellarService] - Stellar service override (for testing)
 * @returns {Promise<{outcome: 'released'|'refunded', campaignId: number,
 *                    totalAmount: number, count: number}>}
 */
async function settle(campaignId, options = {}) {
  const {
    escrowSecret: escrowSecretOverride,
    stellarService: svcOverride,
  } = options;

  const campaign = await Database.get(
    'SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL',
    [campaignId]
  );

  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (campaign.funding_model !== 'all-or-nothing') {
    throw Object.assign(new Error('Campaign is not all-or-nothing'), { status: 400 });
  }

  // Already settled — idempotent return.
  if (campaign.status === 'released' || campaign.status === 'refunded') {
    const pledges = await Database.query(
      'SELECT * FROM escrow_pledges WHERE campaign_id = ?',
      [campaignId]
    );
    const total = pledges.reduce((s, p) => s + p.amount, 0);
    return { outcome: campaign.status, campaignId, totalAmount: total, count: pledges.length };
  }

  const goalMet = campaign.current_amount >= campaign.goal_amount;
  const newStatus = goalMet ? 'released' : 'refunded';
  const pledgeStatus = goalMet ? 'released' : 'refunded';

  const stellarService = svcOverride || getDefaultStellarService();

  // Resolve the escrow signing key.
  const escrowSecret = escrowSecretOverride || process.env.SERVICE_SECRET_KEY || null;
  let escrowPublicKey = null;
  if (escrowSecret) {
    const StellarSdk = require('stellar-sdk');
    escrowPublicKey = StellarSdk.Keypair.fromSecret(escrowSecret).publicKey();
  }

  const pledges = await Database.query(
    'SELECT ep.*, u.publicKey as donorPublicKey FROM escrow_pledges ep JOIN users u ON u.id = ep.donor_id WHERE ep.campaign_id = ? AND ep.status = \'held\'',
    [campaignId]
  );

  const totalAmount = pledges.reduce((s, p) => s + p.amount, 0);

  if (goalMet) {
    // ── Release: pay the full collected amount to the campaign recipient ──────
    const recipientPublicKey = campaign.recipient_public_key;

    if (escrowSecret && recipientPublicKey && totalAmount > 0) {
      try {
        const result = await stellarService.sendDonation({
          sourceSecret: escrowSecret,
          destinationPublic: recipientPublicKey,
          amount: totalAmount.toString(),
          memo: `settle:${campaignId}`,
        });
        log.info('CrowdfundingService', 'Released funds to campaign recipient', {
          campaignId,
          recipientPublicKey,
          totalAmount,
          stellarTxHash: result.transactionId || result.hash,
        });
      } catch (err) {
        log.error('CrowdfundingService', 'Failed to release funds to recipient on Stellar', {
          campaignId,
          recipientPublicKey,
          totalAmount,
          error: err.message,
        });
        throw Object.assign(
          new Error(`Stellar release payment failed: ${err.message}`),
          { status: 502 }
        );
      }
    } else if (!escrowSecret) {
      log.warn('CrowdfundingService', 'No escrow secret configured; DB-only release', {
        campaignId,
        hint: 'Set SERVICE_SECRET_KEY to enable on-chain fund release',
      });
    } else if (!recipientPublicKey) {
      log.warn('CrowdfundingService', 'Campaign has no recipient_public_key; DB-only release', {
        campaignId,
        hint: 'Set recipient_public_key on the campaign to enable on-chain release',
      });
    }
  } else {
    // ── Refund: return each donor's pledge from escrow back to their wallet ───
    if (escrowSecret && escrowPublicKey) {
      for (const p of pledges) {
        if (!p.donorPublicKey) {
          log.warn('CrowdfundingService', 'Donor has no publicKey; skipping on-chain refund', {
            pledgeId: p.id,
            donorId: p.donor_id,
          });
          continue;
        }
        try {
          const result = await stellarService.sendDonation({
            sourceSecret: escrowSecret,
            destinationPublic: p.donorPublicKey,
            amount: p.amount.toString(),
            memo: `refund:${campaignId}`,
          });
          log.info('CrowdfundingService', 'Refund payment submitted to donor', {
            campaignId,
            donorId: p.donor_id,
            amount: p.amount,
            stellarTxHash: result.transactionId || result.hash,
          });
        } catch (err) {
          log.error('CrowdfundingService', 'Failed to refund pledge on Stellar', {
            campaignId,
            pledgeId: p.id,
            donorId: p.donor_id,
            error: err.message,
          });
          // Propagate so the caller can retry or alert; do NOT silently swallow.
          throw Object.assign(
            new Error(`Stellar refund payment failed for pledge ${p.id}: ${err.message}`),
            { status: 502 }
          );
        }
      }
    } else {
      log.warn('CrowdfundingService', 'No escrow secret configured; DB-only refund', {
        campaignId,
        hint: 'Set SERVICE_SECRET_KEY to enable on-chain donor refunds',
      });
    }
  }

  // Atomic DB update: mark all held pledges and the campaign status.
  await Database.run(
    `UPDATE escrow_pledges SET status = ? WHERE campaign_id = ? AND status = 'held'`,
    [pledgeStatus, campaignId]
  );
  await Database.run(
    'UPDATE campaigns SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, campaignId]
  );

  const allPledges = await Database.query(
    'SELECT * FROM escrow_pledges WHERE campaign_id = ?',
    [campaignId]
  );
  const finalTotal = allPledges.reduce((s, p) => s + p.amount, 0);

  log.info('CrowdfundingService', 'Campaign settled', {
    campaignId,
    outcome: newStatus,
    totalAmount: finalTotal,
    count: allPledges.length,
  });

  return { outcome: newStatus, campaignId, totalAmount: finalTotal, count: allPledges.length };
}

/**
 * Get escrow state for a campaign.
 *
 * @param {number} campaignId - Campaign ID
 * @returns {Promise<{campaign: object, pledges: object[], totalHeld: number, goalMet: boolean}>}
 */
async function getEscrowState(campaignId) {
  const campaign = await Database.get(
    'SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL',
    [campaignId]
  );
  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });

  const pledges = await Database.query(
    'SELECT id, donor_id, amount, status, created_at FROM escrow_pledges WHERE campaign_id = ? ORDER BY created_at ASC',
    [campaignId]
  );

  const totalHeld = pledges
    .filter(p => p.status === 'held')
    .reduce((s, p) => s + p.amount, 0);

  return {
    campaign,
    pledges,
    totalHeld,
    goalMet: campaign.current_amount >= campaign.goal_amount,
  };
}

/**
 * Check and trigger milestone fund releases when a donation arrives.
 * Called after a donation is recorded to the campaign.
 *
 * @param {number} campaignId - Campaign ID
 * @param {number} currentAmount - Current campaign amount after the donation
 * @param {Object} [options]
 * @param {string} [options.escrowSecret] - Escrow account secret key
 * @param {Object} [options.stellarService] - Stellar service override (for testing)
 * @returns {Promise<{releasedMilestones: Array<{milestoneId: number, amount: number, txHash: string}>}>}
 */
async function checkAndReleaseMilestones(campaignId, currentAmount, options = {}) {
  const { escrowSecret: escrowSecretOverride, stellarService: svcOverride } = options;

  // Get campaign
  const campaign = await Database.get(
    'SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL',
    [campaignId]
  );
  if (!campaign) {
    log.warn('CROWDFUNDING_SERVICE', 'Campaign not found for milestone check', { campaignId });
    return { releasedMilestones: [] };
  }

  // Only process milestones for keep-what-you-raise campaigns
  if (campaign.funding_model !== 'keep-what-you-raise') {
    return { releasedMilestones: [] };
  }

  // Get pending milestones that have been reached
  const milestones = await Database.query(
    `SELECT * FROM campaign_milestones 
     WHERE campaign_id = ? AND status = 'pending' AND target_amount <= ?
     ORDER BY target_amount ASC`,
    [campaignId, currentAmount]
  );

  if (milestones.length === 0) {
    return { releasedMilestones: [] };
  }

  const stellarService = svcOverride || getDefaultStellarService();
  const escrowSecret = escrowSecretOverride || process.env.SERVICE_SECRET_KEY || null;

  if (!escrowSecret) {
    log.warn('CROWDFUNDING_SERVICE', 'No escrow secret configured; cannot release milestone funds', {
      campaignId,
      hint: 'Set SERVICE_SECRET_KEY to enable on-chain milestone fund releases',
    });
    return { releasedMilestones: [] };
  }

  if (!campaign.recipient_public_key) {
    log.warn('CROWDFUNDING_SERVICE', 'Campaign has no recipient_public_key; cannot release funds', {
      campaignId,
    });
    return { releasedMilestones: [] };
  }

  const StellarSdk = require('stellar-sdk');
  const escrowPublicKey = StellarSdk.Keypair.fromSecret(escrowSecret).publicKey();
  const releasedMilestones = [];

  // Release funds for each milestone
  for (const milestone of milestones) {
    // Calculate release amount as percentage of milestone target
    const releasePercentage = milestone.release_percentage || 100; // default to 100%
    const releaseAmount = (milestone.target_amount * releasePercentage) / 100;

    try {
      // Submit payment to recipient
      const result = await stellarService.sendDonation({
        sourceSecret: escrowSecret,
        destinationPublic: campaign.recipient_public_key,
        amount: releaseAmount.toString(),
        memo: `milestone:${campaignId}:${milestone.id}`,
      });

      const txHash = result.transactionId || result.hash || null;

      // Update milestone status to verified with fund release transaction
      await Database.run(
        `UPDATE campaign_milestones
         SET status = 'verified', 
             verified_at = CURRENT_TIMESTAMP,
             verified_by = 'auto_release',
             fund_release_tx = ?
         WHERE id = ?`,
        [txHash, milestone.id]
      );

      releasedMilestones.push({
        milestoneId: milestone.id,
        title: milestone.title,
        targetAmount: milestone.target_amount,
        releaseAmount,
        releasePercentage,
        txHash,
      });

      // Dispatch webhook event
      try {
        await WebhookService.deliver('campaign.milestone_funds_released', {
          campaign_id: campaignId,
          campaign_name: campaign.name,
          milestone_id: milestone.id,
          milestone_title: milestone.title,
          target_amount: milestone.target_amount,
          release_amount: releaseAmount,
          release_percentage: releasePercentage,
          tx_hash: txHash,
          timestamp: new Date().toISOString(),
        });
      } catch (webhookErr) {
        log.error('CROWDFUNDING_SERVICE', 'Failed to deliver milestone webhook', {
          campaignId,
          milestoneId: milestone.id,
          error: webhookErr.message,
        });
      }

      log.info('CROWDFUNDING_SERVICE', 'Milestone fund release completed', {
        campaignId,
        milestoneId: milestone.id,
        releaseAmount,
        releasePercentage,
        txHash,
      });
    } catch (err) {
      log.error('CROWDFUNDING_SERVICE', 'Failed to release milestone funds', {
        campaignId,
        milestoneId: milestone.id,
        targetAmount: milestone.target_amount,
        releaseAmount,
        error: err.message,
      });
      // Continue processing other milestones
    }
  }

  return { releasedMilestones };
}

module.exports = { pledge, settle, getEscrowState, checkAndReleaseMilestones };
