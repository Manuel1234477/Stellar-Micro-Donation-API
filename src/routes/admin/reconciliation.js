/**
 * Admin Reconciliation Routes (Issue #67)
 *
 * POST /admin/reconciliation/run          - Trigger a background reconciliation job
 * GET  /admin/reconciliation/jobs/:jobId  - Poll job status
 * GET  /admin/reconciliation/jobs/:jobId/report - Fetch completed report
 *
 * Also retains:
 * GET  /admin/reconciliation/report       - Discrepancy report (existing)
 * POST /admin/reconciliation/resolve/:txId - Resolve a flagged transaction (existing)
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const serviceContainer = require('../../config/serviceContainer');

// ─── In-memory job store (TTL 7 days) ────────────────────────────────────────

const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const _jobs = new Map();

function createJob(walletId) {
  const jobId = `recon-${crypto.randomUUID()}`;
  _jobs.set(jobId, {
    jobId,
    status: 'queued',
    walletId: walletId || null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    report: null,
    error: null,
    _expiresAt: Date.now() + JOB_TTL_MS,
  });
  return jobId;
}

function getJob(jobId) {
  const job = _jobs.get(jobId);
  if (!job) return null;
  if (Date.now() > job._expiresAt) { _jobs.delete(jobId); return null; }
  return job;
}

/**
 * Run reconciliation and build the report object.
 * @param {object} service - TransactionReconciliationService instance
 * @returns {Promise<object>} report
 */
async function runReconciliation(service) {
  const result = await service.reconcile();

  // Build structured report from reconciliation result + discrepancies
  const { count: mismatchCount, transactions: discrepancyTxs } = service.getDiscrepancies();

  const discrepancies = discrepancyTxs.map(tx => ({
    transactionId: tx.id,
    localAmount: tx.amount,
    onChainAmount: null, // not available without per-tx Horizon lookup
    type: tx.reconciliation_reason || 'unknown',
  }));

  return {
    matched: result.corrected,
    mismatched: mismatchCount,
    onlyInDB: result.orphansDetected - result.orphansCompensated,
    onlyOnChain: result.orphansCompensated,
    discrepancies,
    raw: result,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * POST /admin/reconciliation/run
 * Triggers a background reconciliation job. Returns jobId immediately.
 * Query: ?walletId= (optional, for future per-wallet scoping)
 */
router.post('/run', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const walletId = req.query.walletId || null;
  const jobId = createJob(walletId);
  const job = getJob(jobId);

  // Run asynchronously — do not await
  setImmediate(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    try {
      const service = serviceContainer.getTransactionReconciliationService();
      job.report = await runReconciliation(service);
      job.status = 'completed';
    } catch (err) {
      job.status = 'failed';
      job.error = err.message;
    } finally {
      job.completedAt = new Date().toISOString();
    }
  });

  return res.status(202).json({ success: true, data: { jobId } });
});

/**
 * GET /admin/reconciliation/jobs/:jobId
 * Returns job status: queued | running | completed | failed
 */
router.get('/jobs/:jobId', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job not found or expired' } });
  }
  const { report: _r, _expiresAt: _e, ...summary } = job;
  return res.json({ success: true, data: summary });
});

/**
 * GET /admin/reconciliation/jobs/:jobId/report
 * Returns the full reconciliation report for a completed job.
 */
router.get('/jobs/:jobId/report', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job not found or expired' } });
  }
  if (job.status !== 'completed') {
    return res.status(409).json({ success: false, error: { code: 'JOB_NOT_COMPLETE', message: `Job status is '${job.status}'` } });
  }
  return res.json({ success: true, data: job.report });
});

// ─── Existing endpoints (retained) ───────────────────────────────────────────

/**
 * GET /admin/reconciliation/report
 * Returns all transactions flagged as reconciliation_needed.
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
 * Manually resolve a flagged transaction.
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
