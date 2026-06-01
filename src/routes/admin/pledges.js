'use strict';

/**
 * Admin Pledge Routes
 *
 * RESPONSIBILITY: Admin endpoints for viewing and managing donation pledges.
 * OWNER: Backend Team
 *
 * Endpoints:
 *   GET    /admin/pledges           — list all pledges (supports ?status= filter)
 *   PATCH  /admin/pledges/:id/fulfil  — manually fulfil a pending pledge
 *   PATCH  /admin/pledges/:id/cancel  — cancel a pending pledge with a reason
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const asyncHandler = require('../../utils/asyncHandler');
const Pledge = require('../../models/Pledge');
const PledgeFulfillmentService = require('../../services/PledgeFulfillmentService');
const WebhookService = require('../../services/WebhookService');
const AuditLogService = require('../../services/AuditLogService');
const log = require('../../utils/log');

const VALID_STATUSES = ['pending', 'fulfilled', 'cancelled', 'expired'];

/**
 * GET /admin/pledges
 * List all pledges. Supports optional ?status= filter.
 *
 * Query params:
 *   status  — one of: pending | fulfilled | cancelled | expired
 *
 * Response: { success: true, data: Pledge[] }
 */
router.get(
  '/',
  checkPermission(PERMISSIONS.ADMIN_ALL),
  asyncHandler(async (req, res, next) => {
    try {
      const { status } = req.query;

      if (status !== undefined && !VALID_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
          },
        });
      }

      const pledges = await Pledge.listAll(status ? { status } : {});

      return res.json({
        success: true,
        data: pledges,
      });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * PATCH /admin/pledges/:id/fulfil
 * Manually mark a pledge as fulfilled and trigger the donation transaction.
 * Only pending pledges can be fulfilled.
 *
 * Response: { success: true, data: { pledge, fulfilled } }
 */
router.patch(
  '/:id/fulfil',
  checkPermission(PERMISSIONS.ADMIN_ALL),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;

      const pledge = await Pledge.findById(id);
      if (!pledge) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Pledge not found' },
        });
      }

      if (pledge.status !== 'pending') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: `Pledge cannot be fulfilled — current status is '${pledge.status}'`,
          },
        });
      }

      // Trigger campaign-level fulfillment (atomically fulfills all pending pledges
      // for the campaign if the goal is met, or fulfills this pledge individually).
      let fulfillResult = { fulfilled: 0 };
      if (pledge.campaign_id) {
        fulfillResult = await PledgeFulfillmentService.checkAndFulfill(pledge.campaign_id);
      }

      // If checkAndFulfill didn't pick it up (goal not yet reached), fulfil this
      // specific pledge directly so the admin action always takes effect.
      const refreshed = await Pledge.findById(id);
      if (refreshed && refreshed.status === 'pending') {
        await require('../../utils/database').run(
          `UPDATE pledges SET status = 'fulfilled' WHERE id = ? AND status = 'pending'`,
          [id]
        );
        WebhookService.deliver('pledge.fulfilled', { pledge: { ...refreshed, status: 'fulfilled' } }).catch(() => {});
        fulfillResult = { fulfilled: fulfillResult.fulfilled + 1 };
      }

      const updated = await Pledge.findById(id);

      AuditLogService.log({
        category: AuditLogService.CATEGORY.SYSTEM,
        action: 'PLEDGE_FULFILLED',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/admin/pledges/${id}/fulfil`,
        details: { pledgeId: id, campaignId: pledge.campaign_id },
      }).catch(() => {});

      log.info('ADMIN_PLEDGES', `Admin fulfilled pledge ${id}`);

      return res.json({
        success: true,
        data: { pledge: updated, fulfilled: fulfillResult.fulfilled },
      });
    } catch (err) {
      next(err);
    }
  })
);

/**
 * PATCH /admin/pledges/:id/cancel
 * Cancel a pending pledge with an optional reason.
 * Only pending pledges can be cancelled.
 *
 * Body: { reason?: string }
 * Response: { success: true, data: { pledge } }
 */
router.patch(
  '/:id/cancel',
  checkPermission(PERMISSIONS.ADMIN_ALL),
  asyncHandler(async (req, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body || {};

      const pledge = await Pledge.findById(id);
      if (!pledge) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Pledge not found' },
        });
      }

      if (pledge.status !== 'pending') {
        return res.status(409).json({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: `Pledge cannot be cancelled — current status is '${pledge.status}'`,
          },
        });
      }

      const result = await Pledge.cancel(id, reason || null);

      if (!result.changes) {
        // Race condition: another process changed the status between our read and write
        return res.status(409).json({
          success: false,
          error: {
            code: 'INVALID_STATE',
            message: 'Pledge could not be cancelled — it may have already changed status',
          },
        });
      }

      const updated = await Pledge.findById(id);

      WebhookService.deliver('pledge.cancelled', { pledge: updated }).catch(() => {});

      AuditLogService.log({
        category: AuditLogService.CATEGORY.SYSTEM,
        action: 'PLEDGE_CANCELLED',
        severity: AuditLogService.SEVERITY.MEDIUM,
        result: 'SUCCESS',
        requestId: req.id,
        ipAddress: req.ip,
        resource: `/admin/pledges/${id}/cancel`,
        details: { pledgeId: id, reason: reason || null },
      }).catch(() => {});

      log.info('ADMIN_PLEDGES', `Admin cancelled pledge ${id}`, { reason });

      return res.json({
        success: true,
        data: { pledge: updated },
      });
    } catch (err) {
      next(err);
    }
  })
);

module.exports = router;
