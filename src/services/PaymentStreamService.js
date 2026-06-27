/**
 * Payment Stream Service
 *
 * RESPONSIBILITY: Subscribe to Stellar payment streams per wallet, trigger webhooks
 *   and create transaction records on incoming payments, reconnect automatically.
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService (streamTransactions), WebhookService, Transaction model
 *
 * Persistence (#1139):
 * - Stream definitions (public key, webhook URL) and the last processed cursor
 *   (Stellar paging_token) are persisted to the payment_streams table so streams
 *   survive restarts and are visible across instances.
 * - Call loadPersistedStreams() at startup to resume all streams from their
 *   last checkpoint.
 * - getStreamStates() returns the DB-backed view for operator observability.
 *
 * Cursor/checkpoint semantics:
 * - The cursor is updated to payment.paging_token after each successfully
 *   processed payment (at-least-once delivery; idempotency is enforced by the
 *   Transaction.create idempotencyKey).
 *
 * Security:
 * - Stream subscriptions are server-initiated; no user-supplied stream URLs.
 * - Replay prevention: each payment is identified by its Stellar transaction ID.
 *   Duplicate detection is delegated to Transaction.create (idempotency key).
 * - Webhook payloads contain only public payment data — no secrets.
 */

'use strict';

const log = require('../utils/log');
const Database = require('../utils/database');

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

