/**
 * AccountMonitorService
 * Watches configured Stellar accounts and fires alerts when conditions are met.
 *
 * Supported alert conditions:
 *   - incoming_transaction  : any credit to the account
 *   - low_balance           : balance drops below a configured threshold
 *   - large_transaction     : a single transaction amount exceeds a threshold
 *
 * Alert delivery channels:
 *   - webhook  : HTTP POST to a caller-supplied URL
 *   - email    : placeholder (logs to console; wire up a real mailer in production)
 */

const crypto = require('crypto');
const axios = require('axios');
const log = require('../utils/log');
const { toStroops } = require('../utils/money');

class AccountMonitorService {
  /**
   * @param {object} stellarService - A StellarService or MockStellarService instance
   */
  constructor(stellarService) {
    if (!stellarService) throw new Error('stellarService is required');

    this._stellar = stellarService;

    /** @type {Map<string, object>} monitorId -> monitor config */
    this._monitors = new Map();

    /** @type {Map<string, Function>} monitorId -> unsubscribe fn */
    this._subscriptions = new Map();

    /** @type {Array<object>} delivered alert log (in-memory) */
    this._alertLog = [];
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  /**
   * Create a new account monitor.
   * @param {object} params
   * @param {string}   params.accountId        - Stellar public key to watch
   * @param {string[]} params.conditions        - ['incoming_transaction','low_balance','large_transaction']
   * @param {number}   [params.balanceThreshold]  - Required when 'low_balance' condition is present
   * @param {number}   [params.amountThreshold]   - Required when 'large_transaction' condition is present
   * @param {object}   params.alertConfig       - { channel: 'webhook'|'email', webhookUrl?, email? }
   * @returns {object} The created monitor
   */
  createMonitor({ accountId, conditions, balanceThreshold, amountThreshold, alertConfig }) {
    if (!accountId || typeof accountId !== 'string' || !accountId.trim()) {
      throw new Error('accountId is required');
    }
    if (!Array.isArray(conditions) || conditions.length === 0) {
      throw new Error('conditions must be a non-empty array');
    }

    const validConditions = ['incoming_transaction', 'low_balance', 'large_transaction'];
    for (const c of conditions) {
      if (!validConditions.includes(c)) {
        throw new Error(`Invalid condition: ${c}. Must be one of: ${validConditions.join(', ')}`);
      }
    }

    if (conditions.includes('low_balance') && (typeof balanceThreshold !== 'number' || balanceThreshold < 0)) {
      throw new Error('balanceThreshold must be a non-negative number when low_balance condition is used');
    }
    if (conditions.includes('large_transaction') && (typeof amountThreshold !== 'number' || amountThreshold <= 0)) {
      throw new Error('amountThreshold must be a positive number when large_transaction condition is used');
    }

    if (!alertConfig || !alertConfig.channel) {
      throw new Error('alertConfig.channel is required');
    }
    const validChannels = ['webhook', 'email'];
    if (!validChannels.includes(alertConfig.channel)) {
      throw new Error(`Invalid channel: ${alertConfig.channel}. Must be one of: ${validChannels.join(', ')}`);
    }
    if (alertConfig.channel === 'webhook' && !alertConfig.webhookUrl) {
      throw new Error('alertConfig.webhookUrl is required for webhook channel');
    }
    if (alertConfig.channel === 'email' && !alertConfig.email) {
      throw new Error('alertConfig.email is required for email channel');
    }

    const monitor = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'),
      accountId: accountId.trim(),
      conditions,
      balanceThreshold: balanceThreshold !== undefined ? balanceThreshold : null,
      amountThreshold: amountThreshold !== undefined ? amountThreshold : null,
      alertConfig,
      createdAt: new Date().toISOString(),
      active: true,
    };

    this._monitors.set(monitor.id, monitor);
    this._startStreaming(monitor);
    return monitor;
  }

