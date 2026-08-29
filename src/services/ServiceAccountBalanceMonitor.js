/**
 * ServiceAccountBalanceMonitor
 *
 * Polls the service account's XLM balance via Horizon on a fixed interval
 * and raises alerts before low-balance conditions cause fee-bump / recurring
 * donation transactions to fail with STELLAR_OP_UNDERFUNDED.
 *
 * Thresholds (configurable via env):
 *   - BALANCE_ALERT_THRESHOLD_XLM    (default 10) -> fires 'account.balance_low' webhook
 *   - BALANCE_CRITICAL_THRESHOLD_XLM (default 2)  -> pauses the recurring donation
 *                                                     scheduler and emails an admin
 *
 * The scheduler is automatically resumed once the balance recovers above the
 * critical threshold.
 */

const timerRegistry = require('../utils/timerRegistry');
const WebhookService = require('./WebhookService');
const log = require('../utils/log');

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_ALERT_THRESHOLD_XLM = 10;
const DEFAULT_CRITICAL_THRESHOLD_XLM = 2;

class ServiceAccountBalanceMonitor {
  /**
   * @param {object} stellarService - StellarService or MockStellarService instance (must expose getBalance(publicKey))
   * @param {object} [scheduler] - RecurringDonationScheduler instance (must expose pause()/resume()/isPaused())
   * @param {object} [options]
   * @param {string} [options.accountId] - Public key of the service account to monitor
   * @param {number} [options.alertThresholdXlm]
   * @param {number} [options.criticalThresholdXlm]
   * @param {number} [options.checkIntervalMs]
   */
  constructor(stellarService, scheduler = null, options = {}) {
    if (!stellarService) throw new Error('stellarService is required');

    this._stellar = stellarService;
    this._scheduler = scheduler;

    this.accountId = options.accountId || process.env.SERVICE_ACCOUNT_PUBLIC_KEY || null;
    this.alertThresholdXlm = options.alertThresholdXlm !== undefined
      ? options.alertThresholdXlm
      : parseFloat(process.env.BALANCE_ALERT_THRESHOLD_XLM || DEFAULT_ALERT_THRESHOLD_XLM);
    this.criticalThresholdXlm = options.criticalThresholdXlm !== undefined
      ? options.criticalThresholdXlm
      : parseFloat(process.env.BALANCE_CRITICAL_THRESHOLD_XLM || DEFAULT_CRITICAL_THRESHOLD_XLM);
    this.checkIntervalMs = options.checkIntervalMs !== undefined
      ? options.checkIntervalMs
      : parseInt(process.env.BALANCE_CHECK_INTERVAL_MS || DEFAULT_CHECK_INTERVAL_MS, 10);

    this._intervalHandle = null;
    this._pausedByMonitor = false;
    this._alertActive = false;
    this._criticalActive = false;
    this.lastBalance = null;
    this.lastCheckedAt = null;
    this.lastError = null;
  }

  /**
   * Start periodic balance checks. Safe to call multiple times (no-op if already running).
   */
  start() {
    if (this._intervalHandle) return;

    this.checkBalance();
    this._intervalHandle = timerRegistry.createInterval(
      () => this.checkBalance(),
      this.checkIntervalMs,
      'service-account-balance-monitor'
    );
    this._intervalHandle.unref();

    log.info('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Balance monitor started', {
      intervalMs: this.checkIntervalMs,
      alertThresholdXlm: this.alertThresholdXlm,
      criticalThresholdXlm: this.criticalThresholdXlm,
    });
  }

  /**
   * Stop periodic balance checks.
   */
  stop() {
    if (this._intervalHandle) {
      this._intervalHandle.clear();
      this._intervalHandle = null;
    }
  }

  /**
   * Run a single balance check, firing webhook/email alerts and pausing/resuming
   * the scheduler as needed.
   * @returns {Promise<object>} status snapshot
   */
  async checkBalance() {
    if (!this.accountId) {
      this.lastError = 'No service account configured (SERVICE_ACCOUNT_PUBLIC_KEY not set)';
      return this.getStatus();
    }

    try {
      const { balance } = await this._stellar.getBalance(this.accountId);
      const balanceXlm = parseFloat(balance);
      this.lastBalance = balanceXlm;
      this.lastCheckedAt = new Date().toISOString();
      this.lastError = null;

      if (balanceXlm < this.criticalThresholdXlm) {
        await this._handleCritical(balanceXlm);
      } else {
        await this._handleCriticalRecovery(balanceXlm);
      }

      if (balanceXlm < this.alertThresholdXlm) {
        await this._handleAlert(balanceXlm);
      } else {
        this._alertActive = false;
      }
    } catch (err) {
      this.lastError = err.message;
      log.error('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Balance check failed', { error: err.message });
    }

    return this.getStatus();
  }

  /** @private */
  async _handleAlert(balanceXlm) {
    if (this._alertActive) return; // avoid duplicate webhook spam
    this._alertActive = true;

    try {
      await WebhookService.deliver('account.balance_low', {
        accountId: this.accountId,
        balance: balanceXlm,
        threshold: this.alertThresholdXlm,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Failed to deliver account.balance_low webhook', {
        error: err.message,
      });
    }
  }

  /** @private */
  async _handleCritical(balanceXlm) {
    if (!this._criticalActive) {
      this._criticalActive = true;

      if (this._scheduler && typeof this._scheduler.isPaused === 'function' && !this._scheduler.isPaused()) {
        this._scheduler.pause();
        this._pausedByMonitor = true;
        log.warn('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Scheduler paused due to critical balance', {
          balance: balanceXlm,
          threshold: this.criticalThresholdXlm,
        });
      }

      await this._sendAdminNotification(balanceXlm);
    }
  }

  /** @private */
  async _handleCriticalRecovery(balanceXlm) {
    if (this._criticalActive) {
      this._criticalActive = false;

      if (this._pausedByMonitor && this._scheduler && typeof this._scheduler.resume === 'function') {
        this._scheduler.resume();
        this._pausedByMonitor = false;
        log.info('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Scheduler resumed after balance recovery', {
          balance: balanceXlm,
        });
      }
    }
  }

  /** @private */
  async _sendAdminNotification(balanceXlm) {
    const adminEmail = process.env.ADMIN_ALERT_EMAIL;
    if (!adminEmail || !process.env.SMTP_HOST) {
      log.warn('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Admin notification email not sent (SMTP/ADMIN_ALERT_EMAIL not configured)', {
        balance: balanceXlm,
      });
      return;
    }

    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'alerts@stellar-donations.org',
        to: adminEmail,
        subject: `CRITICAL: Service account balance below ${this.criticalThresholdXlm} XLM`,
        text: `Service account ${this.accountId} balance is ${balanceXlm} XLM, below the critical threshold of ${this.criticalThresholdXlm} XLM. The recurring donation scheduler has been paused until the balance is restored.`,
      });
    } catch (err) {
      log.error('SERVICE_ACCOUNT_BALANCE_MONITOR', 'Failed to send admin notification email', {
        error: err.message,
      });
    }
  }

  /**
   * Snapshot used by the /health endpoint.
   * @returns {object}
   */
  getStatus() {
    return {
      accountId: this.accountId,
      balance: this.lastBalance,
      alertThresholdXlm: this.alertThresholdXlm,
      criticalThresholdXlm: this.criticalThresholdXlm,
      alertActive: this._alertActive,
      criticalActive: this._criticalActive,
      schedulerPausedByMonitor: this._pausedByMonitor,
      lastCheckedAt: this.lastCheckedAt,
      error: this.lastError,
    };
  }
}

module.exports = ServiceAccountBalanceMonitor;
