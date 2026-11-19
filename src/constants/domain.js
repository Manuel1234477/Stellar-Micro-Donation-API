/**
 * Domain Constants — Pure Invariants Layer
 *
 * RESPONSIBILITY: Domain-level defaults that are not env-overridable today
 *                 but are documented magic numbers (recipients, fees, row sizes).
 * OWNER: Platform Team
 * DEPENDENCIES: None (foundational module)
 */

/**
 * Fallback recipient priority when no priority is explicitly configured.
 * Routing strategies sort by priority (higher wins); 0 is the neutral default.
 */
const DEFAULT_RECIPIENT_PRIORITY = 0;

/**
 * Donation amount (XLM) used in the public /fees endpoint's worked example.
 * Kept as a named constant so future docs/tests can reference it directly.
 */
const FEE_EXAMPLE_AMOUNT_XLM = 100.0;

/**
 * Approximate average row sizes (bytes) used by RetentionService to estimate
 * disk footprint. These are documented approximations — not exact measurements.
 * Update when storage characteristics change materially.
 */
const DB_ESTIMATED_ROW_BYTES = Object.freeze({
  DONATION: 500,      // ~500 bytes per transaction
  AUDIT_LOG: 1000,    // ~1 KB per audit log entry
  IDEMPOTENCY_KEY: 200, // ~200 bytes per idempotency key
});

/**
 * Default schedule (HH:MM UTC) for the daily retention job.
 * 02:00 UTC is the conventional off-peak window for batch housekeeping.
 */
const DEFAULT_RETENTION_SCHEDULE = '02:00'; // unexported — kept for backwards-compatibility

/**
 * Default retention windows (days) for the three retention categories.
 * These are *defaults only* — operators override via env vars (see src/config/).
 *
 *  DONATIONS            2555 days (~7 years) — anonymisation window used by RetentionService.
 *  AUDIT_LOGS_DELETION   365 days           — deletion window for the hot audit_logs table
 *                                           (used by RetentionService when no env var is set).
 *  AUDIT_LOGS_ARCHIVE     90 days           — archive-and-delete window used by
 *                                           AuditLogRetentionService (separate concern
 *                                           from hot-table deletion).
 *  IDEMPOTENCY_KEYS       30 days           — long enough to cover late retries; safe to expire sooner.
 */
const DEFAULT_RETENTION_DAYS = Object.freeze({
  DONATIONS: 2555,
  AUDIT_LOGS_DELETION: 365,
  AUDIT_LOGS_ARCHIVE: 90,
  IDEMPOTENCY_KEYS: 30,
  TRANSACTIONS: 2555,
});

/**
 * Co-located defaults for the API-key expiry notification ladder. They change
 * together and stay in sync through this single tuple. Override the warnDays
 * ladder via API_KEY_EXPIRY_WARN_DAYS env var (comma-separated, e.g. "30,7,1").
 */
const API_KEY_EXPIRY_NOTIFICATION_LADDER = Object.freeze({
  warnDays: [1, 7, 30],
  expiredWindowDays: 1, // notify keys only if they expired within this many days
  headerWindowDays: 30, // include X-API-Key-Expires-In header for keys within this many days of expiry
});

const DEFAULT_API_KEY_EXPIRY_WARN_DAYS = API_KEY_EXPIRY_NOTIFICATION_LADDER.warnDays;
const DEFAULT_API_KEY_EXPIRED_WINDOW_DAYS = API_KEY_EXPIRY_NOTIFICATION_LADDER.expiredWindowDays;
const DEFAULT_API_KEY_HEADER_WINDOW_DAYS = API_KEY_EXPIRY_NOTIFICATION_LADDER.headerWindowDays;

/**
 * Default Stellar transaction-sync scheduler interval (15 minutes).
 * Override via TX_SYNC_INTERVAL_MS env var.
 */
const DEFAULT_TX_SYNC_INTERVAL_MS = 15 * 60 * 1000;

module.exports = Object.freeze({
  DEFAULT_RECIPIENT_PRIORITY,
  FEE_EXAMPLE_AMOUNT_XLM,
  DB_ESTIMATED_ROW_BYTES,
  DEFAULT_RETENTION_SCHEDULE,
  DEFAULT_RETENTION_DAYS,
  DEFAULT_API_KEY_EXPIRY_WARN_DAYS,
  DEFAULT_API_KEY_EXPIRED_WINDOW_DAYS,
  DEFAULT_API_KEY_HEADER_WINDOW_DAYS,
  DEFAULT_TX_SYNC_INTERVAL_MS,
});
