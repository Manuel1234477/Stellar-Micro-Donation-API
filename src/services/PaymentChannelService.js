/**
 * PaymentChannelService — Stellar Payment Channel Protocol
 *
 * RESPONSIBILITY: Manage the full lifecycle of off-chain payment channels between two parties.
 * OWNER: Backend Team
 * DEPENDENCIES: Database, StellarService (for on-chain open/settle), crypto (for off-chain signing)
 *
 * Protocol overview:
 *  1. OPEN   — Both parties fund an escrow account on-chain. Channel record created with
 *              sequence number 0 and balance = 0.
 *  2. UPDATE — Either party signs an off-chain state update (sequence++, new balance).
 *              The counterparty countersigns to acknowledge. No network call needed.
 *  3. SETTLE — The latest mutually-signed state is submitted on-chain, closing the escrow
 *              and distributing funds. Channel status → 'settled'.
 *  4. DISPUTE — If one party submits an outdated state, the other can dispute within the
 *              timeout window by presenting a higher-sequence signed state.
 *  5. TIMEOUT — If a channel is open but unused past CHANNEL_TIMEOUT_MS, it can be force-closed.
 */

'use strict';

const crypto = require('crypto');
const Database = require('../utils/database');
const log = require('../utils/log');
const { ValidationError, NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');

/** Dispute window: 24 hours in milliseconds */
const DISPUTE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Channel inactivity timeout: 7 days */
const CHANNEL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Parse a raw DB row into a channel object.
 * @param {object|null} row
 * @returns {object|null}
 */
function parseRow(row) {
  if (!row) return null;
  return {
    ...row,
    signatures: row.signatures ? JSON.parse(row.signatures) : [],
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
  };
}

// ─── Signing helpers ──────────────────────────────────────────────────────────

/**
 * Build the canonical string that both parties sign for a channel state update.
 * Format: `channel:<id>:seq:<sequence>:balance:<balance>`
 * @param {string} channelId
 * @param {number} sequence
 * @param {number} balance - cumulative amount transferred from sender to receiver
 * @returns {string}
 */
function buildStateMessage(channelId, sequence, balance) {
  return `channel:${channelId}:seq:${sequence}:balance:${balance}`;
}

/**
 * Sign a channel state message with an HMAC-SHA256 using the party's secret key.
 * In a real Stellar implementation this would use Ed25519 via the Stellar SDK.
 * We use HMAC here to keep the service network-free and testable without key pairs.
 *
 * @param {string} message - Canonical state message
 * @param {string} secretKey - Signing party's secret key
 * @returns {string} Hex-encoded signature
 */
function signState(message, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

/**
 * Verify a state signature.
 * @param {string} message
 * @param {string} signature - Hex-encoded signature to verify
 * @param {string} secretKey - Secret key of the expected signer
 * @returns {boolean}
 */
function verifyStateSignature(message, signature, secretKey) {
  const expected = signState(message, secretKey);
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

// ─── Service class ────────────────────────────────────────────────────────────

class PaymentChannelService {
  /**
   * @param {object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    if (!stellarService) throw new Error('stellarService is required');
    this.stellarService = stellarService;
  }

  // ─── Table initialisation ──────────────────────────────────────────────────

  /**
   * Create the payment_channels table if it does not exist.
   * Called once at startup.
   * @returns {Promise<void>}
   */
  async initTable() {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS payment_channels (
        id          TEXT PRIMARY KEY,
        senderKey   TEXT NOT NULL,
        receiverKey TEXT NOT NULL,
        capacity    REAL NOT NULL,
        balance     REAL NOT NULL DEFAULT 0,
        sequence    INTEGER NOT NULL DEFAULT 0,
        status      TEXT NOT NULL DEFAULT 'open',
        signatures  TEXT NOT NULL DEFAULT '[]',
        disputedAt  TEXT,
        disputeSeq  INTEGER,
        settledAt   TEXT,
        closedAt    TEXT,
        metadata    TEXT,
        createdAt   TEXT NOT NULL,
        updatedAt   TEXT NOT NULL
      )
    `);
  }

  // ─── Open ──────────────────────────────────────────────────────────────────

  /**
   * Open a new payment channel between two parties.
   * Records the channel in the database. In a full implementation the caller
   * would also submit an on-chain escrow funding transaction; here we accept
   * an optional `fundingTxId` to record that reference.
   *
   * @param {object} params
   * @param {string} params.senderKey    - Sender's Stellar public key
   * @param {string} params.receiverKey  - Receiver's Stellar public key
   * @param {number} params.capacity     - Maximum XLM the channel can hold
   * @param {string} [params.fundingTxId] - On-chain escrow funding transaction ID
   * @param {object} [params.metadata]   - Optional caller metadata
   * @returns {Promise<object>} Created channel record
   */
  async openChannel({ senderKey, receiverKey, capacity, fundingTxId = null, metadata = null }) {
    if (!senderKey || typeof senderKey !== 'string') {
      throw new ValidationError('senderKey is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }
    if (!receiverKey || typeof receiverKey !== 'string') {
      throw new ValidationError('receiverKey is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }
    if (senderKey === receiverKey) {
      throw new ValidationError('senderKey and receiverKey must be different', null, ERROR_CODES.INVALID_REQUEST);
    }
    if (typeof capacity !== 'number' || capacity <= 0) {
      throw new ValidationError('capacity must be a positive number', null, ERROR_CODES.INVALID_REQUEST);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await Database.run(
      `INSERT INTO payment_channels
         (id, senderKey, receiverKey, capacity, balance, sequence, status, signatures, metadata, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, 0, 'open', '[]', ?, ?, ?)`,
      [id, senderKey, receiverKey, capacity, metadata ? JSON.stringify(metadata) : null, now, now]
    );

    log.info('CHANNEL', 'Payment channel opened', { id, senderKey, receiverKey, capacity, fundingTxId });

    return this.getChannel(id);
  }

  // ─── Get ───────────────────────────────────────────────────────────────────

  /**
   * Retrieve a channel by ID.
   * @param {string} id - Channel UUID
   * @returns {Promise<object>} Channel record
   * @throws {NotFoundError} If channel does not exist
   */
  async getChannel(id) {
    const row = await Database.get('SELECT * FROM payment_channels WHERE id = ?', [id]);
    const channel = parseRow(row);
    if (!channel) throw new NotFoundError(`Channel ${id} not found`);
    return channel;
  }

  /**
   * List all channels, optionally filtered by status.
   * @param {string} [status] - Filter by status ('open', 'settled', 'disputed', 'closed')
   * @returns {Promise<object[]>}
   */
  async listChannels(status = null) {
    const rows = status
      ? await Database.all('SELECT * FROM payment_channels WHERE status = ? ORDER BY createdAt DESC', [status])
      : await Database.all('SELECT * FROM payment_channels ORDER BY createdAt DESC', []);
    return rows.map(parseRow);
  }

  // ─── Update (off-chain) ────────────────────────────────────────────────────

  /**
   * Apply a signed off-chain state update to the channel.
   * Both the sender's and receiver's signatures are required to advance state.
   * No Stellar network call is made — this is purely off-chain.
   *
   * @param {object} params
   * @param {string} params.channelId       - Channel UUID
   * @param {number} params.amount          - Incremental amount to transfer (added to balance)
   * @param {string} params.senderSecret    - Sender's secret key (used to verify their signature)
   * @param {string} params.receiverSecret  - Receiver's secret key (used to verify their signature)
   * @param {string} params.senderSig       - Sender's signature over the new state
   * @param {string} params.receiverSig     - Receiver's signature over the new state
   * @returns {Promise<object>} Updated channel record
   */
  async updateChannel({ channelId, amount, senderSecret, receiverSecret, senderSig, receiverSig }) {
    if (!channelId) throw new ValidationError('channelId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    if (typeof amount !== 'number' || amount <= 0) {
      throw new ValidationError('amount must be a positive number', null, ERROR_CODES.INVALID_REQUEST);
    }

    const channel = await this.getChannel(channelId);

    if (channel.status !== 'open') {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Channel is ${channel.status}, only open channels can be updated`
      );
    }

    const newSequence = channel.sequence + 1;
    const newBalance = channel.balance + amount;

    if (newBalance > channel.capacity) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Update would exceed channel capacity of ${channel.capacity} XLM`
      );
    }

    const message = buildStateMessage(channelId, newSequence, newBalance);

    if (!verifyStateSignature(message, senderSig, senderSecret)) {
      throw new ValidationError('Invalid sender signature', null, ERROR_CODES.UNAUTHORIZED);
    }
    if (!verifyStateSignature(message, receiverSig, receiverSecret)) {
      throw new ValidationError('Invalid receiver signature', null, ERROR_CODES.UNAUTHORIZED);
    }

    const signatures = [
      ...channel.signatures,
      { sequence: newSequence, senderSig, receiverSig, timestamp: new Date().toISOString() },
    ];

    await Database.run(
      `UPDATE payment_channels
          SET balance = ?, sequence = ?, signatures = ?, updatedAt = ?
        WHERE id = ?`,
      [newBalance, newSequence, JSON.stringify(signatures), new Date().toISOString(), channelId]
    );

    log.info('CHANNEL', 'Off-chain state updated', { channelId, newSequence, newBalance });

    return this.getChannel(channelId);
  }

  // ─── Settle (on-chain) ────────────────────────────────────────────────────

  /**
   * Settle the channel by submitting the latest agreed state on-chain.
   * Calls stellarService.sendPayment to distribute the accumulated balance,
   * then marks the channel as 'settled'.
   *
   * @param {object} params
   * @param {string} params.channelId    - Channel UUID
   * @param {string} params.senderSecret - Sender's secret key (funds the on-chain payment)
   * @returns {Promise<object>} Settled channel record with stellarTxId
   */
  async settleChannel({ channelId, senderSecret }) {
    if (!channelId) throw new ValidationError('channelId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    if (!senderSecret) throw new ValidationError('senderSecret is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);

    const channel = await this.getChannel(channelId);

    if (!['open', 'disputed'].includes(channel.status)) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Channel is already ${channel.status}`
      );
    }

    let stellarTxId = null;

    if (channel.balance > 0) {
      const result = await this.stellarService.sendPayment(
        channel.senderKey,
        channel.receiverKey,
        String(channel.balance),
        `channel-settle:${channelId}`
      );
      stellarTxId = result.transactionId || result.hash || null;
    }

    const now = new Date().toISOString();
    await Database.run(
      `UPDATE payment_channels
          SET status = 'settled', settledAt = ?, updatedAt = ?, metadata = json_patch(COALESCE(metadata, '{}'), ?)
        WHERE id = ?`,
      [now, now, JSON.stringify({ stellarTxId }), channelId]
    );

    log.info('CHANNEL', 'Channel settled on-chain', { channelId, balance: channel.balance, stellarTxId });

    return this.getChannel(channelId);
  }

  // ─── Dispute ──────────────────────────────────────────────────────────────

  /**
   * Raise a dispute on a channel by presenting a higher-sequence signed state.
   * Used when one party attempts to settle with an outdated state.
   * The dispute must be raised within DISPUTE_WINDOW_MS of the channel's last update.
   *
   * @param {object} params
   * @param {string} params.channelId  - Channel UUID
   * @param {number} params.sequence   - Sequence number of the disputed (higher) state
   * @param {number} params.balance    - Balance at the disputed sequence
   * @param {string} params.senderSig  - Sender's signature over the disputed state
   * @param {string} params.receiverSig - Receiver's signature over the disputed state
   * @param {string} params.senderSecret   - Sender's secret (to verify sig)
   * @param {string} params.receiverSecret - Receiver's secret (to verify sig)
   * @returns {Promise<object>} Updated channel record with status 'disputed'
   */
  async disputeChannel({ channelId, sequence, balance, senderSig, receiverSig, senderSecret, receiverSecret }) {
    if (!channelId) throw new ValidationError('channelId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);

    const channel = await this.getChannel(channelId);

    if (!['open', 'settled'].includes(channel.status)) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Cannot dispute a channel with status '${channel.status}'`
      );
    }

    // Dispute must present a strictly higher sequence than the current on-chain state
    if (sequence <= channel.sequence) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        `Dispute sequence ${sequence} must be greater than current sequence ${channel.sequence}`
      );
    }

    // Check dispute window
    const lastUpdate = new Date(channel.updatedAt).getTime();
    if (Date.now() - lastUpdate > DISPUTE_WINDOW_MS) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Dispute window has expired'
      );
    }

    const message = buildStateMessage(channelId, sequence, balance);

    if (!verifyStateSignature(message, senderSig, senderSecret)) {
      throw new ValidationError('Invalid sender signature for disputed state', null, ERROR_CODES.UNAUTHORIZED);
    }
    if (!verifyStateSignature(message, receiverSig, receiverSecret)) {
      throw new ValidationError('Invalid receiver signature for disputed state', null, ERROR_CODES.UNAUTHORIZED);
    }

    const now = new Date().toISOString();
    await Database.run(
      `UPDATE payment_channels
          SET status = 'disputed', disputedAt = ?, disputeSeq = ?, balance = ?, sequence = ?, updatedAt = ?
        WHERE id = ?`,
      [now, sequence, balance, sequence, now, channelId]
    );

    log.info('CHANNEL', 'Channel disputed', { channelId, sequence, balance });

    return this.getChannel(channelId);
  }

  // ─── Close (force / timeout) ──────────────────────────────────────────────

  /**
   * Force-close a channel that has exceeded the inactivity timeout.
   * Any accumulated balance is settled on-chain before closing.
   *
   * @param {object} params
   * @param {string} params.channelId    - Channel UUID
   * @param {string} params.senderSecret - Sender's secret key
   * @returns {Promise<object>} Closed channel record
   */
  async closeChannel({ channelId, senderSecret }) {
    if (!channelId) throw new ValidationError('channelId is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    if (!senderSecret) throw new ValidationError('senderSecret is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);

    const channel = await this.getChannel(channelId);

    if (channel.status === 'closed') {
      throw new BusinessLogicError(ERROR_CODES.TRANSACTION_FAILED, 'Channel is already closed');
    }

    const lastUpdate = new Date(channel.updatedAt).getTime();
    const timedOut = Date.now() - lastUpdate > CHANNEL_TIMEOUT_MS;

    if (channel.status === 'open' && !timedOut) {
      throw new BusinessLogicError(
        ERROR_CODES.TRANSACTION_FAILED,
        'Channel has not timed out yet. Use settleChannel to close an active channel.'
      );
    }

    // Settle any remaining balance on-chain
    if (channel.balance > 0) {
      await this.stellarService.sendPayment(
        channel.senderKey,
        channel.receiverKey,
        String(channel.balance),
        `channel-close:${channelId}`
      );
    }

    const now = new Date().toISOString();
    await Database.run(
      `UPDATE payment_channels SET status = 'closed', closedAt = ?, updatedAt = ? WHERE id = ?`,
      [now, now, channelId]
    );

    log.info('CHANNEL', 'Channel force-closed', { channelId });

    return this.getChannel(channelId);
  }
}

module.exports = { PaymentChannelService, signState, verifyStateSignature, buildStateMessage, DISPUTE_WINDOW_MS, CHANNEL_TIMEOUT_MS };
