/**
 * Donation Receipt Routes
 *
 * GET  /donations/:id/receipt        - Download a PDF receipt (or JSON with ?format=json)
 * POST /donations/:id/receipt        - Generate and return a PDF receipt (optionally email it)
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
const Transaction = require('../models/transaction');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');

// ── Sequential receipt counter ────────────────────────────────────────────────
let _receiptSequence = 0;

/**
 * Generate a unique, sequential receipt number.
 * @param {string|number} donationId
 * @returns {string} e.g. "RCP-000042"
 */
function _nextReceiptNumber(donationId) {
  _receiptSequence += 1;
  return `RCP-${String(_receiptSequence).padStart(6, '0')}-${donationId}`;
}

/**
 * Attempt to look up the current XLM/USD rate.
 * Returns null silently when the price oracle is unavailable.
 *
 * @returns {Promise<number|null>}
 */
async function _getUsdRate() {
  try {
    const priceOracle = require('../services/PriceOracleService');
    const rates = await priceOracle.getRates();
    return (rates && rates.usd) ? Number(rates.usd) : null;
  } catch (_err) {
    return null;
  }
}

// In-memory receipt generation log (keyed by donation ID)
// Stores { generatedAt: ISO string, emailedTo: string|null }
const receiptLog = new Map();

/**
 * GET /donations/:id/receipt
 * Download a PDF receipt for a donation.
 *
 * Query parameters:
 *   format=json  - Return receipt data as JSON instead of a PDF file
 *   fullKey=true - Include unmasked public keys (default: masked)
 *
 * Behaviour for unconfirmed donations:
 *   The receipt is generated but watermarked "PENDING CONFIRMATION".
 *
 * Requires: donations:read permission.
 */
router.get('/:id/receipt', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;
    const format = (req.query.format || '').toLowerCase();
    const maskKeys = req.query.fullKey !== 'true';

    const donation = Transaction.getById(id);
    if (!donation) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    const isPending = donation.status !== TRANSACTION_STATES.CONFIRMED;
    const receiptNumber = _nextReceiptNumber(id);
    const usdRate = await _getUsdRate();
    const usdAmount = (usdRate != null && donation.amount != null)
      ? Number((Number(donation.amount) * usdRate).toFixed(2))
      : null;

    const explorerUrl = donation.stellarTxId
      ? `${process.env.STELLAR_EXPLORER_URL || 'https://stellar.expert/explorer/testnet/tx'}/${donation.stellarTxId}`
      : null;

    const maskedDonor = maskKeys
      ? ReceiptService.maskPublicKey(donation.donor)
      : (donation.donor || 'Anonymous');
    const maskedRecipient = maskKeys
      ? ReceiptService.maskPublicKey(donation.recipient)
      : (donation.recipient || 'N/A');

    // ── JSON format ────────────────────────────────────────────────────────
    if (format === 'json') {
      return res.json({
        success: true,
        data: {
          receiptNumber,
          donationDate: donation.timestamp,
          amountXLM: donation.amount,
          amountUSD: usdAmount,
          donorPublicKey: maskedDonor,
          recipientPublicKey: maskedRecipient,
          transactionHash: donation.stellarTxId || null,
          confirmationStatus: isPending ? 'PENDING CONFIRMATION' : 'CONFIRMED',
          explorerUrl,
        },
      });
    }

    // ── PDF format ─────────────────────────────────────────────────────────
    const pdfBuffer = await ReceiptService.generatePDF(donation, {
      maskKeys,
      isPending,
      receiptNumber,
      usdAmount,
    });

    receiptLog.set(id, { generatedAt: new Date().toISOString(), emailedTo: null });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="receipt-${id}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    return res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /donations/:id/receipt
 * Returns a PDF receipt for a confirmed donation.
 * Optionally emails it when `email` is provided in the request body.
 */
router.post('/:id/receipt', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), payloadSizeLimiter(ENDPOINT_LIMITS.singleDonation), asyncHandler(async (req, res, next) => {
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
}));

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
