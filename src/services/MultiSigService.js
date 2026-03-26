/**
 * MultiSigService - Multi-Signature Transaction Management
 *
 * Handles creation, signature collection, and auto-submission of
 * multi-signature Stellar transactions.
 *
 * @module MultiSigService
 */

const Database = require('../utils/database');
const log = require('../utils/log');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');

/**
 * @typedef {Object} MultiSigTransaction
 * @property {number}   id                  - Internal DB id
 * @property {string}   transaction_xdr     - Unsigned transaction XDR envelope
 * @property {string}   network_passphrase  - Stellar network passphrase
 * @property {number}   required_signers    - Number of signatures needed
 * @property {string[]} signer_keys         - Authorised signer public keys
 * @property {Object[]} collected_signatures - [{signer, signature_xdr}]
 * @property {string}   status              - 'pending' | 'complete' | 'submitted' | 'failed'
 * @property {string|null} stellar_tx_hash  - Set after successful submission
 * @property {number|null} stellar_ledger   - Set after successful submission
 * @property {Object|null} metadata         - Arbitrary caller-supplied metadata
 * @property {string}   created_at
 * @property {string}   updated_at
 */

class MultiSigService {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    if (!stellarService) {
      throw new Error('stellarService is required');
    }
    this.stellarService = stellarService;
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  /** @private */
  _parseRow(row) {
    if (!row) return null;
    return {
      ...row,
      signer_keys: JSON.parse(row.signer_keys),
      collected_signatures: JSON.parse(row.collected_signatures),
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }

  // ─── public API ─────────────────────────────────────────────────────────────

  /**
   * Create a new pending multi-sig transaction record.
   *
   * @param {Object} params
   * @param {string}   params.transaction_xdr     - Base-64 XDR of the unsigned transaction
   * @param {string}   params.network_passphrase  - Stellar network passphrase
   * @param {number}   params.required_signers    - Minimum signatures required (≥ 2)
   * @param {string[]} params.signer_keys         - Authorised signer public keys
   * @param {Object}   [params.metadata]          - Optional caller metadata
   * @returns {Promise<MultiSigTransaction>}
   */
  async createMultiSigTransaction({ transaction_xdr, network_passphrase, required_signers, signer_keys, metadata = null }) {
    if (!transaction_xdr || typeof transaction_xdr !== 'string') {
      throw new ValidationError('transaction_xdr is required');
    }
    if (!network_passphrase || typeof network_passphrase !== 'string') {
      throw new ValidationError('network_passphrase is required');
    }
    if (!Number.isInteger(required_signers) || required_signers < 2) {
      throw new ValidationError('required_signers must be an integer ≥ 2');
    }
    if (!Array.isArray(signer_keys) || signer_keys.length < required_signers) {
      throw new ValidationError('signer_keys must be an array with at least required_signers entries');
    }
    if (new Set(signer_keys).size !== signer_keys.length) {
      throw new ValidationError('signer_keys must not contain duplicates');
    }

    const result = await Database.run(
      `INSERT INTO multisig_transactions
         (transaction_xdr, network_passphrase, required_signers, signer_keys, collected_signatures, metadata)
       VALUES (?, ?, ?, ?, '[]', ?)`,
      [
        transaction_xdr,
        network_passphrase,
        required_signers,
        JSON.stringify(signer_keys),
        metadata ? JSON.stringify(metadata) : null,
      ]
    );

    log.info('MULTISIG', 'Created multi-sig transaction', { id: result.id, required_signers });
    return this.getTransaction(result.id);
  }

  /**
   * Add a signature to a pending multi-sig transaction.
   * Auto-submits to Stellar when the threshold is reached.
   *
   * @param {number} id          - Multi-sig transaction id
   * @param {string} signer      - Public key of the signer
   * @param {string} signed_xdr  - Base-64 XDR of the transaction signed by `signer`
   * @returns {Promise<MultiSigTransaction>} Updated record (status may be 'submitted')
   */
  async addSignature(id, signer, signed_xdr) {
    if (!signer || typeof signer !== 'string') {
      throw new ValidationError('signer public key is required');
    }
    if (!signed_xdr || typeof signed_xdr !== 'string') {
      throw new ValidationError('signed_xdr is required');
    }

    const tx = await this.getTransaction(id);
    if (!tx) throw new NotFoundError(`Multi-sig transaction ${id} not found`);

    if (tx.status !== 'pending') {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Transaction is already ${tx.status}`
      );
    }

    if (!tx.signer_keys.includes(signer)) {
      throw new ValidationError(`${signer} is not an authorised signer for this transaction`);
    }

    if (tx.collected_signatures.some(s => s.signer === signer)) {
      throw new ValidationError(`${signer} has already signed this transaction`);
    }

    const updatedSignatures = [...tx.collected_signatures, { signer, signed_xdr }];
    const thresholdMet = updatedSignatures.length >= tx.required_signers;
    const newStatus = thresholdMet ? 'complete' : 'pending';

    await Database.run(
      `UPDATE multisig_transactions
          SET collected_signatures = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`,
      [JSON.stringify(updatedSignatures), newStatus, id]
    );

    log.info('MULTISIG', 'Signature added', {
      id,
      signer,
      collected: updatedSignatures.length,
      required: tx.required_signers,
      thresholdMet,
    });

    if (thresholdMet) {
      return this._submitTransaction(id, updatedSignatures, tx);
    }

    return this.getTransaction(id);
  }

  /**
   * Submit the fully-signed transaction to the Stellar network.
   * Called automatically when threshold is met; exposed for testing.
   *
   * @private
   * @param {number} id
   * @param {Object[]} signatures
   * @param {MultiSigTransaction} tx
   * @returns {Promise<MultiSigTransaction>}
   */
  async _submitTransaction(id, signatures, tx) {
    try {
      // Delegate actual XDR merging + submission to the stellar service
      const result = await this.stellarService.submitMultiSigTransaction({
        transaction_xdr: tx.transaction_xdr,
        network_passphrase: tx.network_passphrase,
        signatures,
      });

      await Database.run(
        `UPDATE multisig_transactions
            SET status = 'submitted', stellar_tx_hash = ?, stellar_ledger = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [result.transactionId, result.ledger || null, id]
      );

      log.info('MULTISIG', 'Transaction submitted', { id, hash: result.transactionId });
    } catch (err) {
      await Database.run(
        `UPDATE multisig_transactions
            SET status = 'failed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
        [id]
      );
      log.error('MULTISIG', 'Submission failed', { id, error: err.message });
    }

    return this.getTransaction(id);
  }

  /**
   * Retrieve a multi-sig transaction by id.
   *
   * @param {number} id
   * @returns {Promise<MultiSigTransaction|null>}
   */
  async getTransaction(id) {
    const row = await Database.get('SELECT * FROM multisig_transactions WHERE id = ?', [id]);
    return this._parseRow(row);
  }

  /**
   * List all signatures collected for a transaction.
   *
   * @param {number} id
   * @returns {Promise<{id: number, collected: Object[], required: number, remaining: number}>}
   */
  async getSignatures(id) {
    const tx = await this.getTransaction(id);
    if (!tx) throw new NotFoundError(`Multi-sig transaction ${id} not found`);

    return {
      id: tx.id,
      status: tx.status,
      collected: tx.collected_signatures,
      required: tx.required_signers,
      remaining: Math.max(0, tx.required_signers - tx.collected_signatures.length),
    };
  }
}

module.exports = MultiSigService;