  /**
   * List all monitors.
   * @returns {object[]}
   */
  listMonitors() {
    return Array.from(this._monitors.values());
  }

  /**
   * Get a single monitor by ID.
   * @param {string} id
   * @returns {object}
   */
  getMonitor(id) {
    const monitor = this._monitors.get(id);
    if (!monitor) throw new Error(`Monitor not found: ${id}`);
    return monitor;
  }

  /**
   * Delete a monitor and stop its stream subscription.
   * @param {string} id
   * @returns {boolean}
   */
  deleteMonitor(id) {
    if (!this._monitors.has(id)) throw new Error(`Monitor not found: ${id}`);
    this._stopStreaming(id);
    this._monitors.delete(id);
    return true;
  }

  /**
   * Return the in-memory alert log (useful for testing).
   * @returns {object[]}
   */
  getAlertLog() {
    return [...this._alertLog];
  }

  // ─── Streaming ─────────────────────────────────────────────────────────────

  /**
   * Start streaming transactions for a monitor.
   * @private
   */
  _startStreaming(monitor) {
    try {
      const unsubscribe = this._stellar.streamTransactions(
        monitor.accountId,
        (tx) => this._handleTransaction(monitor.id, tx)
      );
      this._subscriptions.set(monitor.id, unsubscribe);
    } catch (err) {
      // Account may not exist yet in mock — store a no-op unsubscribe
      this._subscriptions.set(monitor.id, () => {});
    }
  }

  /**
   * Stop streaming for a monitor.
   * @private
   */
  _stopStreaming(id) {
    const unsubscribe = this._subscriptions.get(id);
    if (unsubscribe) {
      unsubscribe();
      this._subscriptions.delete(id);
    }
  }

  // ─── Alert evaluation ──────────────────────────────────────────────────────

  /**
   * Evaluate a transaction against a monitor's conditions and fire alerts.
   * @private
   * @param {string} monitorId
   * @param {object} tx - Transaction object from streamTransactions
   */
  async _handleTransaction(monitorId, tx) {
    const monitor = this._monitors.get(monitorId);
    if (!monitor || !monitor.active) return;

    const alerts = [];

    if (monitor.conditions.includes('incoming_transaction') && tx.destination === monitor.accountId) {
      alerts.push({ condition: 'incoming_transaction', tx });
    }

    if (monitor.conditions.includes('large_transaction')) {
      const amountStroops = toStroops(String(tx.amount));
      if (amountStroops >= toStroops(String(monitor.amountThreshold))) {
        alerts.push({ condition: 'large_transaction', tx, threshold: monitor.amountThreshold });
      }
    }

    if (monitor.conditions.includes('low_balance')) {
      try {
        const { balance } = await this._stellar.getBalance(monitor.accountId);
        if (toStroops(String(balance)) < toStroops(String(monitor.balanceThreshold))) {
          alerts.push({ condition: 'low_balance', balance, threshold: monitor.balanceThreshold });
        }
      } catch (_) { /* account may not exist */ }
    }

    for (const alert of alerts) {
      await this._deliverAlert(monitor, alert);
    }
  }

  /**
   * Deliver an alert via the configured channel.
   * @private
   * @param {object} monitor
   * @param {object} alert
   */
  async _deliverAlert(monitor, alert) {
    const payload = {
      monitorId: monitor.id,
      accountId: monitor.accountId,
      condition: alert.condition,
      alert,
      timestamp: new Date().toISOString(),
    };

    const logEntry = { ...payload, channel: monitor.alertConfig.channel, delivered: false, error: null };

    try {
      if (monitor.alertConfig.channel === 'webhook') {
        await axios.post(monitor.alertConfig.webhookUrl, payload, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
        });
      } else if (monitor.alertConfig.channel === 'email') {
        await this._sendEmailAlert(monitor.alertConfig.email, monitor, alert);
      }
      logEntry.delivered = true;
    } catch (err) {
      logEntry.error = err.message;
      log.error('ACCOUNT_MONITOR_SERVICE', 'Alert delivery failed', { error: err.message });
    }

