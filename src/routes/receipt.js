/**
 * Donation Receipt Routes
 *
 * POST /donations/:id/receipt  - Generate and return a PDF receipt (optionally email it)
 * GET  /donations/:id/receipt/status - Check if a receipt has been generated
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');
const { TRANSACTION_STATES } = require('../utils/transactionStateMachine');
const AuditLogService = require('../services/AuditLogService');
const ReceiptService = require('../services/ReceiptService');
const Transaction = require('./models/transaction');

// In-memory receipt generation log (keyed by donation ID)
// Stores { generatedAt: ISO string, emailedTo: string|null }
const receiptLog = new Map();

/**
 * POST /donations/:id/receipt
 * Returns a PDF receipt for a confirmed donation.
 * Optionally emails it when `email` is provided in the request body.
 */
router.post('/:id/receipt', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email } = req.body || {};

    const donation = Transaction.getById(id);
    if (!donation) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    if (donation.status !== TRANSACTION_STATES.CONFIRMED) {
      throw new ValidationError(
        `Receipt can only be generated for confirmed donations. Current status: ${donation.status}`,
        null,
        ERROR_CODES.INVALID_REQUEST
      );
    }

    const pdfBuffer = await ReceiptService.generatePDF(donation);

    // Record receipt generation
    const generatedAt = new Date().toISOString();
    receiptLog.set(id, { generatedAt, emailedTo: email || null });

    // Optionally send email
    let emailResult = null;
    if (email) {
      emailResult = await ReceiptService.sendEmail({ transaction: donation, toEmail: email, pdfBuffer });
    }

    // Audit log
    await AuditLogService.log({
      category: AuditLogService.CATEGORY.FINANCIAL_OPERATION,
      action: 'RECEIPT_GENERATED',
      severity: AuditLogService.SEVERITY.LOW,
      result: 'SUCCESS',
      userId: req.apiKey && req.apiKey.id,
      requestId: req.id,
      ipAddress: req.ip,
      resource: `/donations/${id}/receipt`,
      details: {
        donationId: id,
        emailed: !!email,
        emailedTo: email || null,
        messageId: emailResult ? emailResult.messageId : null,
      },
    }).catch(() => {});

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    if (email) {
      res.set('X-Email-Message-Id', emailResult.messageId);
    }

    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /donations/:id/receipt/status
 * Returns whether a receipt has been generated for this donation.
 */
router.get('/:id/receipt/status', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { id } = req.params;

    const donation = Transaction.getById(id);
    if (!donation) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    const entry = receiptLog.get(id);
    res.json({
      success: true,
      data: {
        donationId: id,
        generated: !!entry,
        generatedAt: entry ? entry.generatedAt : null,
        emailedTo: entry ? entry.emailedTo : null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// Expose receiptLog for testing
router._receiptLog = receiptLog;

module.exports = router;
