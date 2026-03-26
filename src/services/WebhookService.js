/**
 * Webhook Service - Notification Layer
 *
 * RESPONSIBILITY: Sends HTTP webhook notifications for persistent recurring donation failures
 * OWNER: Backend Team
 * DEPENDENCIES: https (Node built-in), log utility
 *
 * Delivers POST payloads to user-configured webhook URLs when a recurring donation
 * exhausts all retry attempts. Failures to deliver the webhook are logged but do
 * not affect the donation schedule state.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const log = require('../utils/log');
const { 
  getCorrelationContext, 
  withAsyncContext, 
  generateCorrelationHeaders 
} = require('../utils/correlation');

class WebhookService {
  /**
   * Send a failure notification to the configured webhook URL.
   *
   * @param {string} webhookUrl - Target URL (http or https)
   * @param {Object} payload - Notification payload
   * @param {number} payload.scheduleId - Recurring donation schedule ID
   * @param {string} payload.donorPublicKey - Donor Stellar public key
   * @param {string} payload.recipientPublicKey - Recipient Stellar public key
   * @param {string} payload.amount - Donation amount in XLM
   * @param {string} payload.frequency - Donation frequency
   * @param {string} payload.errorMessage - Last error message
   * @param {number} payload.failureCount - Total consecutive failures
   * @param {string} payload.timestamp - ISO timestamp of the failure
   * @returns {Promise<{delivered: boolean, statusCode?: number, error?: string}>}
   */
  async sendFailureNotification(webhookUrl, payload) {
    if (!webhookUrl) {
      return { delivered: false, error: 'No webhook URL configured' };
    }

    let parsedUrl;
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
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Stella-Donation-API/1.0',
          'X-Stella-Event': 'recurring_donation.persistent_failure',
          'X-Webhook-Signature': `sha256=${signature}`,
          ...correlationHeaders,
        },
        timeout: 10000, // 10 second timeout
      };

      const req = transport.request(options, (res) => {
        // Drain response body
        res.resume();
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        log.info('WEBHOOK_SERVICE', 'Webhook delivered', {
          scheduleId: payload.scheduleId,
          statusCode: res.statusCode,
          delivered,
        });
        resolve({ delivered, statusCode: res.statusCode });
      });

      req.on('timeout', () => {
        req.destroy();
        log.warn('WEBHOOK_SERVICE', 'Webhook request timed out', { webhookUrl, scheduleId: payload.scheduleId });
        resolve({ delivered: false, error: 'Request timed out' });
      });

      req.on('error', (err) => {
        log.warn('WEBHOOK_SERVICE', 'Webhook request failed', {
          webhookUrl,
          scheduleId: payload.scheduleId,
          error: err.message,
        });
        resolve({ delivered: false, error: err.message });
      });

      req.write(body);
      req.end();
    });
  }
}

module.exports = new WebhookService();
