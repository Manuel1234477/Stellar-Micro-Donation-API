/**
 * Matching Program Service - Business Logic Layer
 *
 * RESPONSIBILITY: Manage donation matching programs where sponsors match donations
 * OWNER: Backend Team
 * DEPENDENCIES: Database, WebhookService, DonationEvents, log
 *
 * Handles creation, retrieval, and execution of matching programs. When a qualifying
 * donation is received, this service calculates the match amount, creates a matching
 * donation record, and updates the program's remaining balance.
 */

const Database = require('../utils/database');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { toStroops, fromStroops, applyBps } = require('../utils/money');

class MatchingProgramService {
  /**
   * Create a new matching program.
   * @param {Object} params
   * @param {string} params.sponsor_wallet_id - Stellar public key of the sponsor
   * @param {number} params.match_ratio - Ratio to match (e.g. 1.0 = 1:1, 0.5 = 50%)
   * @param {number} params.max_match_amount - Maximum total amount the sponsor will match
   * @param {number|null} params.campaign_id - Optional campaign to restrict matching to
   * @returns {Promise<Object>} Created matching program
   */
  static async create({ sponsor_wallet_id, match_ratio, max_match_amount, campaign_id }) {
    if (!sponsor_wallet_id || typeof sponsor_wallet_id !== 'string') {
      throw new ValidationError('sponsor_wallet_id is required and must be a string');
    }
    if (typeof match_ratio !== 'number' || match_ratio <= 0 || match_ratio > 10) {
      throw new ValidationError('match_ratio must be a number between 0 (exclusive) and 10 (inclusive)');
    }
    if (typeof max_match_amount !== 'number' || max_match_amount <= 0) {
      throw new ValidationError('max_match_amount must be a positive number');
    }

    if (campaign_id) {
      const campaign = await Database.get('SELECT id FROM campaigns WHERE id = ?', [campaign_id]);
      if (!campaign) {
        throw new NotFoundError('Campaign not found', ERROR_CODES.NOT_FOUND);
      }
    }

    // Store the ratio as integer basis points (1.0 => 10000 bps) and all
    // monetary values as integer stroops per ADR-004.
    const matchRatioBps = Math.round(match_ratio * 10000);
    const maxMatchStroops = toStroops(String(max_match_amount));

    const result = await Database.run(
      `INSERT INTO matching_programs (sponsor_wallet_id, match_ratio_bps, max_match_amount_stroops, remaining_match_amount_stroops, campaign_id, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [sponsor_wallet_id, matchRatioBps, maxMatchStroops, maxMatchStroops, campaign_id || null]
    );

    const program = await Database.get('SELECT * FROM matching_programs WHERE id = ?', [result.id]);

    log.info('MATCHING_PROGRAM', 'Created matching program', {
      id: result.id,
      sponsor_wallet_id,
      match_ratio,
      match_ratio_bps: matchRatioBps,
      max_match_amount,
      campaign_id
    });

    return program;
  }

  /**
   * Get a matching program by ID.
   * @param {number} id
   * @returns {Promise<Object>} Matching program
   * @throws {NotFoundError}
   */
  static async getById(id) {
    const program = await Database.get('SELECT * FROM matching_programs WHERE id = ?', [id]);
    if (!program) {
      throw new NotFoundError('Matching program not found', ERROR_CODES.NOT_FOUND);
    }
    return program;
  }

  /**
   * Get all matching programs with optional status filter.
   * @param {Object} [filters]
   * @param {string} [filters.status] - Filter by status
   * @param {number} [filters.campaign_id] - Filter by campaign
   * @returns {Promise<Array>} List of matching programs
   */
  static async getAll(filters = {}) {
    let sql = 'SELECT * FROM matching_programs';
    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.campaign_id) {
      conditions.push('campaign_id = ?');
      params.push(filters.campaign_id);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';
    return Database.query(sql, params);
  }

  /**
   * Get active matching programs for a given campaign.
   * @param {number|null} campaignId
   * @returns {Promise<Array>} Active matching programs
   */
  static async getActiveForCampaign(campaignId) {
    if (!campaignId) return [];
    return Database.query(
      `SELECT * FROM matching_programs
       WHERE status = 'active' AND remaining_match_amount_stroops > 0
         AND campaign_id = ?
       ORDER BY created_at ASC`,
      [campaignId]
    );
  }

  /**
   * Get all active matching programs (including those without a campaign restriction).
   * @returns {Promise<Array>} Active programs with no campaign filter
   */
  static async getActiveGlobal() {
    return Database.query(
      `SELECT * FROM matching_programs
       WHERE status = 'active' AND remaining_match_amount_stroops > 0
         AND campaign_id IS NULL
       ORDER BY created_at ASC`
    );
  }

  /**
   * Process matching for a qualifying donation. Finds all applicable matching programs
   * and creates matching donations up to each program's remaining balance.
   *
   * @param {Object} donation - The original donation
   * @param {number} donation.id - Donation ID
   * @param {string|number} donation.amount - Donation amount in XLM
   * @param {number|null} donation.campaign_id - Campaign ID if applicable
   * @returns {Promise<Array>} Array of matching donation records created
   */
  static async processMatchingDonation(donation) {
    const { id: donationId, amount, campaign_id } = donation;
    const matchingRecords = [];
    const donationStroops = toStroops(String(amount));

    // Gather applicable programs: campaign-specific + global
    let programs = [];
    if (campaign_id) {
      programs = await this.getActiveForCampaign(campaign_id);
    }
    const globalPrograms = await this.getActiveGlobal();
    programs = programs.concat(globalPrograms);

    for (const program of programs) {
      const remainingStroops = BigInt(program.remaining_match_amount_stroops);
      if (remainingStroops <= 0n) continue;

      // match_ratio_bps is an integer number of basis points (10000 = 1:1).
      const ratioBps = BigInt(program.match_ratio_bps);
      const rawMatchStroops = applyBps(donationStroops, ratioBps);
      const finalMatchStroops = rawMatchStroops < remainingStroops ? rawMatchStroops : remainingStroops;
      if (finalMatchStroops <= 0n) continue;

      const finalMatchAmount = fromStroops(finalMatchStroops);
      const newRemainingStroops = remainingStroops - finalMatchStroops;
      const newRemaining = fromStroops(newRemainingStroops);
      await Database.run(
        `UPDATE matching_programs SET remaining_match_amount_stroops = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [newRemainingStroops.toString(), program.id]
      );

      // Record the matching donation
      const record = await Database.run(
        `INSERT INTO matching_donations (matching_program_id, original_donation_id, matched_amount)
         VALUES (?, ?, ?)`,
        [program.id, donationId, finalMatchAmount]
      );

      matchingRecords.push({
        id: record.id,
        matching_program_id: program.id,
        original_donation_id: donationId,
        matched_amount: finalMatchAmount,
        sponsor_wallet_id: program.sponsor_wallet_id
      });

      log.info('MATCHING_PROGRAM', 'Created matching donation', {
        matchingProgramId: program.id,
        originalDonationId: donationId,
        matchedAmount: finalMatchAmount,
        remainingBalance: newRemaining
      });

      // Check if program is exhausted
      if (newRemainingStroops <= 0n) {
        await this.markExhausted(program.id);
      }
    }

