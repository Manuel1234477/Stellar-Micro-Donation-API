'use strict';

/**
 * GET /admin/startup-report
 *
 * Returns the same structured diagnostics report that is emitted to the log at
 * startup (issue #1589).  Useful for operators who missed the startup log entry
 * or who need to inspect the running configuration on demand.
 *
 * Security: admin role required.  All sensitive values are masked before the
 * response leaves this handler (same masking applied at log time).
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../../middleware/rbac');
const asyncHandler = require('../../utils/asyncHandler');
const { buildStartupReport } = require('../../utils/startupDiagnostics');
const { createRateLimiter } = require('../../middleware/rateLimiter');

// Light rate-limiter — this is an admin diagnostic endpoint, not a hot path
const startupReportRateLimiter = process.env.NODE_ENV === 'test'
  ? (req, res, next) => next()
  : createRateLimiter({
      windowMs: 60 * 1000,
      max: 20,
      keyGenerator: (req) => req.apiKey?.id || req.ip,
    });

/**
 * GET /admin/startup-report
 *
 * Returns a structured JSON snapshot of the startup diagnostics report including:
 * - Application version, Node.js version
 * - Active feature flags, Stellar network configuration
 * - Rate limit settings, CORS origin count
 * - Database path and file size
 * - Process uptime and memory usage
 *
 * All sensitive values are masked.
 */
router.get(
  '/startup-report',
  requireAdmin(),
  startupReportRateLimiter,
  asyncHandler(async (req, res) => {
    const report = await buildStartupReport();

    res.status(200).json({
      success: true,
      data: report,
    });
  })
);

module.exports = router;
