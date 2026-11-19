/**
 * CorporateMatchingService - Business Logic for Corporate Donation Matching (#1550)
 *
 * RESPONSIBILITY: Manage corporate matching programs (sponsor, match ratio,
 *   per-employee and total caps), employee enrollment, and automatic creation
 *   of a matched donation whenever an enrolled employee's donation clears.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, models/transaction (donation ledger), StellarService
 *
 * Table layout (see migrations/052_corporate_matching_programs.js):
 *   corporate_matching          - one row per matching program
 *   matching_employees          - which employees are enrolled in which program
 *   employee_matching_history   - matched-amount-per-employee-per-year (annual cap tracking)
 *   corporate_matching_donations - audit trail linking an original donation to its match
 */

'use strict';

const Database = require('../utils/database');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');
const { toStroops, fromStroops } = require('../utils/money');

class CorporateMatchingService {
  // ─── Program management ─────────────────────────────────────────────────────

  /**
   * Create a new corporate matching program.
   * @param {object} params
   * @param {number} params.sponsor_id - users.id of the corporate sponsor account
   * @param {number} params.match_ratio - e.g. 1.0 for 1:1, 0.5 for 0.5:1 (converted to basis points)
   * @param {number} params.per_employee_limit - max total matched per employee per year (XLM)
   * @param {number} params.total_limit - max total matched across the whole program (XLM)
   * @returns {Promise<object>} Created program
   */
  static async create({ sponsor_id, match_ratio, per_employee_limit, total_limit }) {
    if (!Number.isInteger(sponsor_id) || sponsor_id < 1) {
      throw new ValidationError('sponsor_id must be a positive integer', null, ERROR_CODES.VALIDATION_ERROR);
    }
    if (typeof match_ratio !== 'number' || match_ratio <= 0 || match_ratio > 10) {
      throw new ValidationError('match_ratio must be a number between 0 (exclusive) and 10 (inclusive)', null, ERROR_CODES.VALIDATION_ERROR);
    }
    if (typeof per_employee_limit !== 'number' || per_employee_limit <= 0) {
      throw new ValidationError('per_employee_limit must be a positive number', null, ERROR_CODES.VALIDATION_ERROR);
    }
    if (typeof total_limit !== 'number' || total_limit <= 0) {
      throw new ValidationError('total_limit must be a positive number', null, ERROR_CODES.VALIDATION_ERROR);
    }
    if (per_employee_limit > total_limit) {
      throw new ValidationError('per_employee_limit cannot exceed total_limit', null, ERROR_CODES.VALIDATION_ERROR);
    }

    const sponsor = await Database.get('SELECT id FROM users WHERE id = ?', [sponsor_id]);
    if (!sponsor) {
      throw new NotFoundError('Sponsor account not found', ERROR_CODES.NOT_FOUND);
    }

    // match_ratio is stored as an integer number of basis points (1/100 of a
    // percent) so no floating-point value ever reaches the database.
    const matchRatioBps = Math.round(match_ratio * 10_000);
    const perEmployeeLimitStroops = toStroops(String(per_employee_limit));
    const totalLimitStroops = toStroops(String(total_limit));

    const result = await Database.run(
      `INSERT INTO corporate_matching
         (sponsor_id, match_ratio_bps, per_employee_limit_stroops, total_limit_stroops, remaining_total_limit_stroops, status)
       VALUES (?, ?, ?, ?, ?, 'active')`,
      [
        sponsor_id,
        matchRatioBps,
        Number(perEmployeeLimitStroops),
        Number(totalLimitStroops),
        Number(totalLimitStroops),
      ]
    );

    const program = await Database.get('SELECT * FROM corporate_matching WHERE id = ?', [result.id]);
    log.info('CORPORATE_MATCHING', 'Created corporate matching program', {
      id: result.id, sponsor_id, match_ratio_bps: matchRatioBps,
      per_employee_limit_stroops: Number(perEmployeeLimitStroops),
      total_limit_stroops: Number(totalLimitStroops),
    });
    return program;
  }

  /**
   * Get a corporate matching program by ID.
   * @param {number} id
   * @returns {Promise<object>}
   */
  static async getById(id) {
    const program = await Database.get('SELECT * FROM corporate_matching WHERE id = ?', [id]);
    if (!program) {
      throw new NotFoundError('Corporate matching program not found', ERROR_CODES.NOT_FOUND);
    }
    return program;
  }

  /**
   * List corporate matching programs with optional filters.
   * @param {object} [filters]
   * @param {string} [filters.status]
   * @param {number} [filters.sponsor_id]
   * @returns {Promise<Array<object>>}
   */
  static async getAll(filters = {}) {
    let sql = 'SELECT * FROM corporate_matching';
    const conditions = [];
    const params = [];

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters.sponsor_id) {
      conditions.push('sponsor_id = ?');
      params.push(filters.sponsor_id);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    return Database.query(sql, params);
  }

