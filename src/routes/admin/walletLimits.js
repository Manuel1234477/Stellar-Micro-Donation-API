'use strict';

/**
 * Admin Wallet Limits Routes
 *
 * RESPONSIBILITY: Admin CRUD for per-wallet donation limits.
 * OWNER: Backend Team
 * DEPENDENCIES: LimitService, Database, rbac middleware
 *
 * Endpoints (admin only):
 *   POST   /admin/wallets/:id/limits  - Set per-wallet limits
 *   PATCH  /admin/wallets/:id/limits  - Update per-wallet limits (null clears a limit)
 *   GET    /admin/wallets/:id/limits  - Get current limits
 *   DELETE /admin/wallets/:id/limits  - Reset to global defaults
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAdmin } = require('../../middleware/rbac');
const Database = require('../../utils/database');
const LimitService = require('../../services/LimitService');
const config = require('../../config');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');

/**
 * Validate a limit value: must be a positive finite number or null.
 * @param {*} val
 * @returns {string|null} error message or null if valid
 */
function validateLimitValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'number' || !isFinite(val) || val <= 0) {
    return 'must be a positive number or null';
  }
  return null;
}

/**
 * Resolve the requested limit fields from a request body, supporting both
 * naming conventions. Returns { limits, error } where limits only contains
 * keys that were explicitly provided (including explicit nulls to clear).
 * @param {object} body
 * @returns {{ limits: object, error: string|null }}
 */
function resolveLimits(body) {
  const { min_amount, max_amount, daily_cap, daily_limit, monthly_limit, per_transaction_limit } = body;

  const resolvedMax = max_amount !== undefined ? max_amount : per_transaction_limit;
  const resolvedDaily = daily_cap !== undefined ? daily_cap : daily_limit;
  const resolvedMonthly = monthly_limit;

  const fields = { per_transaction_limit: resolvedMax, daily_limit: resolvedDaily, monthly_limit: resolvedMonthly };
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined) continue;
    const err = validateLimitValue(val);
    if (err) {
      return { limits: null, error: `${key} ${err}` };
    }
  }

  // Validate min < max if both provided
  if (min_amount != null && resolvedMax != null && min_amount >= resolvedMax) {
    return { limits: null, error: 'min_amount must be less than max_amount' };
  }

  const limits = {};
  if (resolvedMax !== undefined) limits.per_transaction_limit = resolvedMax;
  if (resolvedDaily !== undefined) limits.daily_limit = resolvedDaily;
  if (resolvedMonthly !== undefined) limits.monthly_limit = resolvedMonthly;

  return { limits, error: null };
}

/**
 * POST /admin/wallets/:id/limits
 * Set per-wallet donation limits. Accepts any combination of:
 *   { min_amount, max_amount, daily_cap }
 * where min_amount maps to per_transaction_limit (min), max_amount to per_transaction_limit,
 * and daily_cap to daily_limit.
 */
router.post('/:id/limits', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid wallet ID' });
    }

    const wallet = await Database.get('SELECT id FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const { limits, error } = resolveLimits(req.body);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    if (Object.keys(limits).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one limit field is required (min_amount, max_amount, daily_cap, daily_limit, monthly_limit, per_transaction_limit)'
      });
    }

    await LimitService.setWalletLimits(walletId, limits);

    const updated = await Database.get(
      'SELECT id, publicKey, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
      [walletId]
    );

    res.status(201).json({
      success: true,
      message: 'Per-wallet limits set successfully',
      data: {
        walletId,
        limits: {
          per_transaction_limit: updated.per_transaction_limit,
          daily_limit: updated.daily_limit,
          monthly_limit: updated.monthly_limit,
        }
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * PATCH /admin/wallets/:id/limits
 * Update per-wallet donation limits. An explicit `null` for a field clears
 * that limit (removes the override), while omitted fields are left untouched.
 */
router.patch('/:id/limits', requireAdmin(), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid wallet ID' });
    }

    const wallet = await Database.get('SELECT id FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const { limits, error } = resolveLimits(req.body);
    if (error) {
      return res.status(400).json({ success: false, error });
    }

    if (Object.keys(limits).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least one limit field is required (min_amount, max_amount, daily_cap, daily_limit, monthly_limit, per_transaction_limit)'
      });
    }

    await LimitService.setWalletLimits(walletId, limits);

    const updated = await Database.get(
      'SELECT id, publicKey, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
      [walletId]
    );

    res.json({
      success: true,
      message: 'Per-wallet limits updated successfully',
      data: {
        walletId,
        limits: {
          per_transaction_limit: updated.per_transaction_limit,
          daily_limit: updated.daily_limit,
          monthly_limit: updated.monthly_limit,
        }
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * GET /admin/wallets/:id/limits
 * Retrieve current per-wallet limits (explicit + effective with global fallback).
 */
router.get('/:id/limits', requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid wallet ID' });
    }

    const wallet = await Database.get(
      'SELECT id, publicKey, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ?',
      [walletId]
    );
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    const globalMax = config.donations.maxAmount;
    const globalDailyMax = config.donations.maxDailyPerDonor;

    res.json({
      success: true,
      data: {
        walletId,
        publicKey: wallet.publicKey,
        explicit: {
          per_transaction_limit: wallet.per_transaction_limit,
          daily_limit: wallet.daily_limit,
          monthly_limit: wallet.monthly_limit,
        },
        effective: {
          per_transaction_limit: wallet.per_transaction_limit != null ? wallet.per_transaction_limit : globalMax,
          daily_limit: wallet.daily_limit != null ? wallet.daily_limit : (globalDailyMax > 0 ? globalDailyMax : null),
          monthly_limit: wallet.monthly_limit,
        },
        globalDefaults: {
          per_transaction_limit: globalMax,
          daily_limit: globalDailyMax > 0 ? globalDailyMax : null,
          monthly_limit: null,
        }
      }
    });
  } catch (error) {
    next(error);
  }
}));

/**
 * DELETE /admin/wallets/:id/limits
 * Reset per-wallet limits to global defaults (clears all explicit overrides).
 */
router.delete('/:id/limits', requireAdmin(), asyncHandler(async (req, res, next) => {
  try {
    const walletId = parseInt(req.params.id, 10);
    if (isNaN(walletId) || walletId < 1) {
      return res.status(400).json({ success: false, error: 'Invalid wallet ID' });
    }

    const wallet = await Database.get('SELECT id FROM users WHERE id = ?', [walletId]);
    if (!wallet) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    await LimitService.setWalletLimits(walletId, {
      per_transaction_limit: null,
      daily_limit: null,
      monthly_limit: null,
    });

    res.json({
      success: true,
      message: 'Per-wallet limits reset to global defaults',
      data: { walletId }
    });
  } catch (error) {
    next(error);
  }
}));

module.exports = router;
