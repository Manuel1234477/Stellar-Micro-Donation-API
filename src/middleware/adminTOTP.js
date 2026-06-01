'use strict';
/**
 * Admin 2FA Middleware — Issue #918
 *
 * When REQUIRE_ADMIN_2FA=true, enforces TOTP verification on all admin
 * API key management operations via the X-TOTP-Code header.
 *
 * Replay protection: each code is single-use within its 30-second window.
 * Used codes are stored in memory with a TTL of 90 seconds (3 windows).
 */

const TOTPService = require('../services/TOTPService');

const TOTP_STEP_MS = 30_000;
const REPLAY_TTL_MS = 3 * TOTP_STEP_MS; // 90 seconds

// Map of "keyId:windowCounter" → expiry timestamp
const usedCodes = new Map();

/** Purge expired entries to prevent unbounded growth. */
function purgeExpired() {
  const now = Date.now();
  for (const [k, expiry] of usedCodes) {
    if (now > expiry) usedCodes.delete(k);
  }
}

/**
 * Returns Express middleware that enforces TOTP when REQUIRE_ADMIN_2FA=true.
 */
function requireAdminTOTP() {
  return async function adminTotpMiddleware(req, res, next) {
    if (process.env.REQUIRE_ADMIN_2FA !== 'true') return next();

    const keyId = req.apiKey && req.apiKey.id;
    if (!keyId) {
      return res.status(403).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    const code = req.get('X-TOTP-Code');
    if (!code) {
      return res.status(403).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    // Replay check
    purgeExpired();
    const window = Math.floor(Date.now() / TOTP_STEP_MS);
    const replayKey = `${keyId}:${window}:${code}`;
    if (usedCodes.has(replayKey)) {
      return res.status(403).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    const valid = await TOTPService.verify(keyId, code);
    if (!valid) {
      return res.status(403).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    // Mark code as used
    usedCodes.set(replayKey, Date.now() + REPLAY_TTL_MS);
    next();
  };
}

module.exports = { requireAdminTOTP };
