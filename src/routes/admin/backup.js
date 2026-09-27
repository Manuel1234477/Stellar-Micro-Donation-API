'use strict';

/**
 * Admin Backup Routes
 *
 * RESPONSIBILITY: Admin endpoints for database backup and restore operations
 * OWNER: Backend Team
 *
 * Mounted at /admin/backups (see src/bootstrap/routes.js). The /admin tree is
 * guarded by requireApiKey + requireAdmin at the mount point; every route here
 * additionally requires the admin wildcard permission.
 *
 *   POST /admin/backups                             Trigger a backup
 *   GET  /admin/backups                             List backups
 *   GET  /admin/backups/status                      Last backup + verification
 *   POST /admin/backups/:backupId/verify            Re-verify a backup
 *   GET  /admin/backups/:backupId/download          Download encrypted backup
 *   POST /admin/backups/restore/:backupId/confirm   Issue restore confirmation token
 *   POST /admin/backups/restore/:backupId           Restore (requires token)
 */

/**
 * @openapi
 * tags:
 *   - name: AdminBackups
 *     description: Encrypted database backup and restore (admin only)
 *
 * /admin/backups:
 *   post:
 *     tags: [AdminBackups]
 *     summary: Trigger an immediate encrypted database backup
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '201':
 *         description: Backup created
 *       '401':
 *         description: Missing or invalid API key
 *       '403':
 *         description: Admin role required
 *   get:
 *     tags: [AdminBackups]
 *     summary: List available backups (newest first)
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '200':
 *         description: Backup list
 *       '401':
 *         description: Missing or invalid API key
 *       '403':
 *         description: Admin role required
 *
 * /admin/backups/status:
 *   get:
 *     tags: [AdminBackups]
 *     summary: Show the last backup time and verification result
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       '200':
 *         description: Backup status
 *
 * /admin/backups/{backupId}/verify:
 *   post:
 *     tags: [AdminBackups]
 *     summary: Run integrity and row-count verification against a backup
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Verification result
 *       '400':
 *         description: Invalid backupId
 *       '404':
 *         description: Backup not found
 *
 * /admin/backups/{backupId}/download:
 *   get:
 *     tags: [AdminBackups]
 *     summary: Download an encrypted backup file
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Encrypted backup stream
 *         content:
 *           application/octet-stream: {}
 *       '400':
 *         description: Invalid backupId
 *       '404':
 *         description: Backup not found
 *
 * /admin/backups/restore/{backupId}/confirm:
 *   post:
 *     tags: [AdminBackups]
 *     summary: Issue a short-lived, single-use restore confirmation token
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       '200':
 *         description: Confirmation token issued (valid for 5 minutes)
 *       '400':
 *         description: Invalid backupId
 *       '404':
 *         description: Backup not found
 *
 * /admin/backups/restore/{backupId}:
 *   post:
 *     tags: [AdminBackups]
 *     summary: Restore the database from a backup
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: backupId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [confirmationToken]
 *             properties:
 *               confirmationToken:
 *                 type: string
 *     responses:
 *       '200':
 *         description: Database restored
 *       '400':
 *         description: Missing, invalid or expired confirmation token
 *       '404':
 *         description: Backup not found
 *       '409':
 *         description: Restore blocked by in-flight requests
 */

const crypto = require('crypto');
const fs = require('fs');
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

const requireAdmin = checkPermission(PERMISSIONS.ADMIN_ALL);

function invalidBackupId(res) {
  return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid backupId' } });
}

function backupNotFound(res, message = 'Backup not found') {
  return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message } });
}

/**
 * POST /admin/backups
 * Trigger an immediate encrypted database backup.
 * Returns: { backupId, path, sizeBytes, createdAt }
 */
router.post('/', requireAdmin, asyncHandler(async (req, res) => {
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
}));

/**
 * GET /admin/backups
 * List all available backup files with metadata.
 */
router.get('/', requireAdmin, asyncHandler(async (req, res) => {
  const backups = await backupService.listBackups();
  const shaped = backups.map((b) => ({
    backupId: b.backupId,
    path: b.filePath,
    sizeBytes: b.size,
    createdAt: b.createdAt,
  }));
  return res.json({ success: true, data: shaped });
}));

/**
 * GET /admin/backups/status
 * Show the last backup time and verification result.
 */
router.get('/status', requireAdmin, asyncHandler(async (req, res) => {
  const backups = await backupService.listBackups();
  const lastBackup = backups.length > 0 ? backups[0] : null;
  return res.json({
    success: true,
    data: {
      lastBackupTime: lastBackup ? lastBackup.createdAt : null,
      lastBackupId: lastBackup ? lastBackup.backupId : null,
      lastVerification: backupService.lastVerification,
    },
  });
}));

/**
 * POST /admin/backups/restore/:backupId/confirm
 * Generate a short-lived confirmation token required to initiate a restore.
 * Returns: { confirmationToken, expiresAt }
 */
router.post('/restore/:backupId/confirm', requireAdmin, asyncHandler(async (req, res) => {
  const { backupId } = req.params;

  if (!backupService.resolveBackupPath(backupId)) return invalidBackupId(res);
  if (!(await backupService.hasBackup(backupId))) return backupNotFound(res);

  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + CONFIRM_TOKEN_TTL_MS;
  confirmTokens.set(backupId, { token, expiresAt });

  return res.status(200).json({
    success: true,
    data: { confirmationToken: token, expiresAt: new Date(expiresAt).toISOString() },
  });
}));

/**
 * POST /admin/backups/restore/:backupId
 * Restore the database from a specific backup.
 * Requires { confirmationToken } in the request body.
 * Returns HTTP 409 if there are active in-flight requests (excluding this one).
 */
router.post('/restore/:backupId', requireAdmin, asyncHandler(async (req, res) => {
  const { backupId } = req.params;
  const { confirmationToken } = req.body || {};

  if (!backupService.resolveBackupPath(backupId)) return invalidBackupId(res);

  if (!confirmationToken) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'confirmationToken is required. Call POST /admin/backups/restore/:backupId/confirm first.',
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

  try {
    const result = await backupService.restore(backupId);
    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.message && err.message.includes('not found')) return backupNotFound(res, err.message);
    throw err;
  }
}));

/**
 * POST /admin/backups/:backupId/verify
 * Run PRAGMA integrity_check and critical-table row-count comparison.
 */
router.post('/:backupId/verify', requireAdmin, asyncHandler(async (req, res) => {
  const { backupId } = req.params;

  if (!backupService.resolveBackupPath(backupId)) return invalidBackupId(res);
  if (!(await backupService.hasBackup(backupId))) return backupNotFound(res);

  const verification = await backupService.verifyBackup(backupId);
  return res.json({ success: true, data: verification });
}));

/**
 * GET /admin/backups/:backupId/download
 * Stream the encrypted backup file to the client.
 */
router.get('/:backupId/download', requireAdmin, asyncHandler(async (req, res) => {
  const { backupId } = req.params;

  const filePath = backupService.resolveBackupPath(backupId);
  if (!filePath) return invalidBackupId(res);
  if (!(await backupService.hasBackup(backupId))) return backupNotFound(res);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${backupId}.enc"`);
  fs.createReadStream(filePath).pipe(res);
}));

module.exports = router;
