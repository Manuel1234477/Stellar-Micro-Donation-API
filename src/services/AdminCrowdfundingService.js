/**
 * AdminCrowdfundingService - Business Logic Layer
 *
 * RESPONSIBILITY: Admin management of crowdfunding campaigns with milestone payouts.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, log, errors
 *
 * Campaigns have a goal, a deadline, and milestone payouts. Funds are released to
 * the recipient when specific milestones are reached. This service handles:
 *   - Listing all campaigns with progress enrichment
 *   - Creating campaigns with inline milestone definitions
 *   - Updating mutable campaign fields (name, description, deadline, goal)
 *   - Closing campaigns and triggering payouts for reached milestones
 *   - Listing milestones annotated with reached/unreached status
 */

'use strict';

const Database = require('../utils/database');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

class AdminCrowdfundingService {
  /**
   * List all campaigns enriched with progress and milestone summary.
   *
   * @param {object} [opts]
   * @param {string} [opts.status]  - Filter: 'active' | 'closed' | 'all' (default 'all')
   * @param {number} [opts.limit]   - Max rows (default 100)
   * @param {number} [opts.offset]  - Pagination offset (default 0)
   * @returns {Promise<Array>}
   */
  static async listCampaigns({ status = 'all', limit = 100, offset = 0 } = {}) {
    let sql = 'SELECT * FROM campaigns WHERE deleted_at IS NULL';
    const params = [];

    if (status === 'active') {
      sql += " AND status NOT IN ('closed', 'expired', 'released', 'refunded')";
    } else if (status === 'closed') {
      sql += " AND status IN ('closed', 'expired', 'released', 'refunded')";
    }

    sql += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const campaigns = await Database.query(sql, params);

    // Enrich each campaign with progress percentage and milestone counts
    return Promise.all(campaigns.map(async (c) => {
      const goal = c.goal_amount || 0;
      const raised = c.current_amount || 0;
      const progressPercent = goal > 0 ? Math.min(100, parseFloat(((raised / goal) * 100).toFixed(2))) : 0;

      const milestoneRow = await Database.get(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS reached
         FROM campaign_milestones WHERE campaign_id = ?`,
        [c.id]
      );

      return {
        ...c,
        progressPercent,
        milestones: {
          total: milestoneRow ? milestoneRow.total : 0,
          reached: milestoneRow ? (milestoneRow.reached || 0) : 0,
        },
      };
    }));
  }

  /**
   * Create a new campaign with optional inline milestones.
   *
   * @param {object} params
   * @param {string}   params.name
   * @param {string}   [params.description]
   * @param {number}   params.goal              - Goal amount in XLM
   * @param {string}   params.deadline          - ISO 8601 deadline date string
   * @param {string}   params.recipientPublicKey - Stellar public key of the recipient
   * @param {Array}    [params.milestones]       - [{ amount, description }]
   * @param {*}        [params.createdBy]        - User ID of the creating admin
   * @returns {Promise<object>} Created campaign with milestones
   */
  static async createCampaign({ name, description, goal, deadline, recipientPublicKey, milestones = [], createdBy = null }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required');
    }
    if (typeof goal !== 'number' || goal <= 0) {
      throw new ValidationError('goal must be a positive number');
    }
    if (!deadline || isNaN(Date.parse(deadline))) {
      throw new ValidationError('deadline must be a valid ISO 8601 date string');
    }
    if (!recipientPublicKey || typeof recipientPublicKey !== 'string' || !recipientPublicKey.trim()) {
      throw new ValidationError('recipientPublicKey is required');
    }

    // Validate milestones before inserting anything
    if (!Array.isArray(milestones)) {
      throw new ValidationError('milestones must be an array');
    }
    for (let i = 0; i < milestones.length; i++) {
      const m = milestones[i];
      if (typeof m.amount !== 'number' || m.amount <= 0) {
        throw new ValidationError(`milestones[${i}].amount must be a positive number`);
      }
    }

    const result = await Database.run(
      `INSERT INTO campaigns
         (name, description, goal_amount, current_amount, start_date, end_date, created_by, status, funding_model, recipient_public_key)
       VALUES (?, ?, ?, 0, datetime('now'), ?, ?, 'active', 'keep-what-you-raise', ?)`,
      [
        name.trim(),
        description || null,
        goal,
        new Date(deadline).toISOString(),
        createdBy ? String(createdBy) : null,
        recipientPublicKey.trim(),
      ]
    );

    const campaignId = result.id;

    // Insert milestones
    const insertedMilestones = [];
    for (const m of milestones) {
      const mResult = await Database.run(
        `INSERT INTO campaign_milestones (campaign_id, title, description, target_amount)
         VALUES (?, ?, ?, ?)`,
        [campaignId, m.description || `Milestone ${insertedMilestones.length + 1}`, m.description || null, m.amount]
      );
      const milestone = await Database.get('SELECT * FROM campaign_milestones WHERE id = ?', [mResult.id]);
      insertedMilestones.push(milestone);
    }

    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [campaignId]);

    log.info('ADMIN_CROWDFUNDING', 'Campaign created', { campaignId, name, goal, milestoneCount: insertedMilestones.length });

    return { ...campaign, milestones: insertedMilestones };
  }

  /**
   * Update mutable campaign fields. Closed campaigns cannot be updated.
   *
   * @param {number} id
   * @param {object} fields - { name?, description?, deadline?, goal? }
   * @returns {Promise<object>} Updated campaign
   */
  static async updateCampaign(id, { name, description, deadline, goal } = {}) {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!campaign) {
      throw new NotFoundError('Campaign not found', ERROR_CODES.NOT_FOUND);
    }

    const CLOSED_STATUSES = ['closed', 'expired', 'released', 'refunded'];
    if (CLOSED_STATUSES.includes(campaign.status)) {
      throw new ValidationError('Cannot update a closed campaign');
    }

    const updates = [];
    const params = [];

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        throw new ValidationError('name must be a non-empty string');
      }
      updates.push('name = ?');
      params.push(name.trim());
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description);
    }

    if (deadline !== undefined) {
      if (isNaN(Date.parse(deadline))) {
        throw new ValidationError('deadline must be a valid ISO 8601 date string');
      }
      updates.push('end_date = ?');
      params.push(new Date(deadline).toISOString());
    }

    if (goal !== undefined) {
      if (typeof goal !== 'number' || goal <= 0) {
        throw new ValidationError('goal must be a positive number');
      }
      updates.push('goal_amount = ?');
      params.push(goal);
    }

    if (updates.length === 0) {
      throw new ValidationError('No updatable fields provided');
    }

    updates.push('updatedAt = CURRENT_TIMESTAMP');
    params.push(id);

    await Database.run(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`, params);

    const updated = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);
    log.info('ADMIN_CROWDFUNDING', 'Campaign updated', { campaignId: id });
    return updated;
  }

  /**
   * Close a campaign and trigger milestone payouts for all milestones whose
   * target_amount has been reached by the campaign's current_amount.
   *
   * Idempotent — calling on an already-closed campaign returns the existing state.
   *
   * @param {number} id - Campaign ID
   * @returns {Promise<object>} { campaign, milestonesTriggered, payouts }
   */
  static async closeCampaign(id) {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!campaign) {
      throw new NotFoundError('Campaign not found', ERROR_CODES.NOT_FOUND);
    }

    // Idempotent: already closed
    if (campaign.status === 'closed') {
      const milestones = await Database.query(
        'SELECT * FROM campaign_milestones WHERE campaign_id = ? ORDER BY target_amount ASC',
        [id]
      );
      return {
        campaign,
        milestonesTriggered: 0,
        payouts: [],
        message: 'Campaign was already closed',
      };
    }

    // Mark campaign as closed
    await Database.run(
      "UPDATE campaigns SET status = 'closed', updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
      [id]
    );

    // Trigger payouts for milestones whose target_amount <= current_amount
    const milestones = await Database.query(
      'SELECT * FROM campaign_milestones WHERE campaign_id = ? ORDER BY target_amount ASC',
      [id]
    );

    const raised = campaign.current_amount || 0;
    const payouts = [];

    for (const milestone of milestones) {
      const reached = raised >= milestone.target_amount;

      if (reached && milestone.status !== 'verified') {
        // Simulate fund release (in production this triggers an on-chain claimable balance)
        const fundReleaseTx = `mock_release_${Date.now()}_milestone_${milestone.id}`;

        await Database.run(
          `UPDATE campaign_milestones
           SET status = 'verified', verified_at = CURRENT_TIMESTAMP, verified_by = 'system_close', fund_release_tx = ?
           WHERE id = ?`,
          [fundReleaseTx, milestone.id]
        );

        payouts.push({
          milestoneId: milestone.id,
          title: milestone.title,
          targetAmount: milestone.target_amount,
          fundReleaseTx,
          status: 'verified',
        });

        log.info('ADMIN_CROWDFUNDING', 'Milestone payout triggered on campaign close', {
          campaignId: id,
          milestoneId: milestone.id,
          targetAmount: milestone.target_amount,
          fundReleaseTx,
        });
      }
    }

    const closedCampaign = await Database.get('SELECT * FROM campaigns WHERE id = ?', [id]);

    log.info('ADMIN_CROWDFUNDING', 'Campaign closed', { campaignId: id, milestonesTriggered: payouts.length });

    return {
      campaign: closedCampaign,
      milestonesTriggered: payouts.length,
      payouts,
    };
  }

  /**
   * List milestones for a campaign annotated with reached/unreached status.
   * A milestone is "reached" when the campaign's current_amount >= milestone.target_amount.
   *
   * @param {number} id - Campaign ID
   * @returns {Promise<{ campaign: object, milestones: Array }>}
   */
  static async getMilestonesWithStatus(id) {
    const campaign = await Database.get('SELECT * FROM campaigns WHERE id = ? AND deleted_at IS NULL', [id]);
    if (!campaign) {
      throw new NotFoundError('Campaign not found', ERROR_CODES.NOT_FOUND);
    }

    const milestones = await Database.query(
      'SELECT * FROM campaign_milestones WHERE campaign_id = ? ORDER BY target_amount ASC',
      [id]
    );

    const raised = campaign.current_amount || 0;

    const annotated = milestones.map((m) => ({
      ...m,
      reached: raised >= m.target_amount,
    }));

    return { campaign, milestones: annotated };
  }
}

module.exports = AdminCrowdfundingService;
