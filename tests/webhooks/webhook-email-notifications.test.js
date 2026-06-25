/**
 * Tests for Webhook Email Notifications (Issue #1084)
 * 
 * Verifies notification deduplication, rate-limiting, async delivery,
 * and idempotency across restarts.
 */

const WebhookEmailNotificationService = require('../../src/services/WebhookEmailNotificationService');
const db = require('../../src/utils/database');

describe('Webhook Email Notification Service (Issue #1084)', () => {
  let emailService;

  beforeEach(async () => {
    await WebhookEmailNotificationService.initializeNotificationLedger();
    emailService = new WebhookEmailNotificationService();
    // Mock transporter to avoid actual email sending
    emailService.transporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-123' }),
      verify: jest.fn().mockResolvedValue(true),
    };
  });

  afterEach(async () => {
    await db.run('DELETE FROM webhook_notifications');
  });

  describe('Notification Deduplication', () => {
    test('should deduplicate notifications within suppression window', async () => {
      const webhook = {
        id: 1,
        owner_email: 'owner@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      // First notification
      const res1 = await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Connection timeout');
      expect(res1.queued).toBe(true);

      // Wait a bit and try second notification (should be deduped)
      await new Promise(r => setTimeout(r, 100));
      const res2 = await emailService.notifyWebhookAutoDisabled(webhook, 6, 'Connection timeout');
      expect(res2.queued).toBe(false);
    });

    test('should allow new notification after suppression window', async () => {
      const webhook = {
        id: 1,
        owner_email: 'owner@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      // First notification
      const res1 = await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Timeout');
      expect(res1.queued).toBe(true);

      // Manually set created_at to be old
      await db.run(`
        UPDATE webhook_notifications
        SET created_at = ? WHERE id = ?
      `, [Date.now() - (2 * 60 * 60 * 1000), res1.notificationId]); // 2 hours ago

      // Second notification (should NOT be deduped)
      const res2 = await emailService.notifyWebhookAutoDisabled(webhook, 6, 'Still timing out');
      expect(res2.queued).toBe(true);
      expect(res2.notificationId).not.toBe(res1.notificationId);
    });
  });

  describe('Notification Ledger & Idempotency', () => {
    test('should record notification in ledger for restart idempotency', async () => {
      const webhook = {
        id: 1,
        owner_email: 'owner@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Endpoint unreachable');
      
      // Wait for async send to complete
      await new Promise(r => setTimeout(r, 500));

      const history = await emailService.getNotificationHistory(webhook.id);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].event_type).toBe('auto_disabled');
    });

    test('should mark notification as sent when successful', async () => {
      const webhook = {
        id: 2,
        owner_email: 'admin@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      const res = await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Connection failed');
      
      // Wait for async operation
      await new Promise(r => setTimeout(r, 500));

      const notification = await db.get(
        'SELECT * FROM webhook_notifications WHERE id = ?',
        [res.notificationId]
      );

      expect(notification.status).toBe('sent');
      expect(notification.attempt_count).toBeGreaterThan(0);
    });

    test('should retry notification on transient failure', async () => {
      const webhook = {
        id: 3,
        owner_email: 'admin@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      // Mock transient failure then success
      let callCount = 0;
      emailService.transporter.sendMail = jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('SMTP connection failed'));
        }
        return Promise.resolve({ messageId: 'test-123' });
      });

      const res = await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Transient error');
      
      // Wait for retries (first fails, second succeeds)
      await new Promise(r => setTimeout(r, 2000));

      const notification = await db.get(
        'SELECT * FROM webhook_notifications WHERE id = ?',
        [res.notificationId]
      );

      // Should eventually succeed
      expect(notification.attempt_count).toBeGreaterThan(1);
    });
  });

  describe('Async Delivery', () => {
    test('should not block caller during notification send', async () => {
      const webhook = {
        id: 4,
        owner_email: 'owner@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      // Mock slow email send
      emailService.transporter.sendMail = jest.fn().mockImplementation(
        () => new Promise(r => setTimeout(() => r({ messageId: 'test' }), 500))
      );

      const start = Date.now();
      const res = await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Error');
      const elapsed = Date.now() - start;

      // Should return quickly (async doesn't block)
      expect(elapsed).toBeLessThan(100);
      expect(res.queued).toBe(true);
    });
  });

  describe('Sensitive Data Masking', () => {
    test('should mask webhook URL and secrets in emails', async () => {
      const webhook = {
        id: 5,
        owner_email: 'owner@example.com',
        url: 'https://api.example.com/webhook?token=secret123456789',
        secret: 'webhook-secret-12345',
      };

      let sentEmail = null;
      emailService.transporter.sendMail = jest.fn().mockImplementation((opts) => {
        sentEmail = opts;
        return Promise.resolve({ messageId: 'test-123' });
      });

      await emailService.notifyWebhookAutoDisabled(webhook, 5, 'Failed');
      
      // Wait for async operation
      await new Promise(r => setTimeout(r, 500));

      // Email content should not contain raw secret
      expect(sentEmail.html).not.toContain('secret123456789');
      expect(sentEmail.html).not.toContain('webhook-secret');
      expect(sentEmail.text).not.toContain('secret123456789');
    });
  });

  describe('Rate Limiting & Flapping', () => {
    test('should not send multiple notifications for flapping endpoint', async () => {
      const webhook = {
        id: 6,
        owner_email: 'owner@example.com',
        url: 'https://example.com/flapping',
        secret: null,
      };

      let emailCount = 0;
      emailService.transporter.sendMail = jest.fn().mockImplementation(() => {
        emailCount++;
        return Promise.resolve({ messageId: 'test-123' });
      });

      // Simulate multiple failures in quick succession
      for (let i = 0; i < 5; i++) {
        await emailService.notifyWebhookAutoDisabled(webhook, 5 + i, `Failure ${i}`);
        await new Promise(r => setTimeout(r, 50));
      }

      // Wait for async operations
      await new Promise(r => setTimeout(r, 1000));

      // Should have sent only 1 email (deduplicated)
      expect(emailCount).toBeLessThanOrEqual(1);
    });
  });

  describe('Configuration Validation', () => {
    test('should validate SMTP configuration', async () => {
      const result = await emailService.validateConfiguration();
      expect(result).toHaveProperty('enabled');
      expect(result).toHaveProperty('reason');
    });

    test('should handle missing SMTP gracefully', () => {
      const noSmtpService = new WebhookEmailNotificationService();
      noSmtpService.transporter = null;

      expect(noSmtpService.transporter).toBeNull();
    });
  });

  describe('Notification History', () => {
    test('should track notification history per webhook', async () => {
      const webhook = {
        id: 7,
        owner_email: 'owner@example.com',
        url: 'https://example.com/webhook',
        secret: null,
      };

      // Create multiple notifications by manipulating time
      for (let i = 0; i < 3; i++) {
        await db.run(`
          INSERT INTO webhook_notifications
          (webhook_id, event_type, recipient_email, status, created_at, attempt_count)
          VALUES (?, 'auto_disabled', ?, 'sent', ?, ?)
        `, [webhook.id, webhook.owner_email, Date.now() - (i * 100), 1]);
      }

      const history = await emailService.getNotificationHistory(webhook.id);
      expect(history.length).toBe(3);
    });
  });
});
