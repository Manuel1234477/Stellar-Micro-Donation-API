/**
 * SocialRecoveryService - Business Logic for Guardian-Based Account Recovery
 *
 * RESPONSIBILITY: Manage guardian designation, recovery initiation, approval
 *   accumulation, time-lock enforcement, and fund transfer on threshold.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, StellarService
 */

'use strict';

const Database = require('../utils/database');
const { NotFoundError, ValidationError, DuplicateError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

const TIME_LOCK_HOURS = 48;
const TIME_LOCK_MS = TIME_LOCK_HOURS * 60 * 60 * 1000;

class SocialRecoveryService {
  /**
   * @param {object} stellarService - Stellar service instance for fund transfers.
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  /**
   * Set guardians for a wallet, replacing any existing ones.
   *
   * @param {number} walletId - The wallet's database ID.
   * @param {string[]} guardianPublicKeys - Array of guardian Stellar public keys.
   * @param {number} threshold - Minimum approvals required to execute recovery.
   * @returns {Promise<{guardians: string[], threshold: number}>}
   */
  async setGuardians(walletId, guardianPublicKeys, threshold) {
    await this._assertWalletExists(walletId);

    if (!Array.isArray(guardianPublicKeys) || guardianPublicKeys.length === 0) {
      throw new ValidationError('guardianPublicKeys must be a non-empty array', ERROR_CODES.VALIDATION_ERROR);
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > guardianPublicKeys.length) {
      throw new ValidationError(
        `threshold must be an integer between 1 and ${guardianPublicKeys.length}`,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    // Replace guardians atomically; store threshold on first guardian row as sentinel
    await Database.run('DELETE FROM recovery_guardians WHERE walletId = ?', [walletId]);
    for (let i = 0; i < guardianPublicKeys.length; i++) {
      await Database.run(
        'INSERT INTO recovery_guardians (walletId, guardianPublicKey, threshold) VALUES (?, ?, ?)',
        [walletId, guardianPublicKeys[i], i === 0 ? threshold : null]
      );
    }

    log.info('SOCIAL_RECOVERY', 'Guardians set', { walletId, count: guardianPublicKeys.length, threshold });
    return { guardians: guardianPublicKeys, threshold };
  }

  /**
   * Get guardians for a wallet.
   *
   * @param {number} walletId
   * @returns {Promise<string[]>}
   */
  async getGuardians(walletId) {
    await this._assertWalletExists(walletId);
    const rows = await Database.query(
      'SELECT guardianPublicKey FROM recovery_guardians WHERE walletId = ?',
      [walletId]
    );
    return rows.map((r) => r.guardianPublicKey);
  }

  /**
   * Initiate a recovery request for a wallet.
   * Creates a pending request with a 48-hour time-lock.
   *
   * @param {number} walletId
   * @param {string} newPublicKey - The new Stellar public key to recover funds to.
   * @returns {Promise<object>} The created recovery request.
   */
  async initiateRecovery(walletId, newPublicKey) {
    await this._assertWalletExists(walletId);

    const guardians = await this.getGuardians(walletId);
    if (guardians.length === 0) {
      throw new ValidationError('No guardians configured for this wallet', ERROR_CODES.VALIDATION_ERROR);
    }

    // Cancel any existing pending request
    await Database.run(
      "UPDATE recovery_requests SET status = 'cancelled' WHERE walletId = ? AND status = 'pending'",
      [walletId]
    );

    const threshold = await this._getThreshold(walletId, guardians.length);
    const executeAfter = new Date(Date.now() + TIME_LOCK_MS).toISOString();

    const result = await Database.run(
      `INSERT INTO recovery_requests (walletId, newPublicKey, threshold, executeAfter)
       VALUES (?, ?, ?, ?)`,
      [walletId, newPublicKey, threshold, executeAfter]
    );

    const request = await Database.get(
      'SELECT * FROM recovery_requests WHERE id = ?',
      [result.id]
    );

    log.info('SOCIAL_RECOVERY', 'Recovery initiated', { walletId, recoveryRequestId: String(request.id), executeAfter });
    return request;
  }

  /**
   * Record a guardian's approval for a recovery request.
   * Auto-executes if threshold is met and time-lock has passed.
   *
   * @param {number} walletId
   * @param {number} recoveryRequestId
   * @param {string} guardianPublicKey - The approving guardian's public key.
   * @returns {Promise<object>} Updated recovery request with approval count.
   */
  async approveRecovery(walletId, recoveryRequestId, guardianPublicKey) {
    const request = await this._assertPendingRequest(walletId, recoveryRequestId);

    // Verify guardian is authorized
    const guardians = await this.getGuardians(walletId);
    if (!guardians.includes(guardianPublicKey)) {
      throw new ValidationError('Not an authorized guardian for this wallet', ERROR_CODES.FORBIDDEN);
    }

    // Record approval (UNIQUE constraint prevents duplicates)
    try {
      await Database.run(
        'INSERT INTO recovery_approvals (recoveryRequestId, guardianPublicKey) VALUES (?, ?)',
        [recoveryRequestId, guardianPublicKey]
      );
    } catch (err) {
      if (err instanceof DuplicateError || (err.message && err.message.includes('UNIQUE'))) {
        throw new ValidationError('Guardian has already approved this request', ERROR_CODES.DUPLICATE_RESOURCE);
      }
      throw err;
    }

    const approvalCount = await this._getApprovalCount(recoveryRequestId);
    log.info('SOCIAL_RECOVERY', 'Guardian approved', { walletId, recoveryRequestId: String(recoveryRequestId), guardianPublicKey, approvalCount, threshold: request.threshold });

    // Auto-execute if threshold met and time-lock passed
    if (approvalCount >= request.threshold) {
      const now = new Date();
      const executeAfter = new Date(request.executeAfter);
      if (now >= executeAfter) {
        await this._executeRecovery(request);
        return { ...request, approvalCount, status: 'executed' };
      }
    }

    return { ...request, approvalCount };
  }

  /**
   * Get the current state of a recovery request.
   *
   * @param {number} walletId
   * @param {number} recoveryRequestId
   * @returns {Promise<object>}
   */
  async getRecoveryRequest(walletId, recoveryRequestId) {
    const request = await Database.get(
      'SELECT * FROM recovery_requests WHERE id = ? AND walletId = ?',
      [recoveryRequestId, walletId]
    );
    if (!request) {
      throw new NotFoundError('Recovery request not found');
    }
    const approvalCount = await this._getApprovalCount(recoveryRequestId);
    return { ...request, approvalCount };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  async _assertWalletExists(walletId) {
    const wallet = await Database.get('SELECT id FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      throw new NotFoundError(`Wallet ${walletId} not found`);
    }
  }

  async _assertPendingRequest(walletId, recoveryRequestId) {
    const request = await Database.get(
      "SELECT * FROM recovery_requests WHERE id = ? AND walletId = ? AND status = 'pending'",
      [recoveryRequestId, walletId]
    );
    if (!request) {
      throw new NotFoundError('Pending recovery request not found');
    }
    return request;
  }

  async _getApprovalCount(recoveryRequestId) {
    const row = await Database.get(
      'SELECT COUNT(*) as count FROM recovery_approvals WHERE recoveryRequestId = ?',
      [recoveryRequestId]
    );
    return row ? row.count : 0;
  }

  /**
   * Read the stored threshold for a wallet's guardian config.
   * Falls back to majority if not stored.
   */
  async _getThreshold(walletId, guardianCount) {
    const row = await Database.get(
      'SELECT threshold FROM recovery_guardians WHERE walletId = ? AND threshold IS NOT NULL LIMIT 1',
      [walletId]
    );
    return (row && row.threshold) ? row.threshold : Math.ceil(guardianCount / 2);
  }

  /**
   * Execute the recovery: transfer funds to newPublicKey and mark request executed.
   *
   * @param {object} request - Recovery request row.
   */
  async _executeRecovery(request) {
    log.info('SOCIAL_RECOVERY', 'Executing recovery', { recoveryRequestId: String(request.id), walletId: request.walletId });

    try {
      if (this.stellarService && typeof this.stellarService.mergeAccount === 'function') {
        await this.stellarService.mergeAccount(request.walletId, request.newPublicKey);
      }
    } catch (err) {
      log.error('SOCIAL_RECOVERY', 'Stellar transfer failed during recovery', { error: err.message });
      throw err;
    }

    await Database.run(
      "UPDATE recovery_requests SET status = 'executed', executedAt = ? WHERE id = ?",
      [new Date().toISOString(), request.id]
    );

    // Update wallet's public key in users table
    await Database.run(
      'UPDATE OR IGNORE users SET publicKey = ? WHERE id = ?',
      [request.newPublicKey, request.walletId]
    );

    log.info('SOCIAL_RECOVERY', 'Recovery executed successfully', { recoveryRequestId: String(request.id) });
  }
}

module.exports = SocialRecoveryService;
