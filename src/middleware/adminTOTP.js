'use strict';
/**
 * Admin 2FA Middleware — Issue #918
 *
 * When REQUIRE_ADMIN_2FA=true, enforces TOTP verification on all admin
 * API key management operations via the X-TOTP-Code header.
 *
 * Replay protection: each code is single-use within its 30-second window.
 * Used codes are persisted to SQLite (issue #1118) so they survive restarts
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

/** Purge expired rows to prevent unbounded growth. Fire-and-forget. */
function purgeExpired(db) {
  db.run('DELETE FROM totp_used_codes WHERE expires_at <= ?', [Date.now()]).catch(() => {});
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

    // Persist used code so it cannot be replayed across restarts / instances
    await db.run(
      'INSERT OR IGNORE INTO totp_used_codes (replay_key, expires_at) VALUES (?, ?)',
      [replayKey, Date.now() + REPLAY_TTL_MS]
    );

    next();
  };
}

module.exports = { requireAdminTOTP };
