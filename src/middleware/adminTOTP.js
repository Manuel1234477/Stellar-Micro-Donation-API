'use strict';
/**
 * Admin 2FA Middleware — Issue #918 / Issue #1536
 *
 * Enforces TOTP verification on admin API key operations via the X-TOTP-Code header
 * (or request body field `totpCode`) when TOTP is enabled on the key or when
 * REQUIRE_ADMIN_2FA=true.
 *
 * Replay protection: each code is single-use within its 30-second window.
 * Used codes are persisted to SQLite so they survive restarts
 * and are shared across horizontally-scaled instances.
 * Entries expire after REPLAY_TTL_MS (90 s = 3 TOTP windows).
 */

const TOTPService = require('../services/TOTPService');

const TOTP_STEP_MS = 30_000;
const REPLAY_TTL_MS = 3 * TOTP_STEP_MS; // 90 seconds

/**
 * Ensure the totp_used_codes table exists.
 * Called lazily on first use so tests that don't need it aren't forced to init.
 */
async function ensureTable() {
  const Database = require('../utils/database');
  await Database.run(`
    CREATE TABLE IF NOT EXISTS totp_used_codes (
      replay_key TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    )
  `);
}

let tableReady = false;
async function getDb() {
  if (!tableReady) {
    await ensureTable();
    tableReady = true;
  }
  return require('../utils/database');
}

/** Purge expired rows to prevent unbounded growth (background cleanup). */
function purgeExpired(db) {
  // Intentional background cleanup—fire-and-forget. Failures silently discarded.
  const _cleanup = db.run('DELETE FROM totp_used_codes WHERE expires_at <= ?', [Date.now()])
    .catch(() => {});
}

/**
 * Returns Express middleware that enforces TOTP for admin operations.
 */
function requireAdminTOTP() {
  return async function adminTotpMiddleware(req, res, next) {
    const keyId = req.apiKey && !req.apiKey.isLegacy ? req.apiKey.id : null;
    const require2FA = process.env.REQUIRE_ADMIN_2FA === 'true';

    // If key has TOTP enabled or global 2FA is required
    let isEnrolled = false;
    if (keyId) {
      try {
        isEnrolled = await TOTPService.isTotpEnabled(keyId);
      } catch (_) {
        isEnrolled = false;
      }
    }

    if (!require2FA && !isEnrolled) {
      return next();
    }

    if (!keyId && require2FA) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    const code = req.get('X-TOTP-Code') || (req.body && req.body.totpCode);
    if (!code) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    const window = Math.floor(Date.now() / TOTP_STEP_MS);
    const replayKey = `${keyId}:${window}:${code}`;

    let db;
    try {
      db = await getDb();
    } catch {
      // If DB is unavailable fall back to rejecting — safer than allowing replay
      return res.status(503).json({
        success: false,
        error: { code: 'TOTP_REQUIRED', message: 'Admin operations require a valid TOTP code' },
      });
    }

    purgeExpired(db);

    // Replay check — row present means code was already used
    const existing = await db.get('SELECT 1 FROM totp_used_codes WHERE replay_key = ?', [replayKey]);
    if (existing) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'REPLAY_DETECTED', message: 'TOTP code has already been used in the current window' },
      });
    }

    const validTotp = await TOTPService.verify(keyId, String(code));
    const validBackup = !validTotp && await TOTPService.verifyBackupCode(keyId, String(code));

    if (!validTotp && !validBackup) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOTP', message: 'Invalid or expired TOTP code' },
      });
    }

    // Persist used code so it cannot be replayed across restarts / instances (for time-based TOTP codes)
    if (validTotp) {
      await db.run(
        'INSERT OR IGNORE INTO totp_used_codes (replay_key, expires_at) VALUES (?, ?)',
        [replayKey, Date.now() + REPLAY_TTL_MS]
      );
    }

    next();
  };
}

module.exports = { requireAdminTOTP };
