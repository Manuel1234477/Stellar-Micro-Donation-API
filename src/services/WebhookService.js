/**
 * Webhook Service - Notification Layer
 *
 * RESPONSIBILITY: Sends HTTP webhook notifications for events, with persistent
 *                 retry queue and dead-letter store for failed deliveries.
 * OWNER: Backend Team
 * DEPENDENCIES: https (Node built-in), log utility, database
 */

'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const log = require('../utils/log');

const MAX_RETRIES = 3;
const MAX_CONSECUTIVE_FAILURES = 5;
const BASE_BACKOFF_MS = 1000;
const { 
  getCorrelationContext, 
  withAsyncContext, 
  generateCorrelationHeaders 
} = require('../utils/correlation');
const { withSpan, injectTraceHeaders } = require('../utils/tracing');

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

/** Retry queue constants */
const RETRY_DELAYS_MS = [
  60 * 1000,        // 1 minute
  5 * 60 * 1000,    // 5 minutes
  30 * 60 * 1000,   // 30 minutes
  2 * 60 * 60 * 1000,  // 2 hours
  24 * 60 * 60 * 1000  // 24 hours
];
const RETRY_MAX_ATTEMPTS = 5;

class WebhookService {
  /**
   * Create the webhooks, webhook_retries, and webhook_dead_letters tables if absent.
   * @returns {Promise<void>}
   */
  static async initTable() {
    const Database = require('../utils/database');
    await Database.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT,
        api_key_id INTEGER,
        is_active INTEGER NOT NULL DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        owner_email TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await Database.run(`
      CREATE TABLE IF NOT EXISTS webhook_retries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        next_retry_at DATETIME NOT NULL,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await Database.run(`
      CREATE TABLE IF NOT EXISTS webhook_dead_letters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await Database.run(`
      CREATE TABLE IF NOT EXISTS webhook_delivery_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        event TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL,
        status_code INTEGER,
        error_message TEXT,
        delivered_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * Register a new webhook endpoint.
   * @param {Object} params
   * @param {string} params.url
   * @param {string[]} params.events
   * @param {string} [params.secret]
   * @param {number|null} [params.apiKeyId]
   * @param {string} [params.ownerEmail]
   * @returns {Promise<Object>}
   */
  async register({ url, events, secret, apiKeyId = null, ownerEmail = null }) {
    if (!url) { const e = new Error('url is required'); e.status = 400; throw e; }
    if (!events || events.length === 0) { const e = new Error('events must be a non-empty array'); e.status = 400; throw e; }
    try { new URL(url); } catch { const e = new Error('Invalid webhook URL'); e.status = 400; throw e; }

    const resolvedSecret = secret || crypto.randomBytes(20).toString('hex');
    const eventsStr = JSON.stringify(events);

    const Database = require('../utils/database');
    const result = await Database.run(
      `INSERT INTO webhooks (url, events, secret, api_key_id, owner_email) VALUES (?, ?, ?, ?, ?)`,
      [url, eventsStr, resolvedSecret, apiKeyId, ownerEmail]
    );
    return { id: result.id, url, events, secret: resolvedSecret, isActive: true, ownerEmail };
  }

  /**
   * List all active webhooks (secrets omitted).
   * @returns {Promise<Object[]>}
   */
  async list() {
    const Database = require('../utils/database');
    const rows = await Database.all(`SELECT id, url, events, is_active, created_at FROM webhooks WHERE is_active = 1`);
    return rows.map(r => ({
      id: r.id,
      url: r.url,
      events: (() => { try { return JSON.parse(r.events); } catch { return r.events; } })(),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    }));
  }

  /**
   * Remove a webhook by ID.
   * @param {number} id
   * @returns {Promise<void>}
   */
  async remove(id) {
    const Database = require('../utils/database');
    const result = await Database.run(`DELETE FROM webhooks WHERE id = ?`, [id]);
    if (!result || result.changes === 0) {
      const e = new Error(`Webhook ${id} not found`); e.status = 404; throw e;
    }
  }

  /**
   * Schedule a retry for a failed webhook delivery.
   * Uses fixed delays: 1min, 5min, 30min, 2hr, 24hr
   * Promotes to dead-letter when max attempts (5) exceeded.
   * Notifies webhook owner after final failure.
   *
   * @param {Object} params
   * @param {number} params.webhookId
   * @param {string} params.event
   * @param {Object} params.payload
   * @param {number} [params.attempt=0]
   * @param {string} [params.lastError]
   * @returns {Promise<void>}
   */
  static async scheduleRetry({ webhookId, event, payload, attempt = 0, lastError = null }) {
    const Database = require('../utils/database');

    // Log delivery attempt
    await Database.run(
      `INSERT INTO webhook_delivery_history (webhook_id, event, payload, attempt, status, error_message)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [webhookId, event, JSON.stringify(payload), attempt + 1, 'failed', lastError]
    );

    if (attempt >= RETRY_MAX_ATTEMPTS) {
      await Database.run(
        `INSERT INTO webhook_dead_letters (webhook_id, event, payload, attempts, last_error)
         VALUES (?, ?, ?, ?, ?)`,
        [webhookId, event, JSON.stringify(payload), attempt, lastError]
      );
      log.warn('WEBHOOK_SERVICE', 'Delivery moved to dead-letter', { webhookId, event, attempt });
      
      // Notify webhook owner
      const webhook = await Database.get(`SELECT * FROM webhooks WHERE id = ?`, [webhookId]);
      if (webhook && webhook.owner_email) {
        await WebhookService._notifyOwnerOfFailure(webhook, event, attempt, lastError);
      }
      
      return;
    }

    const delayMs = RETRY_DELAYS_MS[attempt];
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString();

    await Database.run(
      `INSERT INTO webhook_retries (webhook_id, event, payload, attempt, next_retry_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [webhookId, event, JSON.stringify(payload), attempt, nextRetryAt, lastError]
    );
    log.info('WEBHOOK_SERVICE', 'Retry scheduled', { webhookId, event, attempt, nextRetryAt });
  }

  /**
   * Process all due retry entries. Called by the scheduler every 60 s.
   * @returns {Promise<{ processed: number, succeeded: number, failed: number }>}
   */
  static async processRetryQueue() {
    const Database = require('../utils/database');
    const now = new Date().toISOString();

    const due = await Database.all(
      `SELECT * FROM webhook_retries WHERE next_retry_at <= ? ORDER BY next_retry_at ASC`,
      [now]
    );

    let succeeded = 0;
    let failed = 0;

    for (const entry of due) {
      // Remove from queue before attempting (re-inserted on failure)
      await Database.run(`DELETE FROM webhook_retries WHERE id = ?`, [entry.id]);

      const webhook = await Database.get(`SELECT * FROM webhooks WHERE id = ?`, [entry.webhook_id]);
      if (!webhook || !webhook.is_active) continue;

      const payload = (() => { try { return JSON.parse(entry.payload); } catch { return {}; } })();

      try {
        await WebhookService._deliverWithRetry(webhook, entry.event, payload, 0);
        succeeded++;
      } catch (err) {
        failed++;
        await WebhookService.scheduleRetry({
          webhookId: entry.webhook_id,
          event: entry.event,
          payload,
          attempt: entry.attempt + 1,
          lastError: err.message,
        });
      }
    }

    return { processed: due.length, succeeded, failed };
  }

  /**
   * List dead-letter entries with optional pagination.
   * @param {{ limit?: number, offset?: number }} [opts]
   * @returns {Promise<Object[]>}
   */
  static async listDeadLetters({ limit = 50, offset = 0 } = {}) {
    const Database = require('../utils/database');
    const rows = await Database.all(
      `SELECT * FROM webhook_dead_letters ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows.map(r => ({
      id: r.id,
      webhookId: r.webhook_id,
      event: r.event,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })(),
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
    }));
  }

