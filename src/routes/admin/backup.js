'use strict';

/**
 * Admin Backup Routes
 *
 * RESPONSIBILITY: Admin endpoints for database backup and restore operations
 * OWNER: Backend Team
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const BackupService = require('../../services/BackupService');
const requestCounter = require('../../utils/requestCounter');
const asyncHandler = require('../../utils/asyncHandler');

const router = express.Router();
const backupService = new BackupService();

// In-memory store for short-lived restore confirmation tokens { backupId -> { token, expiresAt } }
const confirmTokens = new Map();
const CONFIRM_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * POST /backup
 * Trigger an immediate encrypted database backup.
 * Returns: { backupId, path, sizeBytes, createdAt }
 */
router.post('/backup', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const result = await backupService.backup();
    return res.status(201).json({
      success: true,
      data: {
        backupId: result.backupId,
        path: result.filePath,
        sizeBytes: result.size,
        createdAt: result.createdAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /admin/backup/status
 * Show the last backup time and verification result.
 */
router.get('/status', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res, next) => {
  try {
    const backups = await backupService.listBackups();
    const lastBackup = backups.length > 0 ? backups[0] : null;
    res.json({
      success: true,
      data: {
        lastBackupTime: lastBackup ? lastBackup.createdAt : null,
        lastBackupId: lastBackup ? lastBackup.backupId : null,
        lastVerification: backupService.lastVerification,
      },
    });
  } catch (err) {
    next(err);
  }
}));

/**
 * GET /backups
 * List all available backup files with metadata.
 */
router.get('/backups', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const backups = await backupService.listBackups();
    const shaped = backups.map((b) => ({
      backupId: b.backupId,
      path: b.filePath,
      sizeBytes: b.size,
      createdAt: b.createdAt,
    }));
    return res.json({ success: true, data: shaped });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /backups/:backupId/download
 * Stream the encrypted backup file to the client.
 */
router.get('/backups/:backupId/download', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const { backupId } = req.params;

    // Sanitize backupId to prevent path traversal
    if (!/^[\w.-]+$/.test(backupId)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid backupId' } });
    }

    const backupDir = backupService.backupDir;
    const filePath = path.join(backupDir, `${backupId}.enc`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Backup not found' } });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${backupId}.enc"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /backup/restore/:backupId/confirm
 * Generate a short-lived confirmation token required to initiate a restore.
 * Returns: { confirmationToken, expiresAt }
 */
router.post('/backup/restore/:backupId/confirm', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const { backupId } = req.params;

    if (!/^[\w.-]+$/.test(backupId)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid backupId' } });
    }

    const backupDir = backupService.backupDir;
    const filePath = path.join(backupDir, `${backupId}.enc`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Backup not found' } });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + CONFIRM_TOKEN_TTL_MS).toISOString();

    confirmTokens.set(backupId, { token, expiresAt: Date.now() + CONFIRM_TOKEN_TTL_MS });

    return res.status(200).json({ success: true, data: { confirmationToken: token, expiresAt } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /backup/restore/:backupId
 * Restore the database from a specific backup.
 * Requires { confirmationToken } in the request body.
 * Returns HTTP 409 if there are active in-flight requests (excluding this one).
 */
router.post('/backup/restore/:backupId', checkPermission(PERMISSIONS.ADMIN_ALL), async (req, res, next) => {
  try {
    const { backupId } = req.params;
    const { confirmationToken } = req.body || {};

    if (!/^[\w.-]+$/.test(backupId)) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid backupId' } });
    }

    if (!confirmationToken) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'confirmationToken is required. Call POST /admin/backup/restore/:backupId/confirm first.',
        },
      });
    }

    // Validate the confirmation token
    const stored = confirmTokens.get(backupId);
    if (!stored || stored.token !== confirmationToken || Date.now() > stored.expiresAt) {
      confirmTokens.delete(backupId);
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_CONFIRMATION_TOKEN', message: 'Confirmation token is invalid or has expired' },
      });
    }

    // Block restore if there are other in-flight requests (> 1 to exclude this request itself)
    if (requestCounter.getCount() > 1) {
      return res.status(409).json({
        success: false,
        error: {
          code: 'RESTORE_BLOCKED',
          message: 'Cannot restore while there are active in-flight requests. Retry when the server is idle.',
        },
      });
    }

    // Consume the token — single-use
    confirmTokens.delete(backupId);

    const result = await backupService.restore(backupId);
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.message && err.message.includes('not found')) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: err.message } });
    }
    next(err);
  }
});

module.exports = router;
