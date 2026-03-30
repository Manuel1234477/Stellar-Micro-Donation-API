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
const { getTrace, getTraceCount } = require('../../utils/tracing');

/**
 * GET /admin/traces/:traceId
 * Retrieve a stored trace by its W3C trace ID.
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

/**
 * GET /admin/traces
 * Return the number of traces currently stored.
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), (req, res) => {
  res.json({ success: true, data: { count: getTraceCount() } });
});

module.exports = router;
