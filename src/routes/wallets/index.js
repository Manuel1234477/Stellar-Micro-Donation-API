/**
 * Wallet Routes - Index Router
 *
 * RESPONSIBILITY: Core wallet CRUD operations (create, list, bulk import, funding)
 * OWNER: Backend Team
 * DEPENDENCIES: WalletService, middleware (auth, RBAC)
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { parseCsvSync } = require('csv-parse/sync');
const { checkPermission, requireAdmin } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { buildErrorResponse } = require('../../utils/validationErrorFormatter');
const { toWalletResponse } = require('../../utils/responseSanitizer');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const asyncHandler = require('../../utils/asyncHandler');
const { parseCursorPaginationQuery } = require('../../utils/pagination');
const { bulkImportRateLimiter, friendbotRateLimiter } = require('../../middleware/rateLimiter');
const { cacheMiddleware } = require('../../middleware/caching');
const Database = require('../../utils/database');
const Wallet = require('../../models/wallet');
const WalletService = require('../../services/WalletService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');
const requireApiKey = require('../../middleware/apiKey');
const { getStellarService } = require('../../config/stellar');
const { walletCreateSchema, walletIdSchema } = require('./helpers');

const walletService = new WalletService(getStellarService());

// ─── Helper Functions ────────────────────────────────────────────────────

function getBulkMaxBytes() {
  const parsed = parseInt(process.env.BULK_IMPORT_MAX_SIZE_BYTES || '1048576', 10);
  return isNaN(parsed) ? 1048576 : parsed;
}

function getBulkMaxRows() {
  const parsed = parseInt(process.env.BULK_IMPORT_MAX_ROWS || '1000', 10);
  return isNaN(parsed) ? 1000 : parsed;
}

// ─── POST /wallets ───────────────────────────────────────────────────────
/**
 * Create wallet metadata
 * Body: { address: string (required), label?: string, ownerName?: string, sponsored?: boolean }
 * Requires wallets:create permission
 */
