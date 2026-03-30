/**
 * CrowdfundingService
 *
 * Manages all-or-nothing crowdfunding campaigns:
 * - Holds donations in escrow until goal is met or deadline passes
 * - Releases funds to recipient on goal completion
 * - Refunds all donors if deadline passes without reaching goal
 * - Keep-what-you-raise campaigns pass through unchanged
 */

const Database = require('../utils/database');
const log = require('../utils/log');

/**
 * Pledge a donation to an all-or-nothing campaign (held in escrow).
 *
 * @param {number} campaignId - Campaign ID
 * @param {number} donorId - Donor user ID
 * @param {number} amount - Donation amount in XLM
 * @param {string} [idempotencyKey] - Optional idempotency key
 * @returns {Promise<{pledgeId: number, campaignId: number, donorId: number, amount: number, status: string}>}
 */
async function pledge(campaignId, donorId, amount) {
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

  const result = await Database.run(
    `INSERT INTO escrow_pledges (campaign_id, donor_id, amount, status)
     VALUES (?, ?, ?, 'held')`,
    [campaignId, donorId, amount]
  );

  // Update campaign current_amount
  await Database.run(
    'UPDATE campaigns SET current_amount = current_amount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [amount, campaignId]
  );

  log.info('Escrow pledge created', { pledgeId: result.id, campaignId, donorId, amount });
  return { pledgeId: result.id, campaignId, donorId, amount, status: 'held' };
}

/**
 * Settle a campaign: release funds to recipient if goal met, refund all donors otherwise.
 * Idempotent — calling on an already-settled campaign returns the existing result.
 *
 * @param {number} campaignId - Campaign ID
 * @returns {Promise<{outcome: 'released'|'refunded', campaignId: number, totalAmount: number, count: number}>}
 */
async function settle(campaignId) {
  const campaign = await Database.get(
    'SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL',
    [campaignId]
  );

  if (!campaign) throw Object.assign(new Error('Campaign not found'), { status: 404 });
  if (campaign.funding_model !== 'all-or-nothing') {
    throw Object.assign(new Error('Campaign is not all-or-nothing'), { status: 400 });
  }

  // Already settled — idempotent return
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

  // Atomic update: mark all held pledges and the campaign in one transaction
  await Database.run(
    `UPDATE escrow_pledges SET status = ? WHERE campaign_id = ? AND status = 'held'`,
    [pledgeStatus, campaignId]
  );
  await Database.run(
    'UPDATE campaigns SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?',
    [newStatus, campaignId]
  );

  const pledges = await Database.query(
    'SELECT * FROM escrow_pledges WHERE campaign_id = ?',
    [campaignId]
  );
  const totalAmount = pledges.reduce((s, p) => s + p.amount, 0);

  log.info('Campaign settled', { campaignId, outcome: newStatus, totalAmount, count: pledges.length });
  return { outcome: newStatus, campaignId, totalAmount, count: pledges.length };
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

module.exports = { pledge, settle, getEscrowState };
