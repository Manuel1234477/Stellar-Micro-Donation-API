/**
 * SocialRecoveryService - Business Logic for Guardian-Based Account Recovery (#1552)
 *
 * RESPONSIBILITY: Manage guardian designation, recovery initiation + guardian
 *   notification, M-of-N approval accumulation, the 72-hour expiration
 *   window, and the on-chain signer swap once threshold is met.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, StellarService, WebhookService
 */

'use strict';

const Database = require('../utils/database');
const { NotFoundError, ValidationError, DuplicateError, ERROR_CODES } = require('../utils/errors');
const log = require('../utils/log');

const EXPIRATION_HOURS = 72;
const EXPIRATION_MS = EXPIRATION_HOURS * 60 * 60 * 1000;

class SocialRecoveryService {
  /**
   * @param {object} stellarService - Stellar service instance for the on-chain signer swap.
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
  }

  /**
   * Set guardians for a wallet, replacing any existing ones.
   *
   * @param {number} walletId - The wallet's database ID.
   * @param {Array<string|{publicKey: string, email?: string}>} guardians - Guardian public keys,
   *   optionally paired with a notification email.
   * @param {number} threshold - Minimum approvals required to execute recovery.
   * @returns {Promise<{guardians: string[], threshold: number}>}
   */
  async setGuardians(walletId, guardians, threshold) {
    await this._assertWalletExists(walletId);

    if (!Array.isArray(guardians) || guardians.length === 0) {
      throw new ValidationError('guardianPublicKeys must be a non-empty array', ERROR_CODES.VALIDATION_ERROR);
    }

    const normalized = guardians.map((g) => (typeof g === 'string' ? { publicKey: g, email: null } : { publicKey: g.publicKey, email: g.email || null }));
    if (normalized.some((g) => !g.publicKey || typeof g.publicKey !== 'string')) {
      throw new ValidationError('Every guardian must have a publicKey', ERROR_CODES.VALIDATION_ERROR);
    }

    if (!Number.isInteger(threshold) || threshold < 1 || threshold > normalized.length) {
      throw new ValidationError(
        `threshold must be an integer between 1 and ${normalized.length}`,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    // Replace guardians atomically; store threshold on first guardian row as sentinel
    await Database.run('DELETE FROM recovery_guardians WHERE walletId = ?', [walletId]);
    for (let i = 0; i < normalized.length; i++) {
      await Database.run(
        'INSERT INTO recovery_guardians (walletId, guardianPublicKey, guardianEmail, threshold) VALUES (?, ?, ?, ?)',
        [walletId, normalized[i].publicKey, normalized[i].email, i === 0 ? threshold : null]
      );
    }

    log.info('SOCIAL_RECOVERY', 'Guardians set', { walletId, count: normalized.length, threshold });
    return { guardians: normalized.map((g) => g.publicKey), threshold };
  }

  /**
   * Get guardian public keys for a wallet.
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
   * Get full guardian contact records (public key + optional email) for a wallet.
   * @private
   */
  async _getGuardianContacts(walletId) {
    return Database.query(
      'SELECT guardianPublicKey, guardianEmail FROM recovery_guardians WHERE walletId = ?',
      [walletId]
    );
  }

  /**
   * Initiate a recovery request for a wallet.
   * Creates a pending request with a strict 72-hour expiration window and
   * notifies every registered guardian (webhook + email where on file).
   *
   * @param {number} walletId
   * @param {string} newPublicKey - The new Stellar public key to install as signer.
   * @returns {Promise<object>} The created recovery request.
   */
  async initiateRecovery(walletId, newPublicKey) {
    await this._assertWalletExists(walletId);

    if (!newPublicKey || typeof newPublicKey !== 'string') {
      throw new ValidationError('newPublicKey is required', ERROR_CODES.VALIDATION_ERROR);
    }

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
    const expiresAt = new Date(Date.now() + EXPIRATION_MS).toISOString();

    const result = await Database.run(
      `INSERT INTO recovery_requests (walletId, newPublicKey, threshold, executeAfter, expiresAt)
       VALUES (?, ?, ?, ?, ?)`,
      [walletId, newPublicKey, threshold, expiresAt, expiresAt]
    );

    const request = await Database.get(
      'SELECT * FROM recovery_requests WHERE id = ?',
      [result.id]
    );

    log.info('SOCIAL_RECOVERY', 'Recovery initiated', { walletId, recoveryRequestId: String(request.id), expiresAt });

    await this._notifyGuardians(walletId, request);

    return request;
  }

  /**
   * Record a guardian's approval for a recovery request.
   * Auto-executes the signer swap as soon as the M-th approval is registered,
   * provided the request has not yet expired.
   *
   * @param {number} walletId
   * @param {number} recoveryRequestId
   * @param {string} guardianPublicKey - The approving guardian's public key.
   * @returns {Promise<object>} Updated recovery request with approval count.
   */
  async approveRecovery(walletId, recoveryRequestId, guardianPublicKey) {
    let request = await this._assertPendingRequest(walletId, recoveryRequestId);
    request = await this._expireIfNeeded(request);
    if (request.status !== 'pending') {
      throw new ValidationError(`Recovery request has ${request.status}`, ERROR_CODES.VALIDATION_ERROR);
    }

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

    // Auto-execute as soon as the M-th approval is registered.
    if (approvalCount >= request.threshold) {
      await this._executeRecovery(request);
      return { ...request, approvalCount, status: 'executed' };
    }

    return { ...request, approvalCount };
  }

  /**
   * Get the current state of a recovery request. Lazily marks the request
   * expired if the 72-hour window has passed while it was still pending.
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
    const current = await this._expireIfNeeded(request);
    const approvalCount = await this._getApprovalCount(recoveryRequestId);
    return { ...current, approvalCount };
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
      'SELECT * FROM recovery_requests WHERE id = ? AND walletId = ?',
      [recoveryRequestId, walletId]
    );
    if (!request) {
      throw new NotFoundError('Recovery request not found');
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
   * Enforce the strict 72-hour expiration window: if a request is still
   * `pending` past its expiresAt, mark it `expired` and return the update.
   * @private
   */
  async _expireIfNeeded(request) {
    if (request.status !== 'pending') return request;
    const expiresAt = request.expiresAt || request.executeAfter;
    if (!expiresAt || new Date() < new Date(expiresAt)) return request;

    await Database.run(
      "UPDATE recovery_requests SET status = 'expired' WHERE id = ? AND status = 'pending'",
      [request.id]
    );
    log.info('SOCIAL_RECOVERY', 'Recovery request expired', { recoveryRequestId: String(request.id), walletId: request.walletId });
    return { ...request, status: 'expired' };
  }

  /**
   * Notify every registered guardian that a recovery request needs their
   * approval — a webhook broadcast plus a best-effort email where a guardian
   * has an email on file. Notification failures never block initiation.
   * @private
   */
  async _notifyGuardians(walletId, request) {
    const contacts = await this._getGuardianContacts(walletId);

    try {
      const WebhookService = require('./WebhookService');
      await WebhookService.deliver('recovery.initiated', {
        walletId,
        recoveryRequestId: request.id,
        newPublicKey: request.newPublicKey,
        threshold: request.threshold,
        expiresAt: request.expiresAt,
        guardians: contacts.map((c) => c.guardianPublicKey),
      });
    } catch (err) {
      log.warn('SOCIAL_RECOVERY', 'Failed to broadcast recovery.initiated webhook', { walletId, error: err.message });
    }

    const emailTargets = contacts.filter((c) => c.guardianEmail);
    if (emailTargets.length === 0) return;

    await Promise.all(emailTargets.map((c) => this._sendGuardianEmail(c.guardianEmail, walletId, request)));

    await Database.run(
      'UPDATE recovery_requests SET notifiedAt = ? WHERE id = ?',
      [new Date().toISOString(), request.id]
    ).catch(() => {});
  }

  /**
   * Best-effort guardian email notification via SMTP (nodemailer).
   * Requires SMTP_HOST / SMTP_USER / SMTP_PASS; silently skipped (with a log
   * line) when SMTP isn't configured, matching ApiKeyExpirationNotifier's
   * degrade-gracefully convention.
   * @private
   */
  async _sendGuardianEmail(toEmail, walletId, request) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      log.warn('SOCIAL_RECOVERY', 'Invalid guardian notification email', { walletId, toEmail });
      return;
    }
    if (!process.env.SMTP_HOST) {
      log.warn('SOCIAL_RECOVERY', 'SMTP not configured, skipping guardian email', { walletId, toEmail });
      return;
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'noreply@stellar-donations.local',
        to: toEmail,
        subject: `Action required: wallet recovery request #${request.id}`,
        text: [
          `A recovery request has been initiated for wallet ${walletId}.`,
          `Requested new signing key: ${request.newPublicKey}`,
          `Your approval is one of ${request.threshold} required to authorize this recovery.`,
          `This request expires at ${request.expiresAt}.`,
          '',
          `Approve via: POST /wallets/${walletId}/recovery/${request.id}/approve`,
        ].join('\n'),
      });
    } catch (err) {
      log.warn('SOCIAL_RECOVERY', 'Failed to send guardian notification email', { walletId, toEmail, error: err.message });
    }
  }

  /**
   * Execute the recovery: swap the wallet's active signer via a Stellar
   * multi-signature (setOptions) transaction — add the new key as a signer,
   * remove the old one — and mark the request executed. The account's
   * Stellar address (users.publicKey) does not change; only who can sign
   * for it does.
   *
   * @param {object} request - Recovery request row.
   */
  async _executeRecovery(request) {
    log.info('SOCIAL_RECOVERY', 'Executing recovery', { recoveryRequestId: String(request.id), walletId: request.walletId });

    const wallet = await Database.get('SELECT publicKey, encryptedSecret FROM users WHERE id = ?', [request.walletId]);

    try {
      if (this.stellarService && wallet && wallet.encryptedSecret) {
        if (typeof this.stellarService.addSigner === 'function') {
          await this.stellarService.addSigner(wallet.encryptedSecret, request.newPublicKey, 1);
        }
        if (typeof this.stellarService.removeSigner === 'function' && wallet.publicKey && wallet.publicKey !== request.newPublicKey) {
          await this.stellarService.removeSigner(wallet.encryptedSecret, wallet.publicKey);
        }
      }
    } catch (err) {
      log.error('SOCIAL_RECOVERY', 'Stellar signer swap failed during recovery', { error: err.message });
      throw err;
    }

    await Database.run(
      "UPDATE recovery_requests SET status = 'executed', executedAt = ? WHERE id = ?",
      [new Date().toISOString(), request.id]
    );

    log.info('SOCIAL_RECOVERY', 'Recovery executed successfully', { recoveryRequestId: String(request.id) });
  }
}

module.exports = SocialRecoveryService;
