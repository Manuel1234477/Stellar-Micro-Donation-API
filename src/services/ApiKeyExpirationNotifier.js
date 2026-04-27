/**
 * ApiKeyExpirationNotifier - API Key Expiry Notification Service
 *
 * RESPONSIBILITY: Send webhook and email notifications when API keys are
 *                 approaching expiration or have just expired.
 * OWNER: Backend Team
 * DEPENDENCIES: apiKeys model, WebhookService, nodemailer, log utility
 *
 * Notification thresholds (days before expiry): 7, 1
 * Also handles keys that have already expired (threshold = 0).
 *
 * Deduplication: uses last_expiry_notification_sent_at column so each
 * threshold level is sent at most once per key.
 */

const nodemailer = require('nodemailer');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const log = require('../utils/log');
const {
  getKeysExpiringWithin,
  markExpiryNotificationSent,
  initializeApiKeysTable,
} = require('../models/apiKeys');

/** Notification thresholds in ascending order (smallest = most urgent).
 *  Configurable via API_KEY_EXPIRY_WARN_DAYS env var (comma-separated, e.g. "30,7,1").
 *  Default: [1, 7, 30]
 */
function parseWarnDays() {
  const raw = process.env.API_KEY_EXPIRY_WARN_DAYS;
  if (!raw) return [1, 7, 30];
  return raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

const EXPIRY_THRESHOLDS_DAYS = parseWarnDays();

/** Window (days) within which we consider a key "just expired". */
const EXPIRED_WINDOW_DAYS = 1;

/** How many days before expiry to include the X-API-Key-Expires-In header. */
const HEADER_WINDOW_DAYS = 30;

class ApiKeyExpirationNotifier {
  /**
   * Run all expiry notification checks.
   * Called by the RecurringDonationScheduler on each tick.
   *
   * @returns {Promise<{notified: number, errors: number}>}
   */
  async run() {
    let notified = 0;
    let errors = 0;

    // Process each threshold from most urgent (1 day) to least (7 days)
    for (const threshold of EXPIRY_THRESHOLDS_DAYS) {
      try {
        const keys = await getKeysExpiringWithin(threshold);
        for (const key of keys) {
          try {
            await this._notifyKey(key, threshold);
            await markExpiryNotificationSent(key.id, threshold);
            notified++;
          } catch (err) {
            errors++;
            log.error('API_KEY_EXPIRY_NOTIFIER', 'Failed to notify key', {
              keyId: key.id,
              threshold,
              error: err.message,
            });
          }
        }
      } catch (err) {
        errors++;
        log.error('API_KEY_EXPIRY_NOTIFIER', 'Failed to query expiring keys', {
          threshold,
          error: err.message,
        });
      }
    }

    // Also notify keys that have just expired (within the last EXPIRED_WINDOW_DAYS)
    try {
      const expiredKeys = await this._getRecentlyExpiredKeys();
      for (const key of expiredKeys) {
        try {
          await this._notifyKey(key, 0);
          await markExpiryNotificationSent(key.id, 0);
          notified++;
        } catch (err) {
          errors++;
          log.error('API_KEY_EXPIRY_NOTIFIER', 'Failed to notify expired key', {
            keyId: key.id,
            error: err.message,
          });
        }
      }
    } catch (err) {
      errors++;
      log.error('API_KEY_EXPIRY_NOTIFIER', 'Failed to query recently expired keys', {
        error: err.message,
      });
    }

    if (notified > 0 || errors > 0) {
      log.info('API_KEY_EXPIRY_NOTIFIER', 'Expiry notification run complete', { notified, errors });
    }

    return { notified, errors };
  }

  /**
   * Fetch keys that expired within the last EXPIRED_WINDOW_DAYS and have not
   * yet received an expiry (threshold=0) notification.
   *
   * @returns {Promise<Array>}
   * @private
   */
  async _getRecentlyExpiredKeys() {
    await initializeApiKeysTable();
    const now = Date.now();
    const windowStart = now - EXPIRED_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    const rows = await db.all(
      `SELECT id, name, key_prefix, expires_at, notification_email,
              last_expiry_notification_sent_at, metadata
       FROM api_keys
       WHERE expires_at IS NOT NULL
         AND expires_at <= ?
         AND expires_at >= ?
         AND (last_expiry_notification_sent_at IS NULL
              OR last_expiry_notification_sent_at > 0)`,
      [now, windowStart]
    );

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      keyPrefix: row.key_prefix,
      expiresAt: row.expires_at,
      notificationEmail: row.notification_email || null,
      lastExpiryNotificationSentAt: row.last_expiry_notification_sent_at,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
    }));
  }

  /**
   * Dispatch webhook and/or email notification for a single key.
   *
   * @param {Object} key - Key record from getKeysExpiringWithin
   * @param {number} thresholdDays - 0 = expired, 1 = 1 day, 7 = 7 days
   * @returns {Promise<void>}
   * @private
   */
  async _notifyKey(key, thresholdDays) {
    const webhookUrl = key.metadata && key.metadata.webhookUrl;
    const promises = [];

    if (webhookUrl) {
      promises.push(this._sendWebhook(webhookUrl, key, thresholdDays));
    }

    if (key.notificationEmail) {
      promises.push(this._sendEmail(key.notificationEmail, key, thresholdDays));
    }

    if (promises.length === 0) {
      log.debug('API_KEY_EXPIRY_NOTIFIER', 'No notification channels configured for key', {
        keyId: key.id,
        keyPrefix: key.keyPrefix,
        thresholdDays,
      });
      return;
    }

    const results = await Promise.allSettled(promises);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
      // Re-throw the first failure so run() can count it as an error
      throw failed[0].reason;
    }
  }

  /**
   * POST an expiry notification to a webhook URL.
   *
   * @param {string} webhookUrl
   * @param {Object} key
   * @param {number} thresholdDays
   * @returns {Promise<{delivered: boolean, statusCode?: number, error?: string}>}
   * @private
   */
  async _sendWebhook(webhookUrl, key, thresholdDays) {
    let parsedUrl;
    try {
      parsedUrl = new URL(webhookUrl);
    } catch {
      log.warn('API_KEY_EXPIRY_NOTIFIER', 'Invalid webhook URL', { webhookUrl, keyId: key.id });
      return { delivered: false, error: 'Invalid webhook URL' };
    }

    const event = thresholdDays === 0
      ? 'api_key.expired'
      : 'api_key.expiring';

    const body = JSON.stringify({
      event,
      keyId: key.id,
      keyPrefix: key.keyPrefix,
      keyName: key.name,
      expiresAt: new Date(key.expiresAt).toISOString(),
      daysUntilExpiry: thresholdDays,
      timestamp: new Date().toISOString(),
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
          'User-Agent': 'Stellar-Donation-API/1.0',
          'X-Stellar-Event': event,
        },
        timeout: 10000,
      };

      const req = transport.request(options, (res) => {
        res.resume();
        const delivered = res.statusCode >= 200 && res.statusCode < 300;
        log.info('API_KEY_EXPIRY_NOTIFIER', 'Webhook delivered', {
          keyId: key.id,
          event,
          statusCode: res.statusCode,
          delivered,
        });
        resolve({ delivered, statusCode: res.statusCode });
      });

      req.on('timeout', () => {
        req.destroy();
        log.warn('API_KEY_EXPIRY_NOTIFIER', 'Webhook timed out', { keyId: key.id, webhookUrl });
        resolve({ delivered: false, error: 'Request timed out' });
      });

      req.on('error', (err) => {
        log.warn('API_KEY_EXPIRY_NOTIFIER', 'Webhook request failed', {
          keyId: key.id,
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
   * Send an expiry notification email via SMTP (nodemailer).
   * Requires SMTP_HOST / SMTP_USER / SMTP_PASS environment variables.
   *
   * @param {string} toEmail
   * @param {Object} key
   * @param {number} thresholdDays
   * @returns {Promise<void>}
   * @private
   */
  async _sendEmail(toEmail, key, thresholdDays) {
    if (!toEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      log.warn('API_KEY_EXPIRY_NOTIFIER', 'Invalid notification email', { keyId: key.id, toEmail });
      return;
    }

    const expiresAtStr = new Date(key.expiresAt).toUTCString();
    const subject = thresholdDays === 0
      ? `[Action Required] API key "${key.name}" has expired`
      : `[Warning] API key "${key.name}" expires in ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}`;

    const body = thresholdDays === 0
      ? [
          `Your API key "${key.name}" (prefix: ${key.keyPrefix}) has expired.`,
          '',
          `Expired at: ${expiresAtStr}`,
          '',
          'Please rotate or create a new API key to restore access.',
        ].join('\n')
      : [
          `Your API key "${key.name}" (prefix: ${key.keyPrefix}) will expire in ${thresholdDays} day${thresholdDays === 1 ? '' : 's'}.`,
          '',
          `Expiry date: ${expiresAtStr}`,
          '',
          'Please rotate your API key before it expires to avoid service interruption.',
        ].join('\n');

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });

    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@stellar-donations.local',
      to: toEmail,
      subject,
      text: body,
    });

    log.info('API_KEY_EXPIRY_NOTIFIER', 'Expiry email sent', {
      messageId: info.messageId,
      keyId: key.id,
      thresholdDays,
      to: toEmail,
    });
  }
}

module.exports = new ApiKeyExpirationNotifier();
module.exports.ApiKeyExpirationNotifier = ApiKeyExpirationNotifier;
module.exports.EXPIRY_THRESHOLDS_DAYS = EXPIRY_THRESHOLDS_DAYS;
module.exports.HEADER_WINDOW_DAYS = HEADER_WINDOW_DAYS;
