const { bestEffort } = require('../../utils/bestEffort');
/**
 * Admin Scheduler Routes
 *
 * RESPONSIBILITY: Admin endpoints for scheduler status and control
 * OWNER: Backend Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const asyncHandler = require('../../utils/asyncHandler');
const { payloadSizeLimiter, ENDPOINT_LIMITS } = require('../../middleware/payloadSizeLimiter');
const AuditLogService = require('../../services/AuditLogService');

/**
 * GET /admin/scheduler/status
 * Returns detailed scheduler status including running state, last tick info, and next execution time.
 */
router.get('/status', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const serviceContainer = require('../../config/serviceContainer');
    const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();
    const status = recurringDonationScheduler.getDetailedStatus();
    
    res.json({
      success: true,
      data: status,
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/scheduler/pause
 * Pause the scheduler (stops executing ticks) without stopping the server process.
 * Idempotent - pausing an already-paused scheduler returns success.
 */
router.post('/pause', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const serviceContainer = require('../../config/serviceContainer');
    const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();
    
    const wasPaused = recurringDonationScheduler.isPaused();
    recurringDonationScheduler.pause();
    
    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.SYSTEM,
      action: 'SCHEDULER_PAUSED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/admin/scheduler/pause',
      details: {
        wasPaused,
      },
    }).catch(bestEffort('src/routes/admin/scheduler.js:60'));

    res.json({
      success: true,
      data: {
        paused: true,
        message: wasPaused ? 'Scheduler was already paused' : 'Scheduler paused successfully',
      },
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * POST /admin/scheduler/resume
 * Resume a paused scheduler.
 * Idempotent - resuming a running scheduler returns success.
 */
router.post('/resume', checkPermission(PERMISSIONS.ADMIN_ALL), payloadSizeLimiter(ENDPOINT_LIMITS.admin), asyncHandler(async (req, res, next) => {
  try {
    const serviceContainer = require('../../config/serviceContainer');
    const recurringDonationScheduler = serviceContainer.getRecurringDonationScheduler();
    
    const wasPaused = recurringDonationScheduler.isPaused();
    recurringDonationScheduler.resume();
    
    // Audit log
    AuditLogService.log({
      category: AuditLogService.CATEGORY.SYSTEM,
      action: 'SCHEDULER_RESUMED',
      severity: AuditLogService.SEVERITY.MEDIUM,
      result: 'SUCCESS',
      requestId: req.id,
      ipAddress: req.ip,
      resource: '/admin/scheduler/resume',
      details: {
        wasPaused,
      },
    }).catch(bestEffort('src/routes/admin/scheduler.js:99'));

    res.json({
      success: true,
      data: {
        resumed: true,
        message: wasPaused ? 'Scheduler resumed successfully' : 'Scheduler was already running',
      },
    });
  } catch (err) {
    next(err);
  }
}));

module.exports = router;
