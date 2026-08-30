/**
 * /api/v2/corporate-matching - Standardized Envelope Endpoints (#1553)
 *
 * Same corporate matching programs as the admin v1 endpoints (#1550),
 * reshaped into the v2 { data, meta } / { data } envelope.
 *
 * @openapi
 * tags:
 *   - name: V2 Corporate Matching
 *     description: /api/v2 corporate matching program endpoints (admin-only), using the standardized envelope (Issue #1553)
 *
 * /api/v2/corporate-matching:
 *   get:
 *     tags: [V2 Corporate Matching]
 *     summary: List corporate matching programs (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, paused, exhausted] }
 *       - in: query
 *         name: sponsor_id
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Matching programs.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { type: object } }
 *                 meta: { $ref: '#/components/schemas/V2ListMeta' }
 *
 * /api/v2/corporate-matching/{id}:
 *   get:
 *     tags: [V2 Corporate Matching]
 *     summary: Get a single corporate matching program (v2 envelope)
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: The matching program.
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
const { requireAdmin } = require('../../middleware/rbac');
const asyncHandler = require('../../utils/asyncHandler');
const CorporateMatchingService = require('../../services/CorporateMatchingService');

/**
 * GET /api/v2/corporate-matching
 * List response: { data: [...], meta: { total, page, pageSize, cursor } }
 */
router.get('/', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const { status, sponsor_id } = req.query;
  const filters = {};
  if (status) filters.status = status;
  if (sponsor_id) filters.sponsor_id = parseInt(sponsor_id, 10);

  const programs = await CorporateMatchingService.getAll(filters);
  res.v2List(programs, { total: programs.length, page: 1, pageSize: programs.length || null, cursor: null });
}));

/**
 * GET /api/v2/corporate-matching/:id
 * Single-resource response: { data: {...} }
 */
router.get('/:id', requireApiKey, requireAdmin(), asyncHandler(async (req, res) => {
  const program = await CorporateMatchingService.getById(parseInt(req.params.id, 10));
  res.v2Data(program);
}));

module.exports = router;
