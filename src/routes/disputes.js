/**
 * Disputes Routes
 *
 * RESPONSIBILITY: Donation dispute workflow endpoints
 * OWNER: Backend Team
 * DEPENDENCIES: Database, middleware (auth, RBAC), WebhookService
 *
 * Allows recipients to dispute donations and admins to resolve disputes.
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const Database = require('../utils/database');
const asyncHandler = require('../utils/asyncHandler');
const log = require('../utils/log');
const AuditLogService = require('../services/AuditLogService');
const WebhookService = require('../services/WebhookService');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

const DISPUTE_WINDOW_DAYS = parseInt(process.env.DISPUTE_WINDOW_DAYS || '30', 10);

/**
 * POST /donations/:id/dispute
 * Create a dispute for a donation.
 * Only the recipient can open a dispute within the dispute window.
 */
router.post('/:id/dispute', checkPermission(PERMISSIONS.DONATIONS_WRITE), payloadSizeLimiter(ENDPOINT_LIMITS.donation), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason, evidence } = req.body;

    // Validate input
    if (!reason || typeof reason !== 'string' || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REASON',
          message: 'Reason is required and must be a non-empty string',
          requestId: req.id,
        },
      });
    }

    if (evidence && typeof evidence !== 'string') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_EVIDENCE',
          message: 'Evidence must be a string',
          requestId: req.id,
        },
      });
    }

    if (evidence && evidence.length > 1000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'EVIDENCE_TOO_LONG',
          message: 'Evidence must not exceed 1000 characters',
          requestId: req.id,
        },
      });
    }

    // Get the donation
    const donation = await Database.get(
      'SELECT * FROM transactions WHERE id = ?',
      [id]
    );

    if (!donation) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DONATION_NOT_FOUND',
          message: 'Donation not found',
          requestId: req.id,
        },
      });
    }

    // Get recipient public key
    const recipient = await Database.get(
      'SELECT publicKey FROM users WHERE id = ?',
      [donation.receiverId]
    );

    if (!recipient) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'RECIPIENT_NOT_FOUND',
          message: 'Recipient not found',
          requestId: req.id,
        },
      });
    }

    // Verify the user is the recipient
    if (req.apiKey && req.apiKey.publicKey !== recipient.publicKey) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only the recipient can dispute a donation',
          requestId: req.id,
        },
      });
    }

    // Check if dispute window has passed
    const donationDate = new Date(donation.timestamp);
    const windowExpiry = new Date(donationDate.getTime() + DISPUTE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    if (new Date() > windowExpiry) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'DISPUTE_WINDOW_EXPIRED',
          message: `Disputes can only be opened within ${DISPUTE_WINDOW_DAYS} days of the donation`,
          requestId: req.id,
        },
      });
    }

    // Check if dispute already exists
    const existingDispute = await Database.get(
      'SELECT id FROM disputes WHERE donationId = ?',
      [id]
    );

    if (existingDispute) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'DISPUTE_EXISTS',
          message: 'A dispute already exists for this donation',
          requestId: req.id,
        },
      });
    }

    // Create dispute
    const result = await Database.run(
      `INSERT INTO disputes (donationId, recipientPublicKey, reason, evidence, status)
       VALUES (?, ?, ?, ?, 'open')`,
      [id, recipient.publicKey, reason.trim(), evidence ? evidence.trim() : null]
    );

    const dispute = await Database.get(
      'SELECT * FROM disputes WHERE id = ?',
      [result.id]
    );

    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.DONATION,
      action: 'DISPUTE_OPENED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/donations/${id}/dispute`,
      details: {
        donationId: id,
        disputeId: dispute.id,
        reason: reason.substring(0, 100),
      },
    }).catch(() => {});

    // Emit webhook event
    WebhookService.deliver('donation.disputed', {
      donationId: id,
      disputeId: dispute.id,
      reason,
      recipientPublicKey: recipient.publicKey,
      timestamp: new Date().toISOString(),
    }).catch(() => {});

    res.status(201).json({
      success: true,
      data: {
        id: dispute.id,
        donationId: dispute.donationId,
        status: dispute.status,
        reason: dispute.reason,
        evidence: dispute.evidence,
        createdAt: dispute.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * PATCH /admin/disputes/:id
 * Update dispute status (admin only).
 * Allowed transitions: open -> under_review, under_review -> resolved_refund | resolved_no_action
 */
router.patch('/:id', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, resolutionNotes } = req.body;

    // Validate status
    const validStatuses = ['open', 'under_review', 'resolved_refund', 'resolved_no_action'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Status must be one of: ${validStatuses.join(', ')}`,
          requestId: req.id,
        },
      });
    }

    // Get dispute
    const dispute = await Database.get(
      'SELECT * FROM disputes WHERE id = ?',
      [id]
    );

    if (!dispute) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DISPUTE_NOT_FOUND',
          message: 'Dispute not found',
          requestId: req.id,
        },
      });
    }

    // Update dispute
    const now = new Date().toISOString();
    const resolvedAt = status.startsWith('resolved_') ? now : null;

    await Database.run(
      `UPDATE disputes SET status = ?, resolutionNotes = ?, resolvedAt = ?, updatedAt = ? WHERE id = ?`,
      [status, resolutionNotes || null, resolvedAt, now, id]
    );

    const updated = await Database.get(
      'SELECT * FROM disputes WHERE id = ?',
      [id]
    );

    // If resolving as refund, trigger refund workflow
    if (status === 'resolved_refund') {
      const donation = await Database.get(
        'SELECT * FROM transactions WHERE id = ?',
        [dispute.donationId]
      );

      if (donation) {
        // Emit refund webhook event
        WebhookService.deliver('donation.refund_requested', {
          donationId: donation.id,
          disputeId: id,
          reason: 'Dispute resolution - refund approved',
          amount: donation.amount,
          timestamp: new Date().toISOString(),
        }).catch(() => {});
      }
    }

    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.DONATION,
      action: 'DISPUTE_RESOLVED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/admin/disputes/${id}`,
      details: {
        disputeId: id,
        donationId: dispute.donationId,
        newStatus: status,
      },
    }).catch(() => {});

    res.json({
      success: true,
      data: {
        id: updated.id,
        donationId: updated.donationId,
        status: updated.status,
        reason: updated.reason,
        resolutionNotes: updated.resolutionNotes,
        resolvedAt: updated.resolvedAt,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /admin/disputes
 * List all disputes (admin only).
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM disputes';
    const params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const disputes = await Database.query(query, params);

    res.json({
      success: true,
      data: disputes,
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /admin/disputes/:id
 * Get a specific dispute (admin only).
 */
router.get('/:id', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;

    const dispute = await Database.get(
      'SELECT * FROM disputes WHERE id = ?',
      [id]
    );

    if (!dispute) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'DISPUTE_NOT_FOUND',
          message: 'Dispute not found',
          requestId: req.id,
        },
      });
    }

    res.json({
      success: true,
      data: dispute,
    });
  } catch (err) {
    next(err);
  }
}));

module.exports = router;
