/**
 * Canonical between-test reset helper  (#1172)
 *
 * RESPONSIBILITY: Provide a single, authoritative function every test suite
 * calls in its beforeEach / afterEach to tear down known state and avoid
 * cross-test pollution.
 *
 * OWNER: QA/Testing Team
 *
 * HOW TO USE IN A TEST FILE
 * ─────────────────────────
 * const { resetBetweenTests } = require('../helpers/resetState');
 *
 * beforeEach(resetBetweenTests);   // or afterEach(resetBetweenTests)
 *
 * That's it.  Do NOT duplicate reset logic inside individual test files.
 *
 * WHAT IT RESETS
 * ──────────────
 * 1. SQLite tables that accumulate rows between tests (users, transactions,
 *    api_keys seeded by tests, idempotency_keys, recurring_donations, …)
 * 2. In-memory singletons (per-key rate limiter, abuse detector, nonce store,
 *    deduplication cache, idempotency store, feature-flag cache)
 * 3. The in-process Transaction model cache (if present)
 *
 * WHAT IT DOES NOT RESET
 * ──────────────────────
 * • process.env overrides — use jest.resetModules() + re-require if you need
 *   a fresh config. Or wrap with createIsolatedEnvironment() from testIsolation.js.
 * • The per-worker SQLite file itself — that is handled once at setup time by
 *   tests/setup.js copying the template DB.  resetBetweenTests() only deletes
 *   rows so tests start with an empty-but-schema-ready database.
 */

'use strict';

const Database = require('../../src/utils/database');

// ─── SQLite table names that should be emptied between tests ──────────────────
// Order matters: child rows must be deleted before parent rows when FKs are on.
const TABLES_TO_CLEAR = [
  'recovery_approvals',
  'recovery_requests',
  'recovery_guardians',
  'routing_decisions',
  'recipient_pool_members',
  'round_robin_state',
  'routing_config',
  'recipient_pools',
  'escrow_pledges',
  'campaign_milestones',
  'campaigns',
  'multisig_transactions',
  'audit_logs',
  'fee_payments',
  'student_fees',
  'recurring_donations',
  'idempotency_keys',
  'dedup_cache',
  'transactions',
  'api_keys',
  'donation_totals',
  'users',
];

/**
 * Delete all rows from every test-owned table.
 * Failures are swallowed (tables that don't exist in a given test context are OK).
 * @returns {Promise<void>}
 */
async function clearDatabaseTables() {
  for (const table of TABLES_TO_CLEAR) {
    try {
      await Database.run(`DELETE FROM ${table}`);
    } catch (_) {
      // Table may not exist in all test contexts — that is fine.
    }
  }

  // Re-seed the single-row global totals table so aggregation tests don't break
  try {
    await Database.run(
      `INSERT OR IGNORE INTO donation_totals_global (id, total_stroops, donation_count) VALUES (1, '0', 0)`
    );
  } catch (_) {}
}

/**
 * Reset all in-memory singletons that accumulate state across test files.
 */
function resetInMemorySingletons() {
  // Per-key rate limiter
  try {
    const { clearStore } = require('../../src/middleware/perKeyRateLimit');
    clearStore();
  } catch (_) {}

  // Abuse detection service
  try {
    const svc = require('../../src/services/AbuseDetectionService');
    svc.blockedIps = [];
    svc.suspiciousCounts = new Map();
  } catch (_) {}

  // Abuse detector utility
  try {
    const det = require('../../src/utils/abuseDetector');
    det.requestCounts = new Map();
    det.failureCounts = new Map();
    det.suspiciousIPs = new Set();
  } catch (_) {}

  // Replay / nonce store
  try {
    const { defaultStore } = require('../../src/utils/nonceStore');
    if (defaultStore && typeof defaultStore.clear === 'function') defaultStore.clear();
  } catch (_) {}

  // Deduplication middleware cache
  try {
    const dedup = require('../../src/middleware/deduplication');
    if (typeof dedup.clearCache === 'function') dedup.clearCache();
  } catch (_) {}

  // Idempotency store
  try {
    const idm = require('../../src/middleware/idempotency');
    if (typeof idm.clearStore === 'function') idm.clearStore();
    else if (idm.store instanceof Map) idm.store.clear();
  } catch (_) {}

  // Feature-flag cache
  try {
    const ff = require('../../src/utils/featureFlags');
    if (typeof ff.resetCache === 'function') ff.resetCache();
  } catch (_) {}

  // In-process Transaction model cache
  try {
    const Tx = require('../../src/models/transaction');
    if (typeof Tx._clearAllData === 'function') Tx._clearAllData();
  } catch (_) {}
}

/**
 * THE canonical reset function.
 *
 * Call this in beforeEach / afterEach:
 *
 *   beforeEach(resetBetweenTests);
 *
 * @returns {Promise<void>}
 */
async function resetBetweenTests() {
  resetInMemorySingletons();
  await clearDatabaseTables();
}

module.exports = {
  resetBetweenTests,
  clearDatabaseTables,
  resetInMemorySingletons,
  // Expose table list so callers can inspect or extend it
  TABLES_TO_CLEAR,
};
