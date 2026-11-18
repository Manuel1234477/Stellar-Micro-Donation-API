'use strict';

const express = require('express');
const router = express.Router();
const asyncHandler = require('../utils/asyncHandler');
const requireApiKey = require('../middleware/apiKey');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
const Pledge = require('../models/Pledge');
const PledgeFulfillmentService = require('../services/PledgeFulfillmentService');

const VALID_CONDITION_TYPES = ['campaign_goal_percent', 'date', 'manual'];

function toNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const error = new Error(`${label} must be a positive number`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function normalizeConditionType(value) {
  const candidate = (value ?? 'campaign_goal_percent').toString().trim();
  if (!VALID_CONDITION_TYPES.includes(candidate)) {
    const error = new Error(`Unsupported condition_type. Supported: ${VALID_CONDITION_TYPES.join(', ')}`);
    error.status = 400;
    throw error;
  }
  return candidate;
}

function normalizeConditionValue(type, value) {
  if (type === 'manual') {
    return null;
  }
  if (type === 'campaign_goal_percent') {
    if (value === undefined || value === null || value === '') {
      const error = new Error('condition_value is required for campaign_goal_percent');
      error.status = 400;
      throw error;
    }
    const threshold = Number(value);
    if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
      const error = new Error('campaign_goal_percent condition_value must be between 1 and 100');
      error.status = 400;
      throw error;
    }
    return String(threshold);
  }

  if (type === 'date') {
    if (value === undefined || value === null || value === '') {
      const error = new Error('condition_value is required for date');
      error.status = 400;
      throw error;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const error = new Error('condition_value must be a valid ISO date string');
      error.status = 400;
      throw error;
    }
    return value;
  }

  return value ?? null;
}

router.get('/', asyncHandler(async (req, res, next) => {
  try {
    const { status } = req.query;
    const pledges = await Pledge.listAll(status ? { status } : {});
    res.json({ success: true, data: pledges });
  } catch (error) {
    next(error);
  }
}));

router.post('/', requireApiKey, payloadSizeLimiter(ENDPOINT_LIMITS.campaign), asyncHandler(async (req, res, next) => {
  try {
    const {
      campaign_id,
      campaignId,
      donor_wallet_id,
      donorWalletId,
      amount,
      recipient_public_key,
      recipientPublicKey,
      recipient,
      condition_type,
      conditionType,
      condition_value,
      conditionValue,
      trigger_type,
      triggerType,
      trigger_value,
      triggerValue,
      expires_at,
      expiresAt,
    } = req.body || {};

    const resolvedCampaignId = campaign_id ?? campaignId ?? null;
    const resolvedDonorWalletId = donor_wallet_id ?? donorWalletId;
    const resolvedRecipient = recipient_public_key ?? recipientPublicKey ?? recipient ?? null;
    const resolvedConditionType = normalizeConditionType(condition_type ?? conditionType ?? trigger_type ?? triggerType ?? 'campaign_goal_percent');
    const resolvedConditionValue = normalizeConditionValue(
      resolvedConditionType,
      condition_value ?? conditionValue ?? trigger_value ?? triggerValue ?? null
    );

    if (!resolvedDonorWalletId || typeof resolvedDonorWalletId !== 'string') {
      return res.status(400).json({ success: false, error: 'donor_wallet_id is required' });
    }

    const numericAmount = toNumber(amount, 'amount');

    const pledge = await Pledge.create({
      campaign_id: resolvedCampaignId,
      donor_wallet_id: resolvedDonorWalletId,
      recipient_public_key: resolvedRecipient,
      amount: numericAmount,
      condition_type: resolvedConditionType,
      condition_value: resolvedConditionValue,
      expires_at: expires_at ?? expiresAt ?? null,
    });

    if (pledge && pledge.campaign_id) {
      await PledgeFulfillmentService.checkAndFulfill(pledge);
    }

    const hydrated = await Pledge.findById(pledge.id);
    return res.status(201).json({ success: true, data: hydrated });
  } catch (error) {
    if (error && error.status) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    next(error);
  }
}));

router.get('/:id', asyncHandler(async (req, res, next) => {
  try {
    const pledge = await Pledge.findById(req.params.id);
    if (!pledge) {
      return res.status(404).json({ success: false, error: 'Pledge not found' });
    }

    const response = {
      ...pledge,
      condition_status: pledge.condition_status || 'pending',
      is_fulfilled: pledge.status === 'fulfilled',
      is_pending: pledge.status === 'pending',
      is_expired: pledge.status === 'expired',
      is_cancelled: pledge.status === 'cancelled',
    };

    return res.json({ success: true, data: response });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
