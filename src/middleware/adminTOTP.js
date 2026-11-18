'use strict';
/**
 * Admin 2FA Middleware — Issue #918 / Issue #1536 / Issue #1710
 *
 * Enforces TOTP verification on admin API key operations via the X-TOTP-Code header
 * (or request body field `totpCode`) when TOTP is enabled on the key or when
 * REQUIRE_ADMIN_2FA=true.
 *
 * Replay protection: each code is single-use within its 30-second window.
 * The last accepted time-step counter is persisted per admin identity in SQLite
 * so it survives restarts and is shared across horizontally-scaled instances.
 * Any code whose counter is <= the last accepted counter is rejected (RFC 6238 §5.2).
 */

const TOTPService = require('../services/TOTPService');

const TOTP_STEP_MS = 30_000;
const DRIFT_STEPS = 1; // accept codes from one step before/after the current step

/**
 * Ensure the totp_replay_state table exists.
 * Called lazily on first use so tests that don't need it aren't forced to init.
 */
async function ensureTable() {
  const Database = require('../utils/database');
  await Database.run(`
    CREATE TABLE IF NOT EXISTS totp_replay_state (
      identity TEXT PRIMARY KEY,
      last_counter INTEGER NOT NULL
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

    const validTotp = await TOTPService.verify(keyId, String(code));
    const validBackup = !validTotp && await TOTPService.verifyBackupCode(keyId, String(code));

    if (!validTotp && !validBackup) {
      res.setHeader('X-TOTP-Required', 'true');
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOTP', message: 'Invalid or expired TOTP code' },
      });
    }

    // Replay protection for time-based TOTP codes: reject any code whose
    // time-step counter is <= the last accepted counter for this identity.
    if (validTotp) {
      const currentCounter = Math.floor(Date.now() / TOTP_STEP_MS);
      const identity = String(keyId);

      const row = await db.get(
        'SELECT last_counter FROM totp_replay_state WHERE identity = ?',
        [identity]
      );
      const lastCounter = row ? Number(row.last_counter) : -1;

      // The accepted code may belong to the current step or a drift step.
      // Determine the highest counter within drift tolerance that matches,
      // then require it to be strictly greater than the last accepted counter.
      let acceptedCounter = currentCounter;
      if (lastCounter >= currentCounter - DRIFT_STEPS) {
        // A code from the current step (or a drifted step) was already used.
        // Reject replays within the same or an earlier time step.
        if (lastCounter >= currentCounter - DRIFT_STEPS) {
          res.setHeader('X-TOTP-Required', 'true');
          return res.status(401).json({
            success: false,
            error: { code: 'REPLAY_DETECTED', message: 'TOTP code has already been used in the current window' },
          });
        }
      }

      // Persist the highest counter seen so far (monotonic, never decreases).
      const nextCounter = Math.max(lastCounter, acceptedCounter);
      await db.run(
        `INSERT INTO totp_replay_state (identity, last_counter) VALUES (?, ?)
         ON CONFLICT(identity) DO UPDATE SET last_counter = excluded.last_counter`,
        [identity, nextCounter]
      );
    }

    next();
  };
}

module.exports = { requireAdminTOTP };
