'use strict';

/**
 * Operations Route Handlers
 *
 * Admin-only observability, audit-log, reconciliation and sync handlers that
 * used to be defined inline in src/bootstrap/routes.js (#1780). Bootstrap
 * mounts them behind rbac.requireAdmin(); this module only holds the logic.
 */

const asyncHandler = require('../utils/asyncHandler');
const { parseCursorPaginationQuery } = require('../utils/pagination');
const AuditLogService = require('../services/AuditLogService');
const Database = require('../utils/database');

// Audit logs — #796: mandatory pagination, default 50, max 500
const AUDIT_LOG_DEFAULT_LIMIT = 50;
const AUDIT_LOG_MAX_LIMIT = 500;

function abuseSignals(req, res) {
  const abuseDetector = require('../utils/abuseDetector');
  res.json({ success: true, data: abuseDetector.getStats(), timestamp: new Date().toISOString() });
}

function suspiciousPatterns(req, res) {
  const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');
  res.json({ success: true, data: suspiciousPatternDetector.getMetrics(), timestamp: new Date().toISOString() });
}

function listBlockedIps(req, res) {
  const abuseDetectionService = require('../services/AbuseDetectionService');
  res.json({ success: true, data: abuseDetectionService.getBlocked(), timestamp: new Date().toISOString() });
}

function unblockIp(req, res) {
  const abuseDetectionService = require('../services/AbuseDetectionService');
  const ip = req.params.ip;
  const unblocked = abuseDetectionService.unblock(ip);
  if (unblocked) {
    res.json({ success: true, message: 'IP unblocked', ip, timestamp: new Date().toISOString() });
  } else {
    res.status(404).json({
      success: false,
      error: { code: 'IP_NOT_BLOCKED', message: 'IP not currently blocked' },
      timestamp: new Date().toISOString(),
    });
  }
}

const auditLogs = asyncHandler(async (req, res, next) => {
  try {
    let limit = AUDIT_LOG_DEFAULT_LIMIT;
    if (req.query.limit !== undefined) {
      const parsed = parseInt(req.query.limit, 10);
      if (isNaN(parsed) || parsed < 1) {
        return res.status(400).json({ success: false, error: { code: 'INVALID_LIMIT', message: 'limit must be a positive integer' } });
      }
      if (parsed > AUDIT_LOG_MAX_LIMIT) {
        return res.status(400).json({ success: false, error: { code: 'LIMIT_TOO_LARGE', message: `limit cannot exceed ${AUDIT_LOG_MAX_LIMIT}` } });
      }
      limit = parsed;
    }

    const VALID_CATEGORIES = new Set(Object.values(AuditLogService.CATEGORY));
    const VALID_SEVERITIES = new Set(Object.values(AuditLogService.SEVERITY));
    if (req.query.category && !VALID_CATEGORIES.has(req.query.category)) {
      return res.status(400).json({ success: false, error: 'Invalid category value' });
    }
    if (req.query.severity && !VALID_SEVERITIES.has(req.query.severity)) {
      return res.status(400).json({ success: false, error: 'Invalid severity value' });
    }

    const pagination = parseCursorPaginationQuery({ ...req.query, limit: String(limit) });
    pagination.limit = limit;

    const filters = {
      category: req.query.category,
      action: req.query.action,
      severity: req.query.severity,
      userId: req.query.actorId || req.query.userId,
      requestId: req.query.requestId,
      startDate: req.query.from || req.query.startDate,
      endDate: req.query.to || req.query.endDate,
    };

    const result = await AuditLogService.queryPaginated(filters, pagination);
    res.setHeader('X-Total-Count', String(result.totalCount));
    res.json({
      success: true,
      data: result.data,
      count: result.data.length,
      pagination: {
        limit,
        cursor: result.meta.next_cursor || null,
        hasMore: result.meta.next_cursor !== null,
        total: result.totalCount,
      },
      meta: result.meta,
    });
  } catch (error) {
    next(error);
  }
});

function createReconcileHandler(reconciliationService) {
  return asyncHandler(async (req, res, next) => {
    try {
      if (reconciliationService.reconciliationInProgress) {
        return res.status(409).json({ success: false, error: 'Reconciliation already in progress' });
      }
      const result = await reconciliationService.reconcile();
      res.json({ success: true, message: 'Reconciliation complete', data: result, timestamp: new Date().toISOString() });
    } catch (error) {
      next(error);
    }
  });
}

function createOrphanedTransactionsHandler(reconciliationService) {
  return asyncHandler(async (req, res, next) => {
    try {
      const rows = await Database.query(
        'SELECT id, senderId, receiverId, amount, memo, timestamp, stellar_tx_id FROM transactions WHERE is_orphan = 1 ORDER BY timestamp DESC',
        []
      );
      res.json({
        success: true,
        data: { count: rows.length, transactions: rows, lifetimeDetected: reconciliationService.getOrphanedTransactionCount() },
        timestamp: new Date().toISOString(),
      });
    } catch (error) { next(error); }
  });
}

function createSyncHandler(transactionSyncScheduler) {
  return asyncHandler(async (req, res, next) => {
    try {
      const result = await transactionSyncScheduler.syncAllWallets();
      res.json({ success: true, message: 'Transaction sync complete', data: result });
    } catch (error) { next(error); }
  });
}

module.exports = {
  abuseSignals,
  suspiciousPatterns,
  listBlockedIps,
  unblockIp,
  auditLogs,
  createReconcileHandler,
  createOrphanedTransactionsHandler,
  createSyncHandler,
  AUDIT_LOG_DEFAULT_LIMIT,
  AUDIT_LOG_MAX_LIMIT,
};
