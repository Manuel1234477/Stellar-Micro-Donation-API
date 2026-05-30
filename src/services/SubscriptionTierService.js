/**
 * Subscription Tier Service
 *
 * RESPONSIBILITY: Tier definition management, donor enrollment, and tier analytics
 * OWNER: Backend Team
 * DEPENDENCIES: Database, RecurringDonationScheduler
 *
 * Handles all business logic for subscription tiers:
 *  - Creating and listing tiers
 *  - Enrolling donors (creates a recurring_donation schedule under the hood)
 *  - Cancelling subscriptions
 *  - Tier-based analytics (subscriber counts, revenue per tier)
 */

'use strict';

const Database = require('../utils/database');
const { ValidationError, NotFoundError, DuplicateError, ERROR_CODES } = require('../utils/errors');
const { SCHEDULE_STATUS, DONATION_FREQUENCIES } = require('../constants');
const log = require('../utils/log');

/** Allowed interval values for a tier */
const VALID_INTERVALS = Object.freeze([
  DONATION_FREQUENCIES.DAILY,
  DONATION_FREQUENCIES.WEEKLY,
  DONATION_FREQUENCIES.MONTHLY,
]);

class SubscriptionTierService {
  /**
   * @param {Object} recurringDonationScheduler - RecurringDonationScheduler instance
   */
  constructor(recurringDonationScheduler) {
    this.scheduler = recurringDonationScheduler;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tier management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new subscription tier.
   *
   * @param {Object} params
   * @param {string} params.name     - Unique tier name (e.g. "Gold")
   * @param {number} params.amount   - Donation amount per interval (XLM)
   * @param {string} [params.interval='monthly'] - Frequency: daily | weekly | monthly
   * @param {string|Object} [params.benefits]    - Free-form benefits description or JSON
   * @returns {Promise<Object>} Created tier row
   * @throws {ValidationError} on invalid input
   * @throws {DuplicateError}  if name already exists
   */
  async createTier({ name, amount, interval = 'monthly', benefits }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required', null, ERROR_CODES.MISSING_REQUIRED_FIELD);
    }

    const parsedAmount = parseFloat(amount);
    if (!isFinite(parsedAmount) || parsedAmount <= 0) {
      throw new ValidationError('amount must be a positive number', null, ERROR_CODES.INVALID_AMOUNT);
    }

    if (!VALID_INTERVALS.includes(interval)) {
      throw new ValidationError(
        `interval must be one of: ${VALID_INTERVALS.join(', ')}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const benefitsStr = benefits
      ? (typeof benefits === 'string' ? benefits : JSON.stringify(benefits))
      : null;

    try {
      const result = await Database.run(
        `INSERT INTO subscription_tiers (name, amount, interval, benefits)
         VALUES (?, ?, ?, ?)`,
        [name.trim(), parsedAmount, interval, benefitsStr]
      );

      log.info('SUBSCRIPTION_TIER_SERVICE', 'Tier created', { tierId: result.id, name, amount, interval });
      return this._getTierById(result.id);
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT' || (err.message && err.message.includes('UNIQUE'))) {
        throw new DuplicateError(`Tier with name "${name}" already exists`);
      }
      throw err;
    }
  }

  /**
   * List all subscription tiers.
   *
   * @returns {Promise<Object[]>} Array of tier objects
   */
  async listTiers() {
    const rows = await Database.query(
      'SELECT * FROM subscription_tiers ORDER BY amount ASC'
    );
    return rows.map(this._formatTier);
  }

  /**
   * Get a single tier by ID.
   *
   * @param {number|string} id - Tier ID
   * @returns {Promise<Object>} Tier object
   * @throws {NotFoundError} if not found
   */
  async getTierById(id) {
    return this._getTierById(id);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Subscriptions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe a donor to a tier.
   * Creates a recurring_donation schedule using the tier's amount and interval,
   * then records the subscription linking donor → tier → schedule.
   *
   * @param {Object} params
   * @param {number|string} params.tierId           - Tier ID to subscribe to
   * @param {string}        params.donorPublicKey   - Donor's Stellar public key
   * @param {string}        params.recipientPublicKey - Recipient's Stellar public key
   * @param {string}        [params.startDate]      - ISO date for first execution
   * @returns {Promise<Object>} Subscription record with tier and schedule details
   * @throws {NotFoundError}   if tier, donor, or recipient not found
   * @throws {DuplicateError}  if donor already has an active subscription to this tier
   */
  async subscribe({ tierId, donorPublicKey, recipientPublicKey, startDate }) {
    const tier = await this._getTierById(tierId);

    const donor = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [donorPublicKey]
    );
    if (!donor) {
      throw new NotFoundError('Donor wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    const recipient = await Database.get(
      'SELECT id, publicKey FROM users WHERE publicKey = ?',
      [recipientPublicKey]
    );
    if (!recipient) {
      throw new NotFoundError('Recipient wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
    }

    if (donor.id === recipient.id) {
      throw new ValidationError('Donor and recipient cannot be the same', null, ERROR_CODES.INVALID_REQUEST);
    }

    // Prevent duplicate active subscriptions to the same tier
    const existing = await Database.get(
      `SELECT id FROM donor_subscriptions
       WHERE donorId = ? AND tierId = ? AND status = 'active'`,
      [donor.id, tier.id]
    );
    if (existing) {
      throw new DuplicateError('Donor already has an active subscription to this tier');
    }

    // Calculate first execution date
    const firstExecution = startDate
      ? new Date(startDate).toISOString()
      : this.scheduler.calculateNextExecutionDate(new Date(), tier.interval).toISOString();

    // Create the recurring donation schedule
    const scheduleResult = await Database.run(
      `INSERT INTO recurring_donations
         (donorId, recipientId, amount, frequency, nextExecutionDate, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [donor.id, recipient.id, tier.amount, tier.interval, firstExecution, SCHEDULE_STATUS.ACTIVE]
    );

    // Record the subscription
    const subResult = await Database.run(
      `INSERT INTO donor_subscriptions (donorId, tierId, recurringDonationId, status)
       VALUES (?, ?, ?, 'active')`,
      [donor.id, tier.id, scheduleResult.id]
    );

    log.info('SUBSCRIPTION_TIER_SERVICE', 'Donor subscribed to tier', {
      subscriptionId: subResult.id,
      donorId: donor.id,
      tierId: tier.id,
      scheduleId: scheduleResult.id,
    });

    return this._getSubscriptionById(subResult.id);
  }

  /**
   * Cancel a donor's subscription.
   * Sets the subscription status to 'cancelled' and cancels the linked recurring schedule.
   *
   * @param {number|string} subscriptionId - Subscription ID
   * @returns {Promise<Object>} Updated subscription record
   * @throws {NotFoundError} if subscription not found
   */
  async cancelSubscription(subscriptionId) {
    const sub = await Database.get(
      'SELECT * FROM donor_subscriptions WHERE id = ?',
      [subscriptionId]
    );
    if (!sub) {
      throw new NotFoundError('Subscription not found', ERROR_CODES.NOT_FOUND);
    }

    await Database.run(
      `UPDATE donor_subscriptions SET status = 'cancelled', cancelledAt = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [subscriptionId]
    );

    if (sub.recurringDonationId) {
      await Database.run(
        `UPDATE recurring_donations SET status = ? WHERE id = ?`,
        [SCHEDULE_STATUS.CANCELLED, sub.recurringDonationId]
      );
    }

    log.info('SUBSCRIPTION_TIER_SERVICE', 'Subscription cancelled', { subscriptionId });
    return this._getSubscriptionById(subscriptionId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Analytics
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get tier-based analytics: subscriber counts and total projected monthly revenue.
   *
   * @returns {Promise<Object[]>} Array of analytics objects per tier
   */
  async getTierAnalytics() {
    const rows = await Database.query(
      `SELECT
         st.id,
         st.name,
         st.amount,
         st.interval,
         COUNT(CASE WHEN ds.status = 'active' THEN 1 END)     AS activeSubscribers,
         COUNT(CASE WHEN ds.status = 'cancelled' THEN 1 END)  AS cancelledSubscribers,
         COUNT(ds.id)                                          AS totalSubscribers,
         COALESCE(SUM(CASE WHEN ds.status = 'active' THEN st.amount END), 0) AS activeRevenue
       FROM subscription_tiers st
       LEFT JOIN donor_subscriptions ds ON ds.tierId = st.id
       GROUP BY st.id
       ORDER BY st.amount ASC`
    );

    return rows.map((row) => ({
      tierId: row.id,
      name: row.name,
      amount: row.amount,
      interval: row.interval,
      activeSubscribers: row.activeSubscribers || 0,
      cancelledSubscribers: row.cancelledSubscribers || 0,
      totalSubscribers: row.totalSubscribers || 0,
      activeRevenue: parseFloat((row.activeRevenue || 0).toFixed(7)),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @private
   */
  async _getTierById(id) {
    const row = await Database.get('SELECT * FROM subscription_tiers WHERE id = ?', [id]);
    if (!row) {
      throw new NotFoundError(`Subscription tier ${id} not found`, ERROR_CODES.NOT_FOUND);
    }
    return this._formatTier(row);
  }

  /**
   * @private
   */
  async _getSubscriptionById(id) {
    const row = await Database.get(
      `SELECT ds.*, st.name AS tierName, st.amount AS tierAmount, st.interval AS tierInterval
       FROM donor_subscriptions ds
       JOIN subscription_tiers st ON ds.tierId = st.id
       WHERE ds.id = ?`,
      [id]
    );
    if (!row) throw new NotFoundError('Subscription not found', ERROR_CODES.NOT_FOUND);
    return this._formatSubscription(row);
  }

  /**
   * @private
   */
  _formatTier(row) {
    let benefits = row.benefits;
    try {
      if (benefits && benefits.startsWith('{')) benefits = JSON.parse(benefits);
    } catch (_) { /* keep as string */ }
    return {
      id: row.id,
      name: row.name,
      amount: row.amount,
      interval: row.interval,
      benefits,
      createdAt: row.createdAt,
    };
  }

  /**
   * @private
   */
  _formatSubscription(row) {
    return {
      id: row.id,
      donorId: row.donorId,
      tierId: row.tierId,
      tierName: row.tierName,
      tierAmount: row.tierAmount,
      tierInterval: row.tierInterval,
      recurringDonationId: row.recurringDonationId,
      status: row.status,
      createdAt: row.createdAt,
      cancelledAt: row.cancelledAt || null,
    };
  }
}

module.exports = SubscriptionTierService;
