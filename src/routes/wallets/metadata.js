/**
 * Wallet Routes - Metadata Management
 *
 * RESPONSIBILITY: Wallet CRUD operations (get, update, delete)
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, AuditLogService
 */

const express = require('express');
const router = express.Router();
const { checkPermission, requireAdmin } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');
const { toWalletResponse } = require('../../utils/responseSanitizer');
const { cacheMiddleware } = require('../../middleware/caching');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const Database = require('../../utils/database');
const WalletService = require('../../services/WalletService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const { getStellarService } = require('../../config/stellar');
const {
  walletIdSchema,
  updateWalletSchema,
  updateWalletLabelSchema,
} = require('./helpers');

const walletService = new WalletService();

// ─── GET /:id ────────────────────────────────────────────────────────────
/**
 * Retrieve wallet details with ETag caching support
 */
router.get(
  '/:id',
  checkPermission(PERMISSIONS.WALLETS_READ),
  walletIdSchema,
  cacheMiddleware('wallet', 'private'),
  asyncHandler(async (req, res, next) => {
    try {
      const wallet = await Database.get(
        'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL',
        [req.params.id]
      );
      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }

      // ETag and conditional request support
      const lastModifiedDate = new Date(wallet.updatedAt || wallet.createdAt);
      const etag = `"${wallet.id}-${lastModifiedDate.getTime()}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', lastModifiedDate.toUTCString());
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }
      if (req.headers['if-modified-since']) {
        const ifModifiedSince = new Date(req.headers['if-modified-since']);
        if (!isNaN(ifModifiedSince.getTime()) && lastModifiedDate <= ifModifiedSince) {
          return res.status(304).end();
        }
      }

      const stellarSvc = getStellarService();
      const homeDomain = await stellarSvc.getHomeDomain(wallet.publicKey).catch(() => null);
      res.json({ success: true, data: toWalletResponse({ ...wallet, homeDomain: homeDomain || null }) });
    } catch (error) {
      next(error);
    }
  })
);

// ─── PATCH /:id/label ────────────────────────────────────────────────────
/**
 * Update the label for a wallet
 * Body: { "label": "string" } — null or empty string clears the label
 */
router.patch(
  '/:id/label',
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  walletIdSchema,
  updateWalletLabelSchema,
  payloadSizeLimiter(ENDPOINT_LIMITS.wallet),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { label } = req.body;

      if (!Object.prototype.hasOwnProperty.call(req.body, 'label')) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: "'label' field is required" },
        });
      }

      const newLabel = (label === null || label === '') ? null : String(label);
      if (newLabel !== null && newLabel.length > 100) {
        return res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'label must not exceed 100 characters' },
        });
      }

      const wallet = await walletService.updateWallet(id, { label: newLabel });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: AuditLogService.ACTION.WALLET_UPDATED,
        severity: AuditLogService.SEVERITY.LOW,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${id}/label`,
        details: { walletId: id, label: newLabel },
      });

      res.json({ success: true, data: toWalletResponse(wallet) });
    } catch (error) {
      next(error);
    }
  })
);

// ─── PATCH /:id ──────────────────────────────────────────────────────────
/**
 * Update wallet metadata (label, ownerName)
 */
router.patch(
  '/:id',
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  updateWalletSchema,
  payloadSizeLimiter(ENDPOINT_LIMITS.wallet),
  asyncHandler(async (req, res, next) => {
    try {
      const { label, ownerName } = req.body;

      if (!label && !ownerName) {
        return res.status(400).json(
          buildErrorResponse([{ code: 'MISSING_WALLET_FIELD', receivedValue: undefined }])
        );
      }

      const wallet = await walletService.updateWallet(req.params.id, { label, ownerName });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: AuditLogService.ACTION.WALLET_UPDATED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${req.params.id}`,
        details: { walletId: req.params.id, updates: { label, ownerName } }
      });

      res.json({ success: true, data: toWalletResponse(wallet) });
    } catch (error) {
      next(error);
    }
  })
);

// ─── DELETE /:id ─────────────────────────────────────────────────────────
/**
 * Soft delete a wallet (blocks if active recurring donations exist)
 */
router.delete(
  '/:id',
  checkPermission(PERMISSIONS.WALLETS_DELETE),
  walletIdSchema,
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const wallet = await walletService.getWalletById(id);

      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }

      // Check for active recurring donations
      const activeRecurring = await Database.get(
        'SELECT id FROM recurring_donations WHERE walletId = ? AND status = ? LIMIT 1',
        [id, 'active']
      );

      if (activeRecurring) {
        return res.status(409).json({
          success: false,
          error: 'Cannot delete wallet with active recurring donations'
        });
      }

      await walletService.deleteWallet(id);

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: AuditLogService.ACTION.WALLET_DELETED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${id}`,
        details: { walletId: id }
      });

      res.json({ success: true, message: 'Wallet deleted successfully' });
    } catch (error) {
      next(error);
    }
  })
);

// ─── GET /admin/deleted ──────────────────────────────────────────────────
/**
 * List soft-deleted wallets (admin only)
 */
router.get(
  '/admin/deleted',
  requireAdmin(),
  asyncHandler(async (req, res, next) => {
    try {
      const deleted = await Database.all(
        'SELECT * FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100'
      );

      res.json({
        success: true,
        data: {
          wallets: (deleted || []).map(toWalletResponse),
        },
        count: deleted.length
      });
    } catch (error) {
      next(error);
    }
  })
);

// ─── POST /admin/wallets/:id/restore ──────────────────────────────────────
/**
 * Restore a soft-deleted wallet (admin only)
 */
router.post(
  '/admin/:id/restore',
  requireAdmin(),
  walletIdSchema,
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const wallet = await Database.get(
        'SELECT id, publicKey, label FROM users WHERE id = ?',
        [id]
      );

      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }

      if (!wallet.deleted_at) {
        return res.status(400).json({ success: false, error: 'Wallet is not deleted' });
      }

      await Database.run(
        'UPDATE users SET deleted_at = NULL WHERE id = ?',
        [id]
      );

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: AuditLogService.ACTION.WALLET_RESTORED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${id}/restore`,
        details: { walletId: id }
      });

      const restored = await walletService.getWalletById(id);
      res.json({ success: true, data: toWalletResponse(restored) });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
