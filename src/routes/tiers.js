/**
 * Subscription Tier Routes - API Endpoint Layer
 *
 * RESPONSIBILITY: HTTP request handling for tier management and donor enrollment
 * OWNER: Backend Team
 * DEPENDENCIES: SubscriptionTierService, middleware (auth, RBAC)
 *
 * Endpoints:
 *   POST  /tiers                    – create a tier (admin)
 *   GET   /tiers                    – list all tiers (authenticated)
 *   POST  /tiers/:id/subscribe      – subscribe a donor to a tier
 *   DELETE /tiers/subscriptions/:subId – cancel a subscription
 *   GET   /tiers/analytics          – tier analytics (admin)
 */

'use strict';

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const SubscriptionTierService = require('../services/SubscriptionTierService');
const serviceContainer = require('../config/serviceContainer');
const AuditLogService = require('../services/AuditLogService');

/** Lazy singleton — avoids circular-require issues at module load time */
function getTierService() {
  return new SubscriptionTierService(serviceContainer.getRecurringDonationScheduler());
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /tiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /tiers
 * @desc    Create a new subscription tier
 * @access  admin (ADMIN_ALL)
 *
 * @body {string} name              - Unique tier name (e.g. "Gold")
 * @body {number} amount            - XLM amount per interval
 * @body {string} [interval]        - daily | weekly | monthly (default: monthly)
 * @body {string|Object} [benefits] - Free-form benefits description
 */
router.post('/', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const { name, amount, interval, benefits } = req.body;
    const tier = await getTierService().createTier({ name, amount, interval, benefits });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.CONFIGURATION,
      action: 'SUBSCRIPTION_TIER_CREATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/tiers/${tier.id}`,
      details: { tierId: tier.id, name: tier.name, amount: tier.amount },
    }).catch(() => {});

    res.status(201).json({ success: true, data: tier });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /tiers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /tiers
 * @desc    List all subscription tiers
 * @access  donations:read
 */
router.get('/', checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const tiers = await getTierService().listTiers();
    res.json({ success: true, data: tiers, count: tiers.length });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /tiers/analytics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /tiers/analytics
 * @desc    Tier analytics: subscriber counts and revenue per tier
 * @access  stats:admin
 */
router.get('/analytics', checkPermission(PERMISSIONS.STATS_ADMIN), async (req, res, next) => {
  try {
    const analytics = await getTierService().getTierAnalytics();

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.DATA_ACCESS,
      action: 'TIER_ANALYTICS_ACCESSED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/tiers/analytics',
      details: {},
    }).catch(() => {});

    res.json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /tiers/:id/subscribe
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   POST /tiers/:id/subscribe
 * @desc    Subscribe a donor to a tier (creates a recurring donation schedule)
 * @access  stream:create
 *
 * @param {string} id                    - Tier ID
 * @body  {string} donorPublicKey        - Donor's Stellar public key
 * @body  {string} recipientPublicKey    - Recipient's Stellar public key
 * @body  {string} [startDate]           - ISO date for first execution
 */
router.post('/:id/subscribe', checkPermission(PERMISSIONS.STREAM_CREATE), async (req, res, next) => {
  try {
    const tierId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tierId) || tierId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid tier ID' });
    }

    const { donorPublicKey, recipientPublicKey, startDate } = req.body;

    if (!donorPublicKey || !recipientPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: donorPublicKey, recipientPublicKey',
      });
    }

    const subscription = await getTierService().subscribe({
      tierId,
      donorPublicKey,
      recipientPublicKey,
      startDate,
    });

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'TIER_SUBSCRIPTION_CREATED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/tiers/${tierId}/subscribe`,
      details: {
        subscriptionId: subscription.id,
        tierId,
        recurringDonationId: subscription.recurringDonationId,
      },
    }).catch(() => {});

    res.status(201).json({ success: true, data: subscription });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /tiers/subscriptions/:subId
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   DELETE /tiers/subscriptions/:subId
 * @desc    Cancel a donor subscription (also cancels the recurring donation)
 * @access  stream:delete
 */
router.delete('/subscriptions/:subId', checkPermission(PERMISSIONS.STREAM_DELETE), async (req, res, next) => {
  try {
    const subId = parseInt(req.params.subId, 10);
    if (!Number.isInteger(subId) || subId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid subscription ID' });
    }

    const subscription = await getTierService().cancelSubscription(subId);

    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'TIER_SUBSCRIPTION_CANCELLED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      userId: req.user && req.user.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/tiers/subscriptions/${subId}`,
      details: { subscriptionId: subId },
    }).catch(() => {});

    res.json({ success: true, data: subscription });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// GET /tiers/features  (public — no auth required)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @route   GET /tiers/features
 * @desc    List all subscription tiers with their features and limits (public)
 * @access  Public
 */
router.get('/features', (req, res) => {
  const { TIER_FEATURES, TIER_ORDER } = require('../config/permissionMatrix');
  const data = TIER_ORDER.map(tier => ({
    tier,
    ...TIER_FEATURES[tier],
  }));
  res.json({ success: true, data });
});
