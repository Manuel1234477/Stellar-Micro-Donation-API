/**
 * Webhook Email Notification Service (Issue #1084)
 *
 * Sends email notifications for webhook delivery failures with:
 * - Deduplication and rate-limiting to prevent notification storms
 * - Async delivery with exponential backoff
 * - Masked sensitive data in emails
 * - Persistent notification ledger for idempotency across restarts
 *
 * Issue #1084: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/1084
 */

const nodemailer = require('nodemailer');
const db = require('../utils/database');
const log = require('../utils/log');
const { dataMask } = require('../utils/dataMasker');

const NOTIFICATION_SUPPRESSION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000]; // 1min, 5min, 30min

class WebhookEmailNotificationService {
  constructor() {
    this.transporter = this._initializeTransporter();
    this.queue = new Map(); // In-memory queue for async sending
  }

  /**
   * Initialize SMTP transporter from environment config
   */
  _initializeTransporter() {
    if (!process.env.SMTP_HOST) {
      log.warn('WEBHOOK_EMAIL', 'SMTP not configured; notifications disabled');
      return null;
    }

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      } : undefined,
    });
  }

  /**
   * Initialize notification ledger table for idempotency
   */
  static async initializeNotificationLedger() {
    await db.run(`
      CREATE TABLE IF NOT EXISTS webhook_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        status TEXT NOT NULL, -- 'pending', 'sent', 'failed'
        attempt_count INTEGER DEFAULT 0,
        last_attempted_at INTEGER,
        sent_at INTEGER,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(webhook_id, event_type, created_at)
      )
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_webhook_notifications_webhook_id
      ON webhook_notifications(webhook_id)
    `);

    await db.run(`
      CREATE INDEX IF NOT EXISTS idx_webhook_notifications_status
      ON webhook_notifications(status)
    `);
  }

  /**
   * Send auto-disable notification to webhook owner.
   * Deduplicates within suppression window.
   *
   * @param {Object} webhook - Webhook object from database
   * @param {number} failureCount - Number of consecutive failures
   * @param {string} lastError - Last failure message
   * @returns {Promise<{ queued: boolean, notificationId?: number }>}
   */
  async notifyWebhookAutoDisabled(webhook, failureCount, lastError) {
    if (!this.transporter || !webhook.owner_email) {
      log.debug('WEBHOOK_EMAIL', 'Email notification skipped', {
        hasTransport: !!this.transporter,
        hasEmail: !!webhook.owner_email,
      });
      return { queued: false };
    }

    await WebhookEmailNotificationService.initializeNotificationLedger();

    // Check for recent notification (deduplication)
    const recentNotification = await db.get(`
      SELECT id FROM webhook_notifications
      WHERE webhook_id = ? AND event_type = 'auto_disabled'
      AND created_at > ? AND status IN ('sent', 'pending')
    `, [webhook.id, Date.now() - NOTIFICATION_SUPPRESSION_WINDOW_MS]);

    if (recentNotification) {
      log.debug('WEBHOOK_EMAIL', 'Notification deduped (recent)', {
        webhookId: webhook.id,
      });
      return { queued: false };
    }

    // Create notification ledger entry
    const result = await db.run(`
      INSERT INTO webhook_notifications
      (webhook_id, event_type, recipient_email, status, created_at)
      VALUES (?, 'auto_disabled', ?, 'pending', ?)
    `, [webhook.id, webhook.owner_email, Date.now()]);

    const notificationId = result.lastID;

    // Queue async send (non-blocking)
    this._queueAsyncSend(notificationId, webhook, failureCount, lastError).catch(err => {
      log.error('WEBHOOK_EMAIL', 'Failed to queue notification', { error: err.message });
    });

    return { queued: true, notificationId };
  }

  /**
   * Queue async send with retry logic (doesn't block caller)
   */
  _queueAsyncSend(notificationId, webhook, failureCount, lastError, attempt = 0) {
    // Use setImmediate to avoid blocking
    return new Promise((resolve) => {
      setImmediate(async () => {
        try {
          await this._sendNotificationWithRetry(
            notificationId,
            webhook,
            failureCount,
            lastError,
            attempt
          );
          resolve();
        } catch (err) {
          log.error('WEBHOOK_EMAIL', 'Notification send failed', {
            notificationId,
            attempt,
            error: err.message,
          });
          resolve(); // Don't propagate; logged above
        }
      });
    });
  }

  /**
   * Send notification with exponential backoff retry
   */
  async _sendNotificationWithRetry(notificationId, webhook, failureCount, lastError, attempt) {
    try {
      // Mask sensitive data before sending
      const maskedUrl = dataMask(webhook.url);

      const emailContent = {
        to: webhook.owner_email,
        subject: `⚠️ Webhook Auto-Disabled: ${maskedUrl}`,
        html: `
          <h2>Webhook Auto-Disabled</h2>
          <p>Your webhook has been automatically disabled after ${failureCount} consecutive failures.</p>
          
          <h3>Details</h3>
          <ul>
            <li><strong>Webhook URL:</strong> ${maskedUrl}</li>
            <li><strong>Webhook ID:</strong> ${webhook.id}</li>
            <li><strong>Failure Count:</strong> ${failureCount}</li>
            <li><strong>Last Error:</strong> ${lastError}</li>
            <li><strong>Time:</strong> ${new Date().toISOString()}</li>
          </ul>
          
          <h3>Next Steps</h3>
          <ol>
            <li>Review your webhook endpoint to ensure it's accessible and returns a 2xx status code</li>
            <li>Check logs for any configuration issues</li>
            <li>Update the webhook configuration if needed</li>
            <li>Re-enable the webhook through the API</li>
          </ol>
          
          <p><em>This is an automated notification from Stellar Micro-Donation API.</em></p>
        `,
        text: `
Webhook Auto-Disabled

Your webhook has been automatically disabled after ${failureCount} consecutive failures.

Details:
- Webhook URL: ${maskedUrl}
- Webhook ID: ${webhook.id}
- Failure Count: ${failureCount}
- Last Error: ${lastError}
- Time: ${new Date().toISOString()}

Next Steps:
1. Review your webhook endpoint
2. Check logs for issues
3. Update configuration if needed
4. Re-enable through API

This is an automated notification from Stellar Micro-Donation API.
        `,
      };

      await this.transporter.sendMail(emailContent);

      // Mark as sent in ledger
      await db.run(`
        UPDATE webhook_notifications
        SET status = 'sent', sent_at = ?, attempt_count = ?
        WHERE id = ?
      `, [Date.now(), attempt + 1, notificationId]);

      log.info('WEBHOOK_EMAIL', 'Notification sent successfully', {
        notificationId,
        webhookId: webhook.id,
        recipient: webhook.owner_email,
      });

      // Record metric
      await this._recordMetric('webhook_notification_sent', webhook.id);
    } catch (err) {
      if (attempt < MAX_RETRY_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt];
        log.warn('WEBHOOK_EMAIL', 'Notification send failed; retrying', {
          notificationId,
          attempt,
          nextRetryMs: delay,
          error: err.message,
        });

        // Schedule retry
        setTimeout(() => { // eslint-disable-line local/no-bare-timers
          this._sendNotificationWithRetry(
            notificationId,
            webhook,
            failureCount,
            lastError,
            attempt + 1
          ).catch(retryErr => {
            log.error('WEBHOOK_EMAIL', 'Retry failed', { error: retryErr.message });
          });
        }, delay);
      } else {
        // Max retries exceeded
        await db.run(`
          UPDATE webhook_notifications
          SET status = 'failed', error_message = ?, attempt_count = ?
          WHERE id = ?
        `, [err.message, attempt + 1, notificationId]);

        // Record metric
        await this._recordMetric('webhook_notification_failed', webhook.id);

        log.error('WEBHOOK_EMAIL', 'Notification send failed after max retries', {
          notificationId,
          error: err.message,
        });
      }
    }
  }

  /**
   * Record notification metrics for observability
   */
  async _recordMetric(metricName, webhookId) {
    try {
      const MetricsService = require('./MetricsService');
      if (MetricsService) {
        MetricsService.increment(metricName, { webhookId });
      }
    } catch (_) {
      // Metrics service may not be available
    }
  }

  /**
   * Validate email configuration at startup
   */
  async validateConfiguration() {
    if (!this.transporter) {
      return {
        enabled: false,
        reason: 'SMTP_HOST not configured',
      };
    }

    try {
      await this.transporter.verify();
      return {
        enabled: true,
        reason: 'SMTP connection verified',
      };
    } catch (err) {
      log.error('WEBHOOK_EMAIL', 'SMTP verification failed', { error: err.message });
      return {
        enabled: false,
        reason: `SMTP verification failed: ${err.message}`,
      };
    }
  }

  /**
   * Get notification history for a webhook (for debugging)
   */
  async getNotificationHistory(webhookId, limit = 10) {
    await WebhookEmailNotificationService.initializeNotificationLedger();
    return db.query(`
      SELECT id, event_type, status, attempt_count, sent_at, error_message
      FROM webhook_notifications
      WHERE webhook_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `, [webhookId, limit]);
  }
}

module.exports = WebhookEmailNotificationService;
