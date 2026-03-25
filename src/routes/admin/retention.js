/**
 * Admin Retention Routes
 *
 * RESPONSIBILITY: Admin endpoints for data retention status and manual triggers
 * OWNER: Backend Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const retentionService = require('../../services/RetentionService');

/**
 * GET /admin/retention/status
 * Returns current retention configuration and record counts per data type.
 */
router.get('/status', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const status = await retentionService.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/retention/run
 * Manually trigger a full retention run (admin only).
 */
router.post('/run', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const result = await retentionService.runAll();
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
