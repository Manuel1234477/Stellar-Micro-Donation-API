/**
 * Webhook Service - Notification Layer
 *
 * RESPONSIBILITY: Sends HTTP webhook notifications for events
 * OWNER: Backend Team
 * DEPENDENCIES: https (Node built-in), log utility, database
 */

'use strict';

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const log = require('../utils/log');
const {
  getCorrelationContext,
  withAsyncContext,
  generateCorrelationHeaders,
} = require('../utils/correlation');
const { withSpan, injectTraceHeaders } = require('../utils/tracing');

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const MAX_CONSECUTIVE_FAILURES = 5;

class WebhookService {
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
      // Inject W3C traceparent for distributed tracing (issue #632)
      const outboundHeaders = injectTraceHeaders({
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Stellar-Donation-API/1.0',
      });
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: outboundHeaders,
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        res.resume();
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        log.info('WEBHOOK_SERVICE', 'Webhook delivered', {
          statusCode: res.statusCode,
          delivered,
        });
        resolve({ delivered, statusCode: res.statusCode });
      });

      req.on('timeout', () => {
        req.destroy();
        log.warn('WEBHOOK_SERVICE', 'Webhook request timed out', { webhookUrl });
        resolve({ delivered: false, error: 'Request timed out' });
      });

      req.on('error', (err) => {
        log.warn('WEBHOOK_SERVICE', 'Webhook request failed', {
          webhookUrl,
          error: err.message,
        });
        resolve({ delivered: false, error: err.message });
      });

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
  static async deliver(event, payload) {
    let webhooks;
    try {
      const Database = require('../utils/database');
      webhooks = await Database.all(
        `SELECT * FROM webhooks WHERE is_active = 1 AND (events IS NULL OR events LIKE ?)`,
        [`%${event}%`]
      );
    } catch {
      return;
    }

    if (!webhooks || webhooks.length === 0) return;

    const interested = webhooks.filter(
      (w) => !w.events || w.events.includes(event)
    );

    const parentContext = getCorrelationContext();

    for (const webhook of interested) {
      withAsyncContext(
        'webhook_delivery',
        async () => {
          await WebhookService._deliverWithRetry(webhook, event, payload, 0);
        },
        {
          webhookId: webhook.id,
          event,
          parentRequestId: parentContext.requestId,
        }
      ).catch(() => {});
    }
  }

  /**
   * Attempt delivery with exponential backoff retry.
   * @private
   */
  static async _deliverWithRetry(webhook, event, payload, attempt) {
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
      await WebhookService._httpPost(webhook.url, body, signature, correlationHeaders);
      const Database = require('../utils/database');
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
   * @param {string} body - Raw JSON string
   * @param {string} secret - Webhook secret
   * @returns {string} hex digest
   */
  static _sign(body, secret) {
    return crypto.createHmac('sha256', secret || '').update(body).digest('hex');
  }

  /**
   * POST a JSON body to a URL with a timeout.
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
          'User-Agent': 'Stellar-Donation-API/1.0',
          'X-Webhook-Signature': `sha256=${signature}`,
          ...correlationHeaders,
        },
        timeout: 10000,
      };

      const req = lib.request(options, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode });
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out'));
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = new WebhookService();
module.exports.WebhookService = WebhookService;
