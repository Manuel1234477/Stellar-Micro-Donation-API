/**
 * /api/v2/donations - Standardized Envelope Endpoints (#1553)
 *
 * Same underlying donation ledger as /api/v1/donations, reshaped into the
 * v2 { data, meta } / { data } / { error } envelope. See utils/responseFormatter.js.
 *
 * @openapi
 * tags:
 *   - name: V2 Donations
 *     description: /api/v2 donation endpoints, using the standardized envelope (Issue #1553)
 *
 * /api/v2/donations:
 *   get:
 *     tags: [V2 Donations]
 *     summary: List donations (v2 envelope)
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
 *         description: A page of donations.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 meta: { $ref: '#/components/schemas/V2ListMeta' }
 *       401:
 *         $ref: '#/components/responses/V2Error'
 *
 * /api/v2/donations/{id}:
 *   get:
 *     tags: [V2 Donations]
 *     summary: Get a single donation (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The donation.
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
const { NotFoundError, ERROR_CODES } = require('../../utils/errors');
const asyncHandler = require('../../utils/asyncHandler');
const Transaction = require('../../models/transaction');

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * GET /api/v2/donations
 * List response: { data: [...], meta: { total, page, pageSize, cursor } }
 */
router.get('/', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(req.query.pageSize, 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const result = Transaction.getPaginated({ limit: pageSize, offset });
  const nextOffset = offset + pageSize;
  const cursor = result.pagination.hasMore ? Buffer.from(String(nextOffset)).toString('base64') : null;

  res.v2List(result.data, {
    total: result.pagination.total,
    page,
    pageSize,
    cursor,
  });
}));

/**
 * GET /api/v2/donations/:id
 * Single-resource response: { data: {...} }
 */
router.get('/:id', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res) => {
  const donation = Transaction.getById(req.params.id);
  if (!donation) {
    throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
  }
  res.v2Data(donation);
}));

module.exports = router;
