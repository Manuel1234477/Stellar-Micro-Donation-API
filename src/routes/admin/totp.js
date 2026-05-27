'use strict';
/**
 * Admin TOTP Routes — Issue #918
 * POST /admin/totp/setup   — generate secret + QR code
 * POST /admin/totp/verify  — confirm setup
 */

const express = require('express');
const router = express.Router();
const { checkPermission } = require('../../middleware/rbac');
const { PERMISSIONS } = require('../../utils/permissions');
const TOTPService = require('../../services/TOTPService');
const asyncHandler = require('../../utils/asyncHandler');

/**
 * POST /admin/totp/setup
 * Generate a TOTP secret for the authenticated admin API key.
 * Returns a QR code (base64 PNG data URL) and the raw secret.
 */
router.post('/setup', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const keyId = req.apiKey && req.apiKey.id;
  if (!keyId) return res.status(401).json({ success: false, error: 'API key required' });

  const result = await TOTPService.generateSecret(keyId);
  res.json({ success: true, data: result });
}));

/**
 * POST /admin/totp/verify
 * Confirm TOTP setup by verifying the first code. Enables TOTP for the key.
 */
router.post('/verify', checkPermission(PERMISSIONS.ADMIN_ALL), asyncHandler(async (req, res) => {
  const keyId = req.apiKey && req.apiKey.id;
  if (!keyId) return res.status(401).json({ success: false, error: 'API key required' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'code is required' });

  const result = await TOTPService.enable(keyId, String(code));
  if (!result.enabled) {
    return res.status(400).json({ success: false, error: result.reason });
  }
  res.json({ success: true, message: 'TOTP enabled successfully' });
}));

module.exports = router;
