'use strict';

/**
 * Admin Wallet Donation Limits Routes (#1484)
 *
 * RESPONSIBILITY: Admin CRUD for per-wallet donation limit overrides
 * OWNER: Backend Team
 * DEPENDENCIES: Wallet model, AuditLogService, RBAC middleware
 *
 * Endpoints (admin only):
 *   PATCH  /admin/wallets/:id/limits       - Set per-wallet donation limits
 *   GET    /admin/wallets/:id/limits       - Get current donation limits
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { requireAdmin } = require('../../middleware/rbac');
const Wallet = require('../../models/wallet');
const AuditLogService = require('../../services/AuditLogService');
const asyncHandler = require('../../utils/asyncHandler');

/**
 * PATCH /admin/wallets/:id/limits
 * Set per-wallet donation limit overrides (min/max amounts in stroops).
 * Passing null explicitly clears the corresponding limit so the wallet
 * falls back to global env settings.
 */
router.patch('/:id/limits', requireAdmin(), asyncHandler(async (req, res) => {
  const walletId = String(req.params.id).trim();
  const { donation_limit_min, donation_limit_max } = req.body;

  // Fetch the wallet to verify it exists
  const wallet = await Wallet.getById(walletId);
  if (!wallet) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'WALLET_NOT_FOUND',
        message: `Wallet ${walletId} not found`,
      }
    });
  }

  // Validate limit values: must be positive integers or null
  const validateLimit = (val, fieldName) => {
    if (val === null || val === undefined) return true;
    if (typeof val === 'number' && Number.isInteger(val) && val > 0) return true;
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_LIMIT_VALUE',
        message: `${fieldName} must be a positive integer or null, got: ${val}`
      }
    });
    return false;
  };

  if (!validateLimit(donation_limit_min, 'donation_limit_min')) return;
  if (!validateLimit(donation_limit_max, 'donation_limit_max')) return;

  // Resolve the effective values: explicit null clears the limit.
  const nextMin = donation_limit_min === undefined ? wallet.donation_limit_min : donation_limit_min;
  const nextMax = donation_limit_max === undefined ? wallet.donation_limit_max : donation_limit_max;

  // Validate min < max if both are set
  if (nextMin !== null && nextMin !== undefined &&
      nextMax !== null && nextMax !== undefined &&
      nextMin >= nextMax) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_LIMIT_RANGE',
        message: 'donation_limit_min must be less than donation_limit_max'
      }
    });
  }

  // Update the wallet with new limits (null clears the override)
  const updatedWallet = await Wallet.update(walletId, {
    donation_limit_min: nextMin,
    donation_limit_max: nextMax,
  });

  // Log the limit change to audit trail
  await AuditLogService.log({
    category: AuditLogService.CATEGORY.WALLET_MANAGEMENT,
    action: AuditLogService.ACTION.DONATION_LIMIT_OVERRIDE,
    severity: AuditLogService.SEVERITY.MEDIUM,
    result: 'SUCCESS',
    requestId: req.id,
    resource: `wallet:${walletId}`,
    reason: 'Admin updated per-wallet donation limits',
    details: {
      walletAddress: wallet.address,
      previous: {
        donation_limit_min: wallet.donation_limit_min,
        donation_limit_max: wallet.donation_limit_max,
      },
      updated: {
        donation_limit_min: updatedWallet.donation_limit_min,
        donation_limit_max: updatedWallet.donation_limit_max,
      },
    }
  }).catch(() => {
    // Non-blocking: audit log failure should not prevent the update
  });

  res.json({
    success: true,
    message: 'Wallet donation limits updated successfully',
    data: {
      walletId,
      address: updatedWallet.address,
      limits: {
        donation_limit_min: updatedWallet.donation_limit_min,
        donation_limit_max: updatedWallet.donation_limit_max,
      }
    }
  });
}));

/**
 * GET /admin/wallets/:id/limits
 * Retrieve current per-wallet donation limits.
 */
router.get('/:id/limits', requireAdmin(), asyncHandler(async (req, res) => {
  const walletId = String(req.params.id).trim();

  const wallet = await Wallet.getById(walletId);
  if (!wallet) {
    return res.status(404).json({
      success: false,
      error: {
        code: 'WALLET_NOT_FOUND',
        message: `Wallet ${walletId} not found`,
      }
    });
  }

  res.json({
    success: true,
    data: {
      walletId,
      address: wallet.address,
      limits: {
        donation_limit_min: wallet.donation_limit_min,
        donation_limit_max: wallet.donation_limit_max,
      }
    }
  });
}));

module.exports = router;