    this._alertLog.push(logEntry);
  }

  /**
   * Send email alert using nodemailer
   * @private
   * @param {string} email - Recipient email address
   * @param {object} monitor - Monitor configuration
   * @param {object} alert - Alert details
   */
  async _sendEmailAlert(email, monitor, alert) {
    // Check if SMTP is configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_PORT) {
      log.warn('ACCOUNT_MONITOR_SERVICE', 'SMTP not configured, skipping email alert', { email });
      throw new Error('SMTP configuration is required for email alerts');
    }

    // Initialize nodemailer transporter
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

    // Create email subject and body based on alert condition
    let subject, text, html;
    
    switch (alert.condition) {
      case 'incoming_transaction':
        subject = `Stellar Alert: Incoming transaction to ${monitor.accountId}`;
        text = `An incoming transaction of ${alert.tx.amount} XLM was detected on account ${monitor.accountId}.`;
        html = `<h2>Incoming Transaction Alert</h2>
                <p>An incoming transaction was detected on account <strong>${monitor.accountId}</strong>.</p>
                <ul>
                  <li><strong>Amount:</strong> ${alert.tx.amount} XLM</li>
                  <li><strong>From:</strong> ${alert.tx.source || 'Unknown'}</li>
                  <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
                  <li><strong>Monitor ID:</strong> ${monitor.id}</li>
                </ul>`;
        break;
        
      case 'low_balance':
        subject = `Stellar Alert: Low balance on ${monitor.accountId}`;
        text = `Account ${monitor.accountId} balance (${alert.balance} XLM) is below threshold (${monitor.balanceThreshold} XLM).`;
        html = `<h2>Low Balance Alert</h2>
                <p>Account <strong>${monitor.accountId}</strong> has a low balance.</p>
                <ul>
                  <li><strong>Current Balance:</strong> ${alert.balance} XLM</li>
                  <li><strong>Threshold:</strong> ${monitor.balanceThreshold} XLM</li>
                  <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
                  <li><strong>Monitor ID:</strong> ${monitor.id}</li>
                </ul>`;
        break;
        
      case 'large_transaction':
        subject = `Stellar Alert: Large transaction on ${monitor.accountId}`;
        text = `A large transaction of ${alert.tx.amount} XLM was detected on account ${monitor.accountId}.`;
        html = `<h2>Large Transaction Alert</h2>
                <p>A large transaction was detected on account <strong>${monitor.accountId}</strong>.</p>
                <ul>
                  <li><strong>Amount:</strong> ${alert.tx.amount} XLM</li>
                  <li><strong>Threshold:</strong> ${monitor.amountThreshold} XLM</li>
                  <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
                  <li><strong>Monitor ID:</strong> ${monitor.id}</li>
                </ul>`;
        break;
        
      default:
        subject = `Stellar Alert: ${alert.condition} on ${monitor.accountId}`;
        text = `Alert condition "${alert.condition}" triggered on account ${monitor.accountId}.`;
        html = `<h2>Account Alert</h2>
                <p>Alert condition <strong>${alert.condition}</strong> was triggered on account <strong>${monitor.accountId}</strong>.</p>`;
    }

    const mailOptions = {
      from: process.env.SMTP_FROM || 'alerts@stellar-donations.org',
      to: email,
      subject,
      text,
      html,
    };

    try {
      await transporter.sendMail(mailOptions);
      log.info('ACCOUNT_MONITOR_SERVICE', 'Email alert sent successfully', { email, monitorId: monitor.id });
    } catch (error) {
      log.error('ACCOUNT_MONITOR_SERVICE', 'Failed to send email alert', { 
        email, 
        monitorId: monitor.id,
        error: error.message 
      });
      throw error;
    }
  }
}

module.exports = AccountMonitorService;
