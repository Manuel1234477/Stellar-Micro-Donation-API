/**
 * WebhookService - Webhook Registration and Delivery
 *
 * RESPONSIBILITY: Register webhook endpoints, deliver signed payloads,
 *                 retry failed deliveries with exponential backoff, and
 *                 auto-disable webhooks after 5 consecutive failures.
 */

const crypto = require('crypto');
const https = require('https');
const http = require('http');
const Database = require('../utils/database');
const log = require('../utils/log');
const { 
  getCorrelationContext, 
  withAsyncContext, 
  generateCorrelationHeaders 
} = require('../utils/correlation');

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s, 8s, 16s
const MAX_CONSECUTIVE_FAILURES = 5;
const DELIVERY_TIMEOUT_MS = 5000;

class WebhookService {
  /**
   * Create the webhooks table if it doesn't exist.
   */
  static async initTable() {
    await Database.run(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        events TEXT NOT NULL,
        secret TEXT NOT NULL,
        api_key_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER NOT NULL DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  /**
   * Register a new webhook.
   * @param {object} params
   * @param {string} params.url - HTTPS URL to deliver events to
   * @param {string[]} params.events - Event types e.g. ['transaction.confirmed']
   * @param {string} [params.secret] - HMAC secret; auto-generated if omitted
   * @param {string} [params.apiKeyId]
   * @returns {Promise<object>} Created webhook record
   */
  static async register({ url, events, secret, apiKeyId }) {
    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      throw Object.assign(new Error('url and events[] are required'), { status: 400 });
    }

    try { new URL(url); } catch {
      throw Object.assign(new Error('Invalid webhook URL'), { status: 400 });
    }

    const webhookSecret = secret || crypto.randomBytes(32).toString('hex');
    const eventsJson = JSON.stringify(events);

    const result = await Database.run(
      `INSERT INTO webhooks (url, events, secret, api_key_id) VALUES (?, ?, ?, ?)`,
      [url, eventsJson, webhookSecret, apiKeyId || null]
    );

    return {
      id: result.id,
      url,
      events,
      secret: webhookSecret,
      apiKeyId: apiKeyId || null,
      isActive: true,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * List all active webhooks.
   * @returns {Promise<object[]>}
   */
  static async list() {
    const rows = await Database.query(
      `SELECT id, url, events, api_key_id, created_at, is_active FROM webhooks ORDER BY created_at DESC`
    );
    return rows.map(r => ({
      id: r.id,
      url: r.url,
      events: JSON.parse(r.events),
      apiKeyId: r.api_key_id,
      createdAt: r.created_at,
      isActive: Boolean(r.is_active),
    }));
  }

  /**
   * Delete (hard-delete) a webhook by ID.
   * @param {number} id
   */
  static async remove(id) {
    const result = await Database.run(`DELETE FROM webhooks WHERE id = ?`, [id]);
    if (result.changes === 0) {
      throw Object.assign(new Error('Webhook not found'), { status: 404 });
    }
  }

  /**
   * Deliver an event to all active webhooks subscribed to it.
   * Fires-and-forgets retries; does not block the caller.
   * Propagates correlation context through async operations.
   * @param {string} event - Event type e.g. 'transaction.confirmed'
   * @param {object} payload - Event data
   */
  static async deliver(event, payload) {
    let webhooks;
    try {
      webhooks = await Database.query(
        `SELECT * FROM webhooks WHERE is_active = 1`
      );
    } catch (err) {
      log.error('WEBHOOK', 'Failed to query webhooks', { error: err.message });
      return;
    }

    const interested = webhooks.filter(w => {
      try {
        const events = JSON.parse(w.events);
        return events.includes(event) || events.includes('*');
      } catch { return false; }
    });

    // Capture correlation context from current request
    const parentContext = getCorrelationContext();

    for (const webhook of interested) {
      // Fire-and-forget with retry, propagating correlation context through async boundaries
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
   * Maintains correlation context across retry attempts.
   * @private
   */
  static async _deliverWithRetry(webhook, event, payload, attempt) {
    const correlationHeaders = generateCorrelationHeaders();
    const body = JSON.stringify({ 
      event, 
      data: payload, 
      timestamp: new Date().toISOString(),
      // Include correlation context in payload for traceability
      correlationContext: {
        correlationId: correlationHeaders['X-Correlation-ID'],
        traceId: correlationHeaders['X-Trace-ID'],
        operationId: correlationHeaders['X-Operation-ID']
      }
    });
    const signature = this._sign(body, webhook.secret);

    try {
      await this._httpPost(webhook.url, body, signature, correlationHeaders);
      // Reset failure counter on success
      await Database.run(
        `UPDATE webhooks SET consecutive_failures = 0 WHERE id = ?`,
        [webhook.id]
      ).catch(() => {});
      log.debug('WEBHOOK', 'Delivered', { 
        id: webhook.id, 
        event, 
        attempt,
        ...correlationHeaders
      });
    } catch (err) {
      const failures = (webhook.consecutive_failures || 0) + 1;
      log.warn('WEBHOOK', 'Delivery failed', { 
        id: webhook.id, 
        event, 
        attempt, 
        error: err.message,
        ...correlationHeaders
      });

      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        await Database.run(
          `UPDATE webhooks SET is_active = 0, consecutive_failures = ? WHERE id = ?`,
          [failures, webhook.id]
        ).catch(() => {});
        log.warn('WEBHOOK', 'Webhook auto-disabled after consecutive failures', { 
          id: webhook.id,
          ...correlationHeaders
        });
        return;
      }

      await Database.run(
        `UPDATE webhooks SET consecutive_failures = ? WHERE id = ?`,
        [failures, webhook.id]
      ).catch(() => {});

      // Update local copy for next retry check
      webhook.consecutive_failures = failures;

      if (attempt < MAX_RETRIES - 1) {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        return this._deliverWithRetry(webhook, event, payload, attempt + 1);
      }
    }
  }

  /**
   * Compute HMAC-SHA256 signature for a payload.
   * @param {string} body - Raw JSON string
   * @param {string} secret - Webhook secret
   * @returns {string} hex digest
   */
  static _sign(body, secret) {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  /**
   * POST a JSON body to a URL with a timeout.
   * Includes correlation headers for traceability.
   * @private
   */
  static _httpPost(url, body, signature, correlationHeaders = {}) {
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
          'X-Webhook-Signature': `sha256=${signature}`,
          ...correlationHeaders,
        },
        timeout: DELIVERY_TIMEOUT_MS,
      };

      const req = lib.request(options, (res) => {
        // Drain response body
        res.resume();
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.statusCode);
          } else {
            reject(new Error(`HTTP ${res.statusCode}`));
          }
        });
      });

      req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = WebhookService;
