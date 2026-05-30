'use strict';

/**
 * Admin Traces Routes - Distributed Tracing (issue #632)
 *
 * RESPONSIBILITY: Expose in-memory trace store for debugging
 * OWNER: Platform Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const { getTrace, getTraces, getTraceCount } = require('../../utils/tracing');

/**
 * GET /admin/traces
 * Return summaries for all stored traces.
 * Supports ?status=error and ?operation=<name> filters.
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const filters = {};
    if (req.query.status) filters.status = req.query.status;
    if (req.query.operation) filters.operation = req.query.operation;

    const traces = getTraces(filters);
    res.json({ success: true, data: traces, count: traces.length, total: getTraceCount() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/traces/:traceId
 * Retrieve the full span tree for a stored trace by its W3C trace ID.
 */
router.get('/:traceId', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res, next) => {
  try {
    const { traceId } = req.params;
    const trace = getTrace(traceId);

    if (!trace) {
      return res.status(404).json({
        success: false,
        error: { message: 'Trace not found', code: 'TRACE_NOT_FOUND' },
      });
    }

    res.json({ success: true, data: trace });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