  /**
   * Replay a dead-letter entry by re-scheduling it as a fresh retry.
   * @param {number} deadLetterId
   * @returns {Promise<void>}
   */
  static async replayDeadLetter(deadLetterId) {
    const Database = require('../utils/database');
    const entry = await Database.get(`SELECT * FROM webhook_dead_letters WHERE id = ?`, [deadLetterId]);
    if (!entry) {
      const e = new Error(`Dead-letter entry ${deadLetterId} not found`); e.status = 404; throw e;
    }

    const payload = (() => { try { return JSON.parse(entry.payload); } catch { return {}; } })();
    await WebhookService.scheduleRetry({ webhookId: entry.webhook_id, event: entry.event, payload, attempt: 0 });
    await Database.run(`DELETE FROM webhook_dead_letters WHERE id = ?`, [deadLetterId]);
  }

  /**
   * Get delivery history for a specific webhook.
   * @param {number} webhookId
   * @param {Object} options
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<Object[]>}
   */
  static async getDeliveryHistory(webhookId, { limit = 50, offset = 0 } = {}) {
    const Database = require('../utils/database');
    const rows = await Database.all(
      `SELECT * FROM webhook_delivery_history 
       WHERE webhook_id = ? 
       ORDER BY delivered_at DESC 
       LIMIT ? OFFSET ?`,
      [webhookId, limit, offset]
    );
    return rows.map(r => ({
      id: r.id,
      webhookId: r.webhook_id,
      event: r.event,
      payload: (() => { try { return JSON.parse(r.payload); } catch { return r.payload; } })(),
      attempt: r.attempt,
      status: r.status,
      statusCode: r.status_code,
      errorMessage: r.error_message,
      deliveredAt: r.delivered_at,
    }));
  }

