'use strict';

/**
 * Impact Reporting Routes
 *
 * RESPONSIBILITY: SDG-tagged donation impact reporting
 * ENDPOINTS:
 *   GET  /impact/sdg-breakdown        — totals and counts per SDG category
 *   GET  /impact/report               — full impact report for a date range
 *   POST /impact/report/export        — downloadable CSV or PDF report
 */

const express = require('express');
const router = express.Router();
const requireApiKey = require('../middleware/apiKey');
const { checkPermission } = require('../middleware/rbac');
const { PERMISSIONS } = require('../utils/permissions');
const Transaction = require('./models/transaction');
const { SDG_CATEGORIES, validateSdgCodes } = require('../services/ImpactMetricService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Filter transactions by optional date range.
 * @param {Array} txs
 * @param {string} [startDate]
 * @param {string} [endDate]
 * @returns {Array}
 */
function filterByDateRange(txs, startDate, endDate) {
  return txs.filter(tx => {
    const ts = new Date(tx.timestamp);
    if (startDate && ts < new Date(startDate)) return false;
    if (endDate && ts > new Date(endDate)) return false;
    return true;
  });
}

/**
 * Build SDG breakdown from a list of transactions.
 * @param {Array} txs
 * @returns {Array<{code, goal, title, totalAmount, count}>}
 */
function buildSdgBreakdown(txs) {
  const map = {};
  for (const sdg of SDG_CATEGORIES) {
    map[sdg.code] = { ...sdg, totalAmount: 0, count: 0 };
  }

  for (const tx of txs) {
    const cats = Array.isArray(tx.sdgCategories) ? tx.sdgCategories : [];
    for (const code of cats) {
      if (map[code]) {
        map[code].totalAmount += parseFloat(tx.amount) || 0;
        map[code].count += 1;
      }
    }
  }

  return Object.values(map);
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /impact/sdg-breakdown
 * Returns donation totals and counts per SDG category.
 * Query params: startDate, endDate (ISO date strings, optional)
 */
router.get('/sdg-breakdown', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const txs = filterByDateRange(Transaction.getAll(), startDate, endDate);
    const breakdown = buildSdgBreakdown(txs);

    res.json({
      success: true,
      data: {
        breakdown,
        totalDonations: txs.length,
        dateRange: { startDate: startDate || null, endDate: endDate || null },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /impact/report
 * Returns a structured impact report for the specified date range.
 * Query params: startDate, endDate (ISO date strings, optional)
 */
router.get('/report', checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const txs = filterByDateRange(Transaction.getAll(), startDate, endDate);
    const breakdown = buildSdgBreakdown(txs);

    const totalAmount = txs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);
    const taggedCount = txs.filter(tx => Array.isArray(tx.sdgCategories) && tx.sdgCategories.length > 0).length;
    const activeSdgs = breakdown.filter(s => s.count > 0);

    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        dateRange: { startDate: startDate || null, endDate: endDate || null },
        summary: {
          totalDonations: txs.length,
          totalAmount: parseFloat(totalAmount.toFixed(7)),
          taggedDonations: taggedCount,
          activeSdgCount: activeSdgs.length,
        },
        sdgBreakdown: breakdown,
        topSdgs: [...activeSdgs].sort((a, b) => b.totalAmount - a.totalAmount).slice(0, 5),
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /impact/report/export
 * Generate a downloadable CSV or PDF impact report.
 * Body: { format: 'csv' | 'pdf', startDate?, endDate? }
 * Default format: csv
 */
router.post('/report/export', requireApiKey, checkPermission(PERMISSIONS.DONATIONS_READ), (req, res, next) => {
  try {
    const { format = 'csv', startDate, endDate } = req.body || {};

    if (format !== 'csv' && format !== 'pdf') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'format must be "csv" or "pdf"' },
      });
    }

    const txs = filterByDateRange(Transaction.getAll(), startDate, endDate);
    const breakdown = buildSdgBreakdown(txs);
    const totalAmount = txs.reduce((sum, tx) => sum + (parseFloat(tx.amount) || 0), 0);

    if (format === 'csv') {
      const lines = [
        'SDG Code,Goal,Title,Total Amount (XLM),Donation Count',
        ...breakdown.map(s =>
          `${s.code},${s.goal},"${s.title}",${s.totalAmount.toFixed(7)},${s.count}`
        ),
        '',
        `Total,,All SDGs,${totalAmount.toFixed(7)},${txs.length}`,
      ];

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="impact-report-${Date.now()}.csv"`);
      return res.send(lines.join('\n'));
    }

    // PDF: return a minimal text-based PDF
    const reportText = [
      'Impact Report',
      `Generated: ${new Date().toISOString()}`,
      startDate ? `From: ${startDate}` : '',
      endDate ? `To: ${endDate}` : '',
      '',
      'SDG Breakdown:',
      ...breakdown.filter(s => s.count > 0).map(s =>
        `  ${s.code} - ${s.title}: ${s.totalAmount.toFixed(7)} XLM (${s.count} donations)`
      ),
      '',
      `Total: ${totalAmount.toFixed(7)} XLM across ${txs.length} donations`,
    ].filter(l => l !== undefined).join('\n');

    // Minimal valid PDF wrapping plain text
    const pdfContent = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${reportText.length + 50}>>\nstream\nBT /F1 10 Tf 50 750 Td (Impact Report) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\nxref\n0 6\ntrailer<</Size 6/Root 1 0 R>>\n%%EOF`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="impact-report-${Date.now()}.pdf"`);
    return res.send(Buffer.from(pdfContent));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
