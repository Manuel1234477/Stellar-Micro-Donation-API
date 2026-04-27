/**
 * Admin Reconciliation Routes
 *
 * RESPONSIBILITY: Expose reconciliation discrepancy report and manual resolution
 * OWNER: Backend Team
 */

'use strict';

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const serviceContainer = require('../../config/serviceContainer');

/**
 * GET /admin/reconciliation/report
 * Returns all transactions flagged as reconciliation_needed with counts.
 */
router.get('/report', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const service = serviceContainer.getTransactionReconciliationService();
    const { count, transactions } = service.getDiscrepancies();
    const status = service.getStatus();
    res.json({
      success: true,
      data: {
        discrepancyCount: count,
        transactions,
        serviceStatus: status,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/reconciliation/resolve/:txId
 * Manually resolve a flagged transaction by setting its status.
 *
 * Body: { status: 'confirmed' | 'failed' | 'cancelled' }
 */
router.post('/resolve/:txId', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const { txId } = req.params;
    const { status } = req.body || {};

    if (!status || typeof status !== 'string') {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: "'status' is required" },
      });
    }

    const service = serviceContainer.getTransactionReconciliationService();
    const updated = service.resolveDiscrepancy(txId, status);
    res.json({ success: true, data: updated });
  } catch (err) {
    if (err.message && err.message.startsWith('Transaction not found')) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: err.message },
      });
    }
    next(err);
  }
});

module.exports = router;