router.post(
  '/',
  payloadSizeLimiter(ENDPOINT_LIMITS.wallet),
  checkPermission(PERMISSIONS.WALLETS_CREATE),
  walletCreateSchema,
  asyncHandler(async (req, res, next) => {
    try {
      const { address, label, ownerName, sponsored } = req.body;

      if (!address) {
        return res.status(400).json(
          buildErrorResponse([{ code: 'MISSING_ADDRESS', receivedValue: address }])
        );
      }

      // Validate Stellar public key format using the Stellar SDK
      const StellarSdk = require('stellar-sdk');
      if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
        const { formatError } = require('../../utils/errors');
        return res.status(400).json(formatError('INVALID_PUBLIC_KEY', 'Invalid Stellar public key format', req.id));
      }

      // Create wallet metadata
      const wallet = await walletService.createWallet({
        address,
        label,
        ownerName,
        sponsored: sponsored || false
      });

      await AuditLogService.log({
        category: AuditLogService.CATEGORY.WALLET_OPERATION,
        action: AuditLogService.ACTION.WALLET_CREATED,
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        userId: req.user && req.user.id,
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/wallets/${wallet.id}`,
        details: { address, funded: wallet.funded }
      });

      res.status(201).json({
        success: true,
        data: toWalletResponse(wallet)
      });
    } catch (error) {
      next(error);
    }
  })
);

// ─── GET /wallets ────────────────────────────────────────────────────────
/**
 * List wallets with cursor-based pagination
 * Query params:
 *   - limit: page size (default 20, max 100)
 *   - cursor: opaque pagination cursor
 *   - direction: 'next' | 'prev' (default 'next')
 *   - sort: 'id:asc'|'id:desc'|'createdAt:asc'|'createdAt:desc'|'publicKey:asc'|'publicKey:desc'
 */
router.get(
  '/',
  checkPermission(PERMISSIONS.WALLETS_READ),
  cacheMiddleware('wallet', 'private'),
  (req, res, next) => {
    try {
      const VALID_SORT = ['id:asc', 'id:desc', 'createdAt:asc', 'createdAt:desc', 'publicKey:asc', 'publicKey:desc'];
      const sort = req.query.sort || 'id:asc';
      if (!VALID_SORT.includes(sort)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_SORT',
            message: `Invalid sort value. Valid options: ${VALID_SORT.join(', ')}`,
          },
        });
      }

      const pagination = parseCursorPaginationQuery(req.query);
      const result = walletService.getPaginatedWallets(pagination, sort);

      res.setHeader('X-Total-Count', String(result.totalCount));

      res.json({
        success: true,
        data: result.data.map(toWalletResponse),
        count: result.data.length,
        total: result.totalCount,
        nextCursor: result.meta.next_cursor,
        meta: result.meta
      });
    } catch (error) {
      next(error);
    }
  }
);

// ─── POST /wallets/bulk-import ───────────────────────────────────────────
/**
 * Bulk import wallets from CSV file
 * Admin only, rate limited
 * File format: CSV with headers (address, label?, ownerName?)
 */
router.post(
  '/bulk-import',
  requireAdmin(),
  bulkImportRateLimiter,
  (req, res, next) => {
    const maxBytes = getBulkMaxBytes();
    const upload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxBytes },
    });
    upload.single('file')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = (maxBytes / (1024 * 1024)).toFixed(2);
        return res.status(413).json({
          success: false,
          error: {
            code: 'FILE_TOO_LARGE',
            message: `File exceeds the maximum allowed size of ${maxMB} MB (${maxBytes} bytes).`,
            details: { max_size_bytes: maxBytes },
          },
        });
      }
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FILE', message: 'A file upload is required (field: "file")' },
        });
      }

      let rows;
      try {
        rows = parseCsvSync(req.file.buffer, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
      } catch (parseErr) {
        return res.status(400).json({
          success: false,
          error: { code: 'PARSE_ERROR', message: `CSV parse error: ${parseErr.message}` },
        });
      }

      if (rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_FILE', message: 'CSV file contains no data rows' },
        });
      }

      const maxRows = getBulkMaxRows();
      if (rows.length > maxRows) {
        return res.status(422).json({
          success: false,
          error: {
            code: 'ROW_LIMIT_EXCEEDED',
            message: `File contains ${rows.length} rows which exceeds the maximum of ${maxRows}.`,
            details: { submitted: rows.length, limit: maxRows },
          },
        });
      }

      if (!Object.prototype.hasOwnProperty.call(rows[0], 'address')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_HEADER',
            message: 'CSV must have a header row with at least an "address" column',
          },
        });
      }

      let imported = 0;
      let skipped = 0;
      let failed = 0;
      const errors = [];

      const StellarSdk = require('stellar-sdk');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;
        const address = (row.address || '').trim();

        if (!address) {
          failed++;
          errors.push({ row: rowNum, address: '', reason: 'Missing address' });
          continue;
        }

        if (!StellarSdk.StrKey.isValidEd25519PublicKey(address)) {
          failed++;
          errors.push({ row: rowNum, address, reason: 'Invalid Stellar public key' });
          continue;
        }

        const existing = Wallet.getByAddress(address);
        if (existing) {
          skipped++;
          continue;
        }

        try {
          Wallet.create({
            address,
            label: row.label || null,
            ownerName: row.ownerName || null,
          });
          imported++;
        } catch (createErr) {
          failed++;
          errors.push({ row: rowNum, address, reason: createErr.message });
        }
      }

      return res.status(200).json({
        success: true,
        data: { imported, skipped, failed, errors },
      });
    } catch (error) {
      next(error);
    }
  })
);

// ─── POST /wallets/:id/fund ──────────────────────────────────────────────
/**
 * Fund a wallet via Stellar Friendbot (testnet only)
 * Rate limited to 5 requests per minute per API key
 */
router.post(
  '/:id/fund',
  requireApiKey,
  checkPermission(PERMISSIONS.WALLETS_UPDATE),
  walletIdSchema,
  friendbotRateLimiter,
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const force = req.query.force === 'true';

      const wallet = await Database.get(
        'SELECT id, publicKey FROM users WHERE id = ?',
        [id]
      );
      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }

      if (process.env.NODE_ENV === 'production') {
        return res.status(403).json({
          success: false,
          error: 'Friendbot funding is only available on testnet'
        });
      }

      const stellarService = getStellarService();
      try {
        const account = await stellarService.getAccount(wallet.publicKey);
        if (account.balances && account.balances.length > 0) {
          if (!force) {
            return res.status(400).json({
              success: false,
              error: 'Wallet is already funded. Use ?force=true to fund again'
            });
          }
        }
      } catch (err) {
        // Account not found, safe to fund
      }

      const result = await stellarService.fundAccountWithFriendbot(wallet.publicKey);
      return res.json({
        success: true,
        data: {
          walletId: wallet.id,
          publicKey: wallet.publicKey,
          funded: true,
          transactionHash: result.hash
        }
      });
    } catch (error) {
      next(error);
    }
  })
);

module.exports = router;