    return matchingRecords;
  }

  /**
   * Mark a matching program as exhausted and send notification.
   * @param {number} programId
   * @returns {Promise<void>}
   */
  static async markExhausted(programId) {
    await Database.run(
      `UPDATE matching_programs SET status = 'exhausted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [programId]
    );

    log.info('MATCHING_PROGRAM', 'Matching program exhausted', { programId });

    // Send webhook notification
    try {
      const WebhookService = require('./WebhookService');
      const program = await Database.get('SELECT * FROM matching_programs WHERE id = ?', [programId]);
      await WebhookService.deliver('matching_program.exhausted', {
        program_id: programId,
        sponsor_wallet_id: program.sponsor_wallet_id,
        max_match_amount: fromStroops(BigInt(program.max_match_amount_stroops)),
        campaign_id: program.campaign_id,
        exhausted_at: new Date().toISOString()
      });
    } catch (err) {
      log.error('MATCHING_PROGRAM', 'Failed to deliver exhaustion webhook', { error: err.message });
    }
  }

  /**
   * Update a matching program's status.
   * @param {number} id
   * @param {string} status - New status (active, paused, exhausted)
   * @returns {Promise<Object>} Updated program
   */
  static async updateStatus(id, status) {
    const validStatuses = ['active', 'paused', 'exhausted'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const _program = await this.getById(id);
    await Database.run(
      `UPDATE matching_programs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );

    log.info('MATCHING_PROGRAM', 'Updated matching program status', { id, status });
    return Database.get('SELECT * FROM matching_programs WHERE id = ?', [id]);
  }

  /**
   * Get utilization stats for a matching program.
   * @param {number} id
   * @returns {Promise<Object>} Utilization stats
   */
  static async getUtilization(id) {
    const program = await this.getById(id);
    const donations = await Database.query(
      'SELECT * FROM matching_donations WHERE matching_program_id = ? ORDER BY created_at DESC',
      [id]
    );

    const maxMatchStroops = BigInt(program.max_match_amount_stroops);
    const remainingStroops = BigInt(program.remaining_match_amount_stroops);
    const totalMatchedStroops = maxMatchStroops - remainingStroops;
    const utilizationPercentage = maxMatchStroops > 0n
      ? Number((totalMatchedStroops * 10000n) / maxMatchStroops) / 100
      : 0;

    return {
      program_id: id,
      sponsor_wallet_id: program.sponsor_wallet_id,
      match_ratio: Number(program.match_ratio_bps) / 10000,
      match_ratio_bps: program.match_ratio_bps,
      max_match_amount: fromStroops(maxMatchStroops),
      total_matched: fromStroops(totalMatchedStroops),
      remaining: fromStroops(remainingStroops),
      utilization_percentage: utilizationPercentage,
      matching_donations_count: donations.length,
      matching_donations: donations,
      status: program.status
    };
  }
}

module.exports = MatchingProgramService;
