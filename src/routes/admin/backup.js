/**
 * Admin Backup Routes
 *
 * RESPONSIBILITY: Admin endpoints for database backup and restore operations
 * OWNER: Backend Team
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const BackupService = require('../../services/BackupService');

const backupService = new BackupService();

/**
 * POST /admin/backup
 * Trigger an immediate encrypted database backup.
 */
router.post('/', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const result = await backupService.backup();
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/backups
 * List all available backups.
 */
router.get('/', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const backups = await backupService.listBackups();
    res.json({ success: true, data: backups });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /admin/restore/:backupId
 * Restore the database from a specific backup.
 */
router.post('/restore/:backupId', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const result = await backupService.restore(req.params.backupId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
