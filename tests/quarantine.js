/**
 * Quarantined Tests Registry
 *
 * Tracks flaky tests that are known to pass/fail intermittently.
 * Each entry maps a test to an issue for tracking resolution.
 *
 * Format:
 * 'test-file-pattern': {
 *   issue: '#XXXX',
 *   owner: 'username',
 *   reason: 'brief description',
 *   addedDate: 'YYYY-MM-DD',
 *   deadline: 'YYYY-MM-DD',
 * }
 */

module.exports = {
  'tests/middleware/cors-allowlist-management.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires src/routes/admin/corsOrigins, which does not exist (CORS rules live in src/routes/admin/corsRules.js)',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/middleware/payload-size-limit.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires src/middleware/payloadSizeLimit (createPayloadSizeLimiter, DEFAULT_LIMITS); the module is payloadSizeLimiter.js with a different API',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/migration/010_add_performance_indexes.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires migration 010_add_performance_indexes, which does not exist (010 is add_recurring_donation_columns)',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/migration/018_api_key_rate_limit.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires migration 018_api_key_rate_limit, which does not exist (018 is idempotency_enhancements)',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/misc/debug-mode.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires src/config/envValidation, which does not exist',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/misc/request-counter.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires src/middleware/RequestCounter, which does not exist',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  'tests/misc/webhook-sdk.quarantine.test.js': {
    issue: '#1787',
    owner: 'emilioszn',
    reason: 'requires sdk/js/webhookVerifier and sdk/test-vectors, but there is no sdk/ directory',
    addedDate: '2026-10-17',
    deadline: '2026-11-17',
  },
  // Example (remove when issues are fixed):
  // 'tests/scheduler-resilience.test.js': {
  //   issue: '#9999',
  //   owner: 'team-member',
  //   reason: 'Intermittent race condition in scheduler state',
  //   addedDate: '2026-06-29',
  //   deadline: '2026-07-15',
  // },
};