  /**
   * Update a program's status.
   * @param {number} id
   * @param {string} status - active | paused | exhausted
   * @returns {Promise<object>}
   */
  static async updateStatus(id, status) {
    const validStatuses = ['active', 'paused', 'exhausted'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError(`status must be one of: ${validStatuses.join(', ')}`, null, ERROR_CODES.VALIDATION_ERROR);
    }
    await this.getById(id); // throws NotFoundError if missing

    await Database.run(
      `UPDATE corporate_matching SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, id]
    );
    log.info('CORPORATE_MATCHING', 'Updated program status', { id, status });
    return Database.get('SELECT * FROM corporate_matching WHERE id = ?', [id]);
  }

  // ─── Employee enrollment ─────────────────────────────────────────────────────

  /**
   * Enroll an employee (users.id) into a matching program.
   * @param {number} programId
   * @param {number} employeeWalletId - users.id of the employee
   * @returns {Promise<object>} Enrollment row
   */
  static async enrollEmployee(programId, employeeWalletId) {
    await this.getById(programId); // 404 if program doesn't exist

    if (!Number.isInteger(employeeWalletId) || employeeWalletId < 1) {
      throw new ValidationError('employeeWalletId must be a positive integer', null, ERROR_CODES.VALIDATION_ERROR);
    }
    const employee = await Database.get('SELECT id FROM users WHERE id = ?', [employeeWalletId]);
    if (!employee) {
      throw new NotFoundError('Employee wallet not found', ERROR_CODES.NOT_FOUND);
    }

    await Database.run(
      `INSERT OR IGNORE INTO matching_employees (corporate_matching_id, employee_wallet_id) VALUES (?, ?)`,
      [programId, employeeWalletId]
    );

    log.info('CORPORATE_MATCHING', 'Enrolled employee', { programId, employeeWalletId });
    return Database.get(
      'SELECT * FROM matching_employees WHERE corporate_matching_id = ? AND employee_wallet_id = ?',
      [programId, employeeWalletId]
    );
  }

  /**
   * Remove an employee's enrollment from a program.
   * @param {number} programId
   * @param {number} employeeWalletId
   */
  static async unenrollEmployee(programId, employeeWalletId) {
    await this.getById(programId);
    await Database.run(
      'DELETE FROM matching_employees WHERE corporate_matching_id = ? AND employee_wallet_id = ?',
      [programId, employeeWalletId]
    );
    log.info('CORPORATE_MATCHING', 'Unenrolled employee', { programId, employeeWalletId });
  }

  /**
   * Get enrolled employees for a program, joined with basic wallet info.
   * @param {number} id - programId
   * @returns {Promise<Array<object>>}
   */
  static async getEnrolledEmployees(id) {
    await this.getById(id);
    return Database.query(
      `SELECT me.id, me.corporate_matching_id, me.employee_wallet_id, me.enrolled_at, u.publicKey
       FROM matching_employees me
       JOIN users u ON u.id = me.employee_wallet_id
       WHERE me.corporate_matching_id = ?
       ORDER BY me.enrolled_at ASC`,
      [id]
    );
  }

  /**
   * Read how much of an employee's annual per-employee cap has already been used.
   * @private
   */
  static async _getEmployeeYearlyMatched(programId, employeeWalletId, year) {
    const row = await Database.get(
      'SELECT matched_amount_stroops FROM employee_matching_history WHERE corporate_matching_id = ? AND employee_wallet_id = ? AND year = ?',
      [programId, employeeWalletId, year]
    );
    return row ? BigInt(row.matched_amount_stroops || 0) : 0n;
  }

  // ─── Automatic matching on employee donation ─────────────────────────────────

  /**
   * Process corporate matching for a donation that just cleared. Finds every
   * active program the donor is enrolled in and, for each, creates a matched
   * donation from the sponsor's account up to the per-employee and total caps.
   *
   * Cap enforcement + program/history bookkeeping run inside a single DB
   * transaction per program so the remaining-limit counters can never drift
   * out of sync with the ledger, even under concurrent donations. The Stellar
   * payment and matched-donation record are created immediately afterwards
   * (the original donation itself was already committed by the caller before
   * this runs, so full atomicity with the original leg is bounded by that;
   * see docs note in DonationService.js).
   *
   * @param {object} donation
   * @param {string} donation.id - Original donation id (UUID from donations_store)
   * @param {number} donation.amount - Donation amount in XLM
   * @param {number} donation.senderId - users.id of the donor/employee
   * @returns {Promise<Array<object>>} One entry per matching donation created
   */
  static async processCorporateMatching(donation) {
    const { id: donationId, amount, senderId } = donation;
    if (!donationId || !(amount > 0) || !senderId) return [];

    const programs = await Database.query(
      `SELECT cm.* FROM corporate_matching cm
       JOIN matching_employees me ON me.corporate_matching_id = cm.id
       WHERE me.employee_wallet_id = ? AND cm.status = 'active' AND cm.remaining_total_limit_stroops > 0
       ORDER BY cm.created_at ASC`,
      [senderId]
    );

    const results = [];
    for (const program of programs) {
      try {
        const record = await this._matchSingleProgram(program, donationId, amount, senderId);
        if (record) results.push(record);
      } catch (err) {
        log.error('CORPORATE_MATCHING', 'Failed to process match for program', {
          programId: program.id, donationId, error: err.message,
        });
      }
    }
    return results;
  }

  /** @private */
  static async _matchSingleProgram(program, donationId, amount, senderId) {
    const year = new Date().getFullYear();
    // match_ratio_bps is an integer: matched = amount * bps / 10000, all in stroops.
    const matchRatioBps = BigInt(program.match_ratio_bps);
    const rawMatchStroops = (toStroops(String(amount)) * matchRatioBps) / 10_000n;

    const alreadyMatchedStroops = await this._getEmployeeYearlyMatched(program.id, senderId, year);
    const employeeRemainingStroops = BigInt(program.per_employee_limit_stroops) - alreadyMatchedStroops;
    const programRemainingStroops = BigInt(program.remaining_total_limit_stroops);
    if (employeeRemainingStroops <= 0n) return null;

    const matchStroops = [rawMatchStroops, employeeRemainingStroops, programRemainingStroops]
      .reduce((minimum, value) => value < minimum ? value : minimum);
    if (matchStroops <= 0n) return null;
    const matchAmount = fromStroops(matchStroops);

    const [sponsor, employee] = await Promise.all([
      Database.get('SELECT id, publicKey, encryptedSecret FROM users WHERE id = ?', [program.sponsor_id]),
      Database.get('SELECT id, publicKey FROM users WHERE id = ?', [senderId]),
    ]);
    if (!sponsor || !employee) return null;

    // Atomic cap enforcement + bookkeeping for this program.
    let linkRowId;
    let newRemainingStroops;
    await Database.runTransaction(async (tx) => {
      const fresh = await tx.get('SELECT remaining_total_limit_stroops FROM corporate_matching WHERE id = ?', [program.id]);
      const freshRemainingStroops = fresh ? BigInt(fresh.remaining_total_limit_stroops || 0) : 0n;
      if (!fresh || freshRemainingStroops < matchStroops) {
        throw new ValidationError(`Per-program match cap exceeded for program ${program.id}`, null, ERROR_CODES.VALIDATION_ERROR);
      }

      newRemainingStroops = freshRemainingStroops - matchStroops;
      await tx.run(
        `UPDATE corporate_matching SET remaining_total_limit_stroops = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [Number(newRemainingStroops), program.id]
      );

      /* eslint-disable no-secrets/no-secrets -- SQL conflict-target column list, not a credential */
      await tx.run(
        `INSERT INTO employee_matching_history (corporate_matching_id, employee_wallet_id, year, matched_amount_stroops, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(corporate_matching_id, employee_wallet_id, year)
         DO UPDATE SET matched_amount_stroops = matched_amount_stroops + excluded.matched_amount_stroops, updated_at = CURRENT_TIMESTAMP`,
        [program.id, senderId, year, Number(matchStroops)]
      );
      /* eslint-enable no-secrets/no-secrets */

      const insertResult = await tx.run(
        `INSERT INTO corporate_matching_donations
           (corporate_matching_id, original_donation_id, employee_wallet_id, matched_amount_stroops, year, status)
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [program.id, donationId, senderId, Number(matchStroops), year]
      );
      linkRowId = insertResult.id;

      if (newRemainingStroops <= 0n) {
        await tx.run(`UPDATE corporate_matching SET status = 'exhausted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [program.id]);
      }
    });

    // Submit the Stellar payment for the matched amount, from sponsor to the
    // same recipient as the original donation.
    const Transaction = require('../models/transaction');
    const originalTx = Transaction.getById(donationId);
    const recipientPublic = (originalTx && originalTx.recipient) || employee.publicKey;

    let stellarResult = null;
    try {
      const { getStellarService } = require('../config/stellar');
      const stellarService = getStellarService();
      if (stellarService && sponsor.encryptedSecret && recipientPublic) {
        stellarResult = await stellarService.sendPayment(
          sponsor.encryptedSecret, recipientPublic, matchAmount,
          `Corporate match for donation ${donationId}`
        );
      }
    } catch (err) {
      log.error('CORPORATE_MATCHING', 'Stellar match payment failed', {
        programId: program.id, donationId, error: err.message,
      });
    }

    const txHash = stellarResult ? (stellarResult.hash || stellarResult.transactionId || null) : null;

    const matchedTx = Transaction.create({
      amount: matchAmount,
      donor: sponsor.publicKey,
      recipient: recipientPublic,
      memo: `Corporate match for donation ${donationId}`,
      memoType: 'text',
      status: stellarResult ? 'confirmed' : 'pending',
      stellarTxId: txHash,
      matchedDonationId: donationId,
      isCorporateMatch: true,
      corporateMatchingProgramId: program.id,
    });

    // Link both donations to one another via matchedDonationId.
    try {
      Transaction.updateMatchedDonationId(donationId, matchedTx.id);
    } catch (err) {
      log.warn('CORPORATE_MATCHING', 'Failed to link original donation to match', { donationId, error: err.message });
    }

    await Database.run(
      `UPDATE corporate_matching_donations SET matched_donation_id = ?, status = 'completed', stellar_tx_hash = ? WHERE id = ?`,
      [matchedTx.id, txHash, linkRowId]
    ).catch((err) =>
      log.warn('CORPORATE_MATCHING', 'Failed to update matching link row', { linkRowId, error: err.message })
    );

    log.info('CORPORATE_MATCHING', 'Corporate match created', {
      programId: program.id, donationId, matchedDonationId: matchedTx.id, matchAmount,
    });

    return {
      corporate_matching_id: program.id,
      original_donation_id: donationId,
      matched_donation_id: matchedTx.id,
      matched_amount: matchAmount,
      sponsor_id: program.sponsor_id,
      employee_wallet_id: senderId,
      stellar_tx_hash: txHash,
    };
  }

  // ─── Admin reporting / export ─────────────────────────────────────────────────

  /**
   * Matching activity for one or all programs, for admin viewing/export.
   * @param {object} [filters]
   * @param {number} [filters.programId]
   * @param {number} [filters.sponsor_id]
   * @param {string} [filters.from] - ISO date, inclusive
   * @param {string} [filters.to] - ISO date, inclusive
   * @returns {Promise<Array<object>>}
   */
  static async getMatchingActivity({ programId, sponsor_id, from, to } = {}) {
    let sql = `
      SELECT cmd.id, cmd.corporate_matching_id, cmd.original_donation_id, cmd.matched_donation_id,
             cmd.employee_wallet_id, cmd.matched_amount_stroops, cmd.year, cmd.status, cmd.stellar_tx_hash,
             cmd.created_at, cm.sponsor_id, cm.match_ratio_bps
      FROM corporate_matching_donations cmd
      JOIN corporate_matching cm ON cm.id = cmd.corporate_matching_id
    `;
    const conditions = [];
    const params = [];

    if (programId) {
      conditions.push('cmd.corporate_matching_id = ?');
      params.push(programId);
    }
    if (sponsor_id) {
      conditions.push('cm.sponsor_id = ?');
      params.push(sponsor_id);
    }
    if (from) {
      conditions.push('cmd.created_at >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('cmd.created_at <= ?');
      params.push(to);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY cmd.created_at DESC';

    return Database.query(sql, params);
  }

  /**
   * Utilization summary for a single program (matched-to-date vs. remaining).
   * @param {number} id
   * @returns {Promise<object>}
   */
  static async getUtilization(id) {
    const program = await this.getById(id);
    const activity = await this.getMatchingActivity({ programId: id });
    const totalLimitStroops = BigInt(program.total_limit_stroops);
    const remainingStroops = BigInt(program.remaining_total_limit_stroops);
    const totalMatchedStroops = totalLimitStroops - remainingStroops;
    const totalMatched = fromStroops(totalMatchedStroops);
    const utilizationPercentage = totalLimitStroops > 0n
      ? Number(totalMatchedStroops * 10_000n / totalLimitStroops) / 100
      : 0;

    return {
      program_id: id,
      sponsor_id: program.sponsor_id,
      match_ratio_bps: program.match_ratio_bps,
      match_ratio: program.match_ratio_bps / 10_000,
      per_employee_limit: fromStroops(BigInt(program.per_employee_limit_stroops)),
      per_employee_limit_stroops: Number(program.per_employee_limit_stroops),
      total_limit: fromStroops(totalLimitStroops),
      total_limit_stroops: Number(totalLimitStroops),
      remaining_total_limit: fromStroops(remainingStroops),
      remaining_total_limit_stroops: Number(remainingStroops),
      total_matched: totalMatched,
      total_matched_stroops: Number(totalMatchedStroops),
      utilization_percentage: utilizationPercentage,
      matching_donations_count: activity.length,
      status: program.status,
    };
  }
}

module.exports = CorporateMatchingService;
