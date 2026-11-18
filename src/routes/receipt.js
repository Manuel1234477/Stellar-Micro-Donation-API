/**
 * Donation Receipt Routes
 *
 * GET  /donations/annual-summary             - Generate annual summary PDF for a donor wallet
 * (GET /donations/:id/receipt is served by routes/donations/notes.js)
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
const TaxReceiptService = require('../services/TaxReceiptService');
const Transaction = require('../models/transaction');
const asyncHandler = require('../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../middleware/payloadSizeLimiter');
// Counts through the shared rate limit store (#1777)
const { sharedRateLimit } = require('../middleware/rateLimiter');
const Database = require('../utils/database');

// ── Annual summary rate limiter ───────────────────────────────────────────────
// PDF generation is CPU-intensive; restrict to 10 requests per 15 minutes per IP
const annualSummaryRateLimiter = sharedRateLimit({
  storePrefix: 'annualSummary',
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many annual summary requests. Please wait 15 minutes before trying again.',
    },
  },
});

// ── Sequential receipt counter ────────────────────────────────────────────────

/**
 * Generate a unique, sequential receipt number backed by the database.
 * @param {string|number} donationId
 * @returns {Promise<string>} e.g. "RCP-000042-<id>"
 */
async function _nextReceiptNumber(donationId) {
  const row = await Database.get(
    `UPDATE receipt_sequence SET seq = seq + 1 WHERE id = 1 RETURNING seq`
  );
  // Fallback for SQLite versions that don't support RETURNING
  const seq = row ? row.seq : (await Database.get('SELECT seq FROM receipt_sequence WHERE id = 1')).seq;
  return `RCP-${String(seq).padStart(6, '0')}-${donationId}`;
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

/**
 * GET /donations/annual-summary
 * Generate and download an annual tax receipt summary PDF for a donor wallet.
 *
 * Query parameters:
 *   walletAddress - Donor's Stellar public key (required)
 *   year          - Calendar year (required, e.g. 2026)
 *   format        - "json" returns JSON data instead of PDF
 *
 * Rate-limited to 10 requests per 15 minutes to prevent expensive PDF abuse.
 * Requires: donations:read permission.
 */
router.get('/annual-summary',
  requireApiKey,
  checkPermission(PERMISSIONS.DONATIONS_READ),
  annualSummaryRateLimiter,
  asyncHandler(async (req, res) => {
    const { walletAddress, format } = req.query;
    const yearRaw = req.query.year;

    if (!walletAddress) {
      throw new ValidationError(
        'walletAddress query parameter is required',
        null,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    if (!yearRaw) {
      throw new ValidationError(
        'year query parameter is required',
        null,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    const year = parseInt(yearRaw, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      throw new ValidationError(
        'year must be a valid calendar year (2000–2100)',
        null,
        ERROR_CODES.VALIDATION_ERROR
      );
    }

    // JSON format — return structured summary data
    if ((format || '').toLowerCase() === 'json') {
      const summary = await TaxReceiptService.getAnnualSummaryData({ walletAddress, year });
      return res.json({ success: true, data: summary });
    }

    // PDF format
    const pdfBuffer = await TaxReceiptService.generateAnnualSummaryPDF({ walletAddress, year });

    log.info('RECEIPT_ROUTE', 'Annual summary PDF generated', {
      walletAddress: walletAddress.slice(0, 8) + '...',
      year,
      size: pdfBuffer.length,
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="annual-summary-${year}-${walletAddress.slice(0, 8)}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });

    return res.send(pdfBuffer);
  })
);

// Add log import used in the route above
const log = require('../utils/log');

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
    await Database.run(
      `INSERT OR REPLACE INTO receipt_log (donation_id, generated_at, emailed_to)
       VALUES (?, ?, ?)`,
      [id, generatedAt, email || null]
    );

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
router.get('/:id/receipt/status', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), asyncHandler(async (req, res, next) => {
  try {
    const { id } = req.params;

    const donation = Transaction.getById(id);
    if (!donation) {
      throw new NotFoundError('Donation not found', ERROR_CODES.DONATION_NOT_FOUND);
    }

    const entry = await Database.get(
      'SELECT generated_at, emailed_to FROM receipt_log WHERE donation_id = ?',
      [id]
    );
    res.json({
      success: true,
      data: {
        donationId: id,
        generated: !!entry,
        generatedAt: entry ? entry.generated_at : null,
        emailedTo: entry ? entry.emailed_to : null,
      },
    });
  } catch (err) {
    next(err);
  }
}));

module.exports = router;
