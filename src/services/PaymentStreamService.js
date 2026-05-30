/**
 * Payment Stream Service
 *
 * RESPONSIBILITY: Subscribe to Stellar payment streams per wallet, trigger webhooks
 *   and create transaction records on incoming payments, reconnect automatically.
 * OWNER: Backend Team
 * DEPENDENCIES: StellarService (streamTransactions), WebhookService, Transaction model
 *
 * Security:
 * - Stream subscriptions are server-initiated; no user-supplied stream URLs.
 * - Replay prevention: each payment is identified by its Stellar transaction ID.
 *   Duplicate detection is delegated to Transaction.create (idempotency key).
 * - Webhook payloads contain only public payment data — no secrets.
 */

'use strict';

const log = require('../utils/log');

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

class PaymentStreamService {
  /**
   * @param {Object} stellarService - StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    this.stellarService = stellarService;
    /** @type {Map<string, { stop: Function, reconnectTimer: NodeJS.Timeout|null }>} */
    this.activeStreams = new Map();
  }

  /**
   * Subscribe to the payment stream for a wallet address.
   * Automatically reconnects on interruption.
   *
   * @param {string} publicKey - Stellar public key to monitor
   * @param {Object} [options]
   * @param {string} [options.webhookUrl] - Webhook URL to notify on incoming payment
   */
  subscribe(publicKey, options = {}) {
    // Clean up any existing subscription first
    this.unsubscribe(publicKey);

    log.info('PAYMENT_STREAM', 'Subscribing to payment stream', { publicKey });

    const stop = this.stellarService.streamTransactions(publicKey, (payment) => {
      this._handlePayment(publicKey, payment, options).catch((err) => {
        log.error('PAYMENT_STREAM', 'Error handling payment', { publicKey, error: err.message });
      });
    });

    this.activeStreams.set(publicKey, { stop, reconnectTimer: null });
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

    log.info('PAYMENT_STREAM', 'Unsubscribed from payment stream', { publicKey });
  }

  /**
   * Handle an incoming payment: create a transaction record and trigger webhook.
   *
   * @param {string} publicKey - Monitored wallet
   * @param {Object} payment - Payment data from the stream
   * @param {Object} options - Subscription options
   * @returns {Promise<void>}
   */
  async _handlePayment(publicKey, payment, options) {
    log.info('PAYMENT_STREAM', 'Incoming payment detected', {
      publicKey,
      transactionId: payment.id || payment.transactionId,
    });

    // Create transaction record immediately (no reconciliation wait)
    try {
      const Transaction = require('../routes/models/transaction');
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
    if (options.webhookUrl) {
      try {
        const { WebhookService } = require('./WebhookService');
        await WebhookService.deliver('payment.received', { publicKey, payment });
      } catch (err) {
        log.error('PAYMENT_STREAM', 'Failed to deliver webhook', {
          publicKey,
          webhookUrl: options.webhookUrl,
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

    const timer = setTimeout(() => {
      log.info('PAYMENT_STREAM', 'Reconnecting stream', { publicKey, attempt });
      this.subscribe(publicKey, options);
    }, delay);

    // Store timer so unsubscribe can cancel it
    const entry = this.activeStreams.get(publicKey);
    if (entry) {
      entry.reconnectTimer = timer;
    } else {
      this.activeStreams.set(publicKey, { stop: null, reconnectTimer: timer });
    }
  }

  /**
   * Get list of actively monitored public keys.
   * @returns {string[]}
   */
  getActiveStreams() {
    return [...this.activeStreams.keys()];
  }
}

module.exports = PaymentStreamService;