  /**
   * Notify webhook owner of repeated failures.
   * @private
   * @param {Object} webhook
   * @param {string} event
   * @param {number} attempts
   * @param {string} lastError
   * @returns {Promise<void>}
   */
  static async _notifyOwnerOfFailure(webhook, event, attempts, lastError) {
    log.warn('WEBHOOK_SERVICE', 'Notifying owner of webhook failure', {
      webhookId: webhook.id,
      ownerEmail: webhook.owner_email,
      event,
      attempts
    });

    // In a real implementation, this would send an email
    // For now, we just log it
    // TODO: Integrate with email service
    const notification = {
      to: webhook.owner_email,
      subject: `Webhook Delivery Failed: ${webhook.url}`,
      body: `Your webhook (ID: ${webhook.id}) at ${webhook.url} has failed after ${attempts} attempts.\n\nEvent: ${event}\nLast Error: ${lastError}\n\nPlease check your endpoint and consider updating the webhook configuration.`
    };

    log.info('WEBHOOK_SERVICE', 'Owner notification prepared', notification);
  }

  /**
   * Send a failure notification to a single webhook URL.
   *
   * @param {string} webhookUrl - Target URL (http or https)
   * @param {Object} payload - Notification payload
   * @returns {Promise<{delivered: boolean, statusCode?: number, error?: string}>}
   */
  async sendFailureNotification(webhookUrl, payload) {
    if (!webhookUrl) {
      return { delivered: false, error: 'No webhook URL configured' };
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      log.warn('WEBHOOK_SERVICE', 'Invalid webhook URL', { webhookUrl });
      return { delivered: false, error: 'Invalid webhook URL' };
    }

    const body = JSON.stringify({
      event: 'recurring_donation.persistent_failure',
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    });

    return new Promise((resolve) => {
      const transport = parsedUrl.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Stella-Donation-API/1.0',
          'X-Stella-Event': 'recurring_donation.persistent_failure',
        },
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        res.resume();
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ delivered, statusCode: res.statusCode });
      });

      req.on('timeout', () => { req.destroy(); resolve({ delivered: false, error: 'Request timed out' }); });
      req.on('error', (err) => { resolve({ delivered: false, error: err.message }); });
      req.write(body);
      req.end();
    });
  }

  /**
   * Deliver an event to all active webhooks subscribed to it.
   * Fires-and-forgets retries; does not block the caller.
   * @param {string} event - Event type e.g. 'transaction.confirmed'
   * @param {object} payload - Event data
   */
  async deliver(event, payload) {
    // Capture correlation context from current request
    const parentContext = getCorrelationContext();
    let interested = [];
    try {
      const Database = require('../utils/database');
      interested = await Database.query(
        `SELECT * FROM webhooks WHERE is_active = 1 AND (events IS NULL OR events LIKE ?)`,
        [`%${event}%`]
      );
    } catch {
      // webhooks table may not exist in all environments
    }

    for (const webhook of interested) {
      withAsyncContext('webhook_delivery', async () => {
        await this._deliverWithRetry(webhook, event, payload, 0);
      }, {
        webhookId: webhook.id,
        event,
        parentRequestId: parentContext.requestId
      }).catch(() => {});
    }
  }

  /**
   * Attempt delivery with exponential backoff retry.
   * @private
   */
  async _deliverWithRetry(webhook, event, payload, attempt) {
    const correlationHeaders = generateCorrelationHeaders();
    const body = JSON.stringify({
      event,
      data: payload,
      timestamp: new Date().toISOString(),
      correlationContext: {
        correlationId: correlationHeaders['X-Correlation-ID'],
        traceId: correlationHeaders['X-Trace-ID'],
        operationId: correlationHeaders['X-Operation-ID'],
      },
    });
    const signature = WebhookService._sign(body, webhook.secret || '');

    try {
      const result = await WebhookService._httpPost(webhook.url, body, signature, correlationHeaders);
      
      // Log successful delivery
      const Database = require('../utils/database');
      await Database.run(
        `INSERT INTO webhook_delivery_history (webhook_id, event, payload, attempt, status, status_code)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [webhook.id, event, JSON.stringify(payload), attempt + 1, 'success', result.statusCode]
      ).catch(() => {});
      
      await Database.run(
        `UPDATE webhooks SET consecutive_failures = 0 WHERE id = ?`,
        [webhook.id]
      ).catch(() => {});
      log.debug('WEBHOOK', 'Delivered', { id: webhook.id, event, attempt });
    } catch (err) {
      const failures = (webhook.consecutive_failures || 0) + 1;
      log.warn('WEBHOOK', 'Delivery failed', { id: webhook.id, event, attempt, error: err.message });

      const Database = require('../utils/database');
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        await Database.run(
          `UPDATE webhooks SET is_active = 0, consecutive_failures = ? WHERE id = ?`,
          [failures, webhook.id]
        ).catch(() => {});
        return;
      }

      await Database.run(
        `UPDATE webhooks SET consecutive_failures = ? WHERE id = ?`,
        [failures, webhook.id]
      ).catch(() => {});

      webhook.consecutive_failures = failures;

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        return WebhookService._deliverWithRetry(webhook, event, payload, attempt + 1);
      }
    }
  }

  /**
   * Compute HMAC-SHA256 signature for a payload.
   * @param {string} body
   * @param {string} secret
   * @returns {string}
   */
  _sign(body, secret) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  /**
   * POST a JSON body to a URL with a timeout.
   * @private
   */
  _httpPost(url, body, signature, correlationHeaders = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Stella-Donation-API/1.0',
          'X-Webhook-Signature': `sha256=${signature}`,
          ...correlationHeaders,
        },
        timeout: 10000,
      };

      const req = lib.request(options, (res) => {
        res.resume();
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ delivered, statusCode: res.statusCode });
      });

      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
  /**
   * Flush all pending webhook deliveries from the retry queue.
   * Attempts immediate delivery for any webhooks with pending retries.
   * @returns {Promise<void>}
   */
  async flushPending() {
    let pending;
    try {
      const Database = require('../utils/database');
      pending = await Database.all(
        `SELECT * FROM webhooks WHERE is_active = 1 AND consecutive_failures > 0`,
        []
      );
    } catch {
      return;
    }

    if (!pending || pending.length === 0) return;

    log.info('WEBHOOK_SERVICE', 'Flushing pending webhook deliveries', { count: pending.length });

    await Promise.allSettled(
      pending.map((webhook) =>
        WebhookService._deliverWithRetry(webhook, 'flush', { flushed: true }, 0).catch(() => {})
      )
    );

    log.info('WEBHOOK_SERVICE', 'Webhook flush complete');
  }
}

module.exports = new WebhookService();
module.exports.WebhookService = WebhookService;



