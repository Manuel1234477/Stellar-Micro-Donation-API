/**
 * /api/v2/wallets - Standardized Envelope Endpoints (#1553)
 *
 * Same underlying wallet records as /api/v1/wallets, reshaped into the v2
 * { data, meta } / { data } / { error } envelope.
 *
 * @openapi
 * tags:
 *   - name: V2 Wallets
 *     description: /api/v2 wallet endpoints, using the standardized envelope (Issue #1553)
 *
 * /api/v2/wallets:
 *   get:
 *     tags: [V2 Wallets]
 *     summary: List wallets (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: A page of wallets.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 meta: { $ref: '#/components/schemas/V2ListMeta' }
 *
 * /api/v2/wallets/{id}:
 *   get:
 *     tags: [V2 Wallets]
 *     summary: Get a single wallet (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The wallet.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: object }
 *       404:
 *         $ref: '#/components/responses/V2Error'
 */

'use strict';

const express = require('express');
const router = express.Router();
const requireApiKey = require('../../middleware/apiKey');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { NotFoundError, ValidationError, ERROR_CODES } = require('../../utils/errors');
const asyncHandler = require('../../utils/asyncHandler');
const Database = require('../../utils/database');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/v2/wallets
 * List response: { data: [...], meta: { total, page, pageSize, cursor } }
 */
router.get('/', requireApiKey, checkPermission(PERMISSIONS.WALLETS_READ), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const [{ total }, rows] = await Promise.all([
    Database.get('SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL'),
    Database.query(
      'SELECT id, publicKey, createdAt, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE deleted_at IS NULL ORDER BY id ASC LIMIT ? OFFSET ?',
      [pageSize, offset]
    ),
  ]);

  const hasMore = offset + rows.length < total;
  const cursor = hasMore ? Buffer.from(String(offset + pageSize)).toString('base64') : null;

  res.v2List(rows, { total, page, pageSize, cursor });
}));

/**
 * GET /api/v2/wallets/:id
 * Single-resource response: { data: {...} }
 */
router.get('/:id', requireApiKey, checkPermission(PERMISSIONS.WALLETS_READ), asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new ValidationError('Wallet id must be an integer', null, ERROR_CODES.INVALID_REQUEST);
  }

  const wallet = await Database.get(
    'SELECT id, publicKey, createdAt, daily_limit, monthly_limit, per_transaction_limit FROM users WHERE id = ? AND deleted_at IS NULL',
    [id]
  );
  if (!wallet) {
    throw new NotFoundError('Wallet not found', ERROR_CODES.WALLET_NOT_FOUND);
  }
  res.v2Data(wallet);
}));

module.exports = router;