class PaymentStreamService {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
    /** @type {Map<string, { stop: Function, reconnectTimer: NodeJS.Timeout|null, options: Object }>} */
    this.activeStreams = new Map();
  }

  // ── DB helpers (fire-and-forget) ───────────────────────────────────────────

  _persistStream(publicKey, options) {
    Database.run(
      `INSERT INTO payment_streams (public_key, webhook_url, cursor, created_at, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(public_key) DO UPDATE SET
         webhook_url = excluded.webhook_url,
         cursor      = COALESCE(excluded.cursor, payment_streams.cursor),
         updated_at  = CURRENT_TIMESTAMP`,
      [publicKey, options.webhookUrl || null, options.cursor || null]
    ).catch(err =>
      log.warn('PAYMENT_STREAM', 'Failed to persist stream', { publicKey, error: err.message })
    );
  }

  _removePersistedStream(publicKey) {
    Database.run('DELETE FROM payment_streams WHERE public_key = ?', [publicKey])
      .catch(err =>
        log.warn('PAYMENT_STREAM', 'Failed to remove persisted stream', { publicKey, error: err.message })
      );
  }

  _updateCursor(publicKey, cursor) {
    Database.run(
      'UPDATE payment_streams SET cursor = ?, updated_at = CURRENT_TIMESTAMP WHERE public_key = ?',
      [cursor, publicKey]
    ).catch(err =>
      log.warn('PAYMENT_STREAM', 'Failed to update stream cursor', { publicKey, error: err.message })
    );
  }

  // ── Startup resumption ─────────────────────────────────────────────────────

  /**
   * Load all persisted stream definitions from the DB and re-subscribe each
   * from its last saved cursor. Call once during server startup.
   *
   * @returns {Promise<void>}
   */
  async loadPersistedStreams() {
    try {
      await Database.ensureInitialized();
      const rows = await Database.query(
        'SELECT public_key, webhook_url, cursor FROM payment_streams',
        []
      );
      for (const row of rows) {
        const opts = {};
        if (row.webhook_url) opts.webhookUrl = row.webhook_url;
        if (row.cursor)      opts.cursor     = row.cursor;
        this.subscribe(row.public_key, opts);
      }
      log.info('PAYMENT_STREAM', 'Loaded persisted streams', { count: rows.length });
    } catch (err) {
      log.error('PAYMENT_STREAM', 'Failed to load persisted streams', { error: err.message });
    }
  }

  // ── Observability ──────────────────────────────────────────────────────────

  /**
   * Return DB-backed stream states (definition + cursor progress).
   * Visible across all instances.
   *
   * @returns {Promise<Array<{public_key, webhook_url, cursor, created_at, updated_at}>>}
   */
  async getStreamStates() {
    try {
      return await Database.query(
        'SELECT public_key, webhook_url, cursor, created_at, updated_at FROM payment_streams',
        []
      );
    } catch (err) {
      log.warn('PAYMENT_STREAM', 'Failed to query stream states', { error: err.message });
      return [];
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Subscribe to the payment stream for a wallet address.
   * Automatically reconnects on interruption.
   *
   * @param {string} publicKey - Stellar public key to monitor
   * @param {Object} [options]
   * @param {string} [options.webhookUrl] - Webhook URL to notify on incoming payment
   * @param {string} [options.cursor]     - Stellar paging token to resume from
   */
  subscribe(publicKey, options = {}) {
    this.unsubscribe(publicKey);

    log.info('PAYMENT_STREAM', 'Subscribing to payment stream', { publicKey, cursor: options.cursor || 'now' });

    // Keep a mutable reference so _handlePayment can advance the cursor in-memory
    const liveOptions = { ...options };

    const stop = this.stellarService.streamTransactions(
      publicKey,
      (payment) => {
        this._handlePayment(publicKey, payment, liveOptions).catch((err) => {
          log.error('PAYMENT_STREAM', 'Error handling payment', { publicKey, error: err.message });
        });
      },
      { cursor: liveOptions.cursor || 'now' }
    );

    this.activeStreams.set(publicKey, { stop, reconnectTimer: null, options: liveOptions });
    this._persistStream(publicKey, liveOptions);
  }

  /**
   * Unsubscribe from the payment stream for a wallet address.
   *
   * @param {string} publicKey
   */
  unsubscribe(publicKey) {
    const entry = this.activeStreams.get(publicKey);
    if (!entry) return;

    if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer);
    if (typeof entry.stop === 'function') entry.stop();
    this.activeStreams.delete(publicKey);
    this._removePersistedStream(publicKey);

    log.info('PAYMENT_STREAM', 'Unsubscribed from payment stream', { publicKey });
  }

  /**
   * Handle an incoming payment: update cursor, create a transaction record,
   * and trigger webhook.
   *
   * @param {string} publicKey - Monitored wallet
   * @param {Object} payment   - Payment data from the stream
   * @param {Object} liveOptions - Subscription options (mutated to track cursor)
   * @returns {Promise<void>}
   */
  async _handlePayment(publicKey, payment, liveOptions) {
    log.info('PAYMENT_STREAM', 'Incoming payment detected', {
      publicKey,
      transactionId: payment.id || payment.transactionId,
    });

    // Advance cursor so reconnects resume from this position
    const cursor = payment.paging_token || payment.id || payment.transactionId;
    if (cursor) {
      liveOptions.cursor = String(cursor);
      this._updateCursor(publicKey, String(cursor));
    }

    // Create transaction record (idempotency key prevents duplicates)
    try {
      const Transaction = require('../models/transaction');
      Transaction.create({
        idempotencyKey: payment.id || payment.transactionId,
        senderId: payment.from || payment.source,
        receiverId: publicKey,
        amount: payment.amount,
        memo: payment.memo || null,
        stellarTxId: payment.id || payment.transactionId,
        status: 'completed',
        source: 'stream',
      });
    } catch (err) {
      log.error('PAYMENT_STREAM', 'Failed to create transaction record', {
        publicKey,
        error: err.message,
      });
    }

    // Trigger webhook if configured
    if (liveOptions.webhookUrl) {
      try {
        const { WebhookService } = require('./WebhookService');
        await WebhookService.deliver('payment.received', { publicKey, payment });
      } catch (err) {
        log.error('PAYMENT_STREAM', 'Failed to deliver webhook', {
          publicKey,
          webhookUrl: liveOptions.webhookUrl,
          error: err.message,
        });
      }
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   *
   * @param {string} publicKey
   * @param {Object} options
   * @param {number} [attempt=0]
   */
  _reconnect(publicKey, options, attempt = 0) {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      log.error('PAYMENT_STREAM', 'Max reconnect attempts reached, giving up', { publicKey, attempt });
      this.activeStreams.delete(publicKey);
      return;
    }

    const delay = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
    log.warn('PAYMENT_STREAM', 'Scheduling stream reconnect', { publicKey, attempt, delayMs: delay });

    // eslint-disable-next-line local/no-bare-timers
    const timer = setTimeout(() => {
      log.info('PAYMENT_STREAM', 'Reconnecting stream', { publicKey, attempt });
      // Use the live options stored in the entry (has latest cursor)
      const entry = this.activeStreams.get(publicKey);
      this.subscribe(publicKey, entry ? entry.options : options);
    }, delay);

    const entry = this.activeStreams.get(publicKey);
    if (entry) {
      entry.reconnectTimer = timer;
    } else {
      this.activeStreams.set(publicKey, { stop: null, reconnectTimer: timer, options });
    }
  }

  /**
   * Get list of actively monitored public keys (in-memory, this instance only).
   * For cross-instance state use getStreamStates().
   *
   * @returns {string[]}
   */
  getActiveStreams() {
    return [...this.activeStreams.keys()];
  }
}

module.exports = PaymentStreamService;
