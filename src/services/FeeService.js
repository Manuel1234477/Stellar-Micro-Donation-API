/**
 * Fee Service - Student Fee Installment Layer
 *
 * RESPONSIBILITY: Track expected fees per student, aggregate installment payments,
 *                 and calculate outstanding balances.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, errors
 */

const Database = require('../utils/database');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');

class FeeService {
  /**
   * Create a new fee record for a student.
   * @param {string} studentId
   * @param {string} description
   * @param {number} totalAmount
   * @returns {Promise<Object>}
   */
  async createFee(studentId, description, totalAmount) {
    if (!studentId || typeof studentId !== 'string' || !studentId.trim()) {
      throw new ValidationError('studentId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }
    if (!description || typeof description !== 'string' || !description.trim()) {
      throw new ValidationError('description is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }
    if (typeof totalAmount !== 'number' || isNaN(totalAmount) || totalAmount <= 0) {
      throw new ValidationError('totalAmount must be a positive number', null, ERROR_CODES.INVALID_AMOUNT);
    }

    const result = await Database.run(
      `INSERT INTO student_fees (studentId, description, totalAmount, paidAmount) VALUES (?, ?, ?, 0)`,
      [studentId.trim(), description.trim(), totalAmount]
    );

    return this._buildFeeResponse(await this._getFeeById(result.id));
  }

  /**
   * Record an installment payment toward a fee.
   * Rejects payments that would exceed the total fee amount.
   * @param {number} feeId
   * @param {number} amount
   * @param {string} [note]
   * @returns {Promise<Object>}
   */
  async recordPayment(feeId, amount, note = null) {
    if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
      throw new ValidationError('amount must be a positive number', null, ERROR_CODES.INVALID_AMOUNT);
    }

    const fee = await this._getFeeById(feeId);
    if (!fee) {
      throw new NotFoundError(`Fee record ${feeId} not found`, ERROR_CODES.NOT_FOUND);
    }

    const remaining = fee.totalAmount - fee.paidAmount;
    if (amount > remaining) {
      throw new BusinessLogicError(
        ERROR_CODES.INVALID_AMOUNT,
        `Payment of ${amount} exceeds outstanding balance of ${remaining}`,
        { feeId, totalAmount: fee.totalAmount, paidAmount: fee.paidAmount, remaining, attempted: amount }
      );
    }

    await Database.run(
      `INSERT INTO fee_payments (feeId, amount, note) VALUES (?, ?, ?)`,
      [feeId, amount, note || null]
    );

    await Database.run(
      `UPDATE student_fees SET paidAmount = paidAmount + ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      [amount, feeId]
    );

    return this._buildFeeResponse(await this._getFeeById(feeId));
  }

  /**
   * Get a fee record with full balance summary and payment history.
   * @param {number} feeId
   * @returns {Promise<Object>}
   */
  async getFee(feeId) {
    const fee = await this._getFeeById(feeId);
    if (!fee) {
      throw new NotFoundError(`Fee record ${feeId} not found`, ERROR_CODES.NOT_FOUND);
    }

    const payments = await Database.query(
      `SELECT id, amount, note, paidAt FROM fee_payments WHERE feeId = ? ORDER BY paidAt ASC`,
      [feeId]
    );

    return { ...this._buildFeeResponse(fee), payments };
  }

  /**
   * List all fee records for a student.
   * @param {string} studentId
   * @returns {Promise<Array>}
   */
  async getFeesForStudent(studentId) {
    if (!studentId || typeof studentId !== 'string' || !studentId.trim()) {
      throw new ValidationError('studentId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const rows = await Database.query(
      `SELECT * FROM student_fees WHERE studentId = ? ORDER BY createdAt DESC`,
      [studentId.trim()]
    );

    return rows.map(fee => this._buildFeeResponse(fee));
  }

  async _getFeeById(feeId) {
    return Database.get('SELECT * FROM student_fees WHERE id = ?', [feeId]);
  }

  _buildFeeResponse(fee) {
    const remaining = Math.max(0, fee.totalAmount - fee.paidAmount);
    return {
      id: fee.id,
      studentId: fee.studentId,
      description: fee.description,
      totalAmount: fee.totalAmount,
      paidAmount: fee.paidAmount,
      remainingBalance: remaining,
      isPaid: remaining === 0,
      createdAt: fee.createdAt,
      updatedAt: fee.updatedAt,
    };
  }
}

module.exports = new FeeService();
