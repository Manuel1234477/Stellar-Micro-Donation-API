const hasSecurityPlugin = (() => {
  try {
    require.resolve('eslint-plugin-security');
    return true;
  } catch (error) {
    return false;
  }
})();

/**
 * Files grandfathered from the max-lines rule while they are being decomposed.
 * As decomposition PRs land, remove entries from this list one by one.
 * Issue tracking: #1211 (split MockStellarService), #1212 (decompose DonationService),
 * #1213 (decompose wallet route), #1214 (decompose donation route)
 *
 * Issue #1394: This array was previously referenced in the overrides block but
 * never declared, causing a ReferenceError on config load and breaking all lint
 * and SAST CI jobs. Declared here to fix that.
 */
const GRANDFATHERED_LARGE_FILES = [
  'src/services/MockStellarService.js',
  'src/services/DonationService.js',
  'src/services/RecurringDonationScheduler.js',
  'src/services/TransactionReconciliationService.js',
  'src/services/WebhookService.js',
  'src/services/AuditLogExportService.js',
  'src/services/StatsService.js',
  'src/services/LeaderboardStatsService.js',
  'src/services/ApiKeyUsageService.js',
  'src/routes/stream.js',
  'src/routes/transactions/core.js',
  'src/routes/campaigns.js',
  'src/routes/apiKeys.js',
  'src/routes/assets.js',
  'src/bootstrap/routes.js',
  'src/bootstrap/server.js',
  'src/utils/database.js',
  'src/utils/tracing.js',
  'src/middleware/rbac.js',
  'src/middleware/rateLimiter.js',
  'tests/donations/donation-routes.test.js',
  'tests/donations/recurring-donation-scheduling-flexi.test.js',
  'tests/donations/donation-matching-program.test.js',
  'tests/misc/input-sanitization-for-xss-and-injection-preve.test.js',
  'tests/misc/comprehensive-input-validation-error-mes.test.js',
  'tests/admin/api-key-scoping-finegrained-permiss.test.js',
  'tests/admin/twofactor-authentication-for-admin-operations.test.js',
  'tests/security/rbac-authorization-matrix.test.js',
  'tests/transactions/stellar-transaction-sequence-number-management.test.js',
  'tests/tracing/distributed-tracing-opentelemetry.test.js',
];

/**
 * Files grandfathered from local/consistent-exports. Each one predates the rule
 * and changing its export shape means updating every consumer, so they are being
 * migrated one PR at a time (see docs/EXPORT_CONVENTIONS.md). The rule stays an
 * error for every other file. Remove entries as files are migrated; never add.
 * Issue tracking: #1789.
 */
const GRANDFATHERED_EXPORT_SHAPES = [
  'src/migrations/005_donation_exports.js',
  'src/migrations/024_corporate_matching_and_sep10_challenges.js',
  'src/migrations/041_queued_donations.js',
  'src/migrations/042_add_sdg_tags_to_campaigns_and_wallets.js',
  'src/routes/donations/helpers.js',
  'src/routes/federation.js',
  'src/routes/federationLookup.js',
  'src/routes/network.js',
  'src/routes/wallets/helpers.js',
  'src/services/CrowdfundingService.js',
  'src/services/DonationVelocityService.js',
  'src/services/GeoRuleService.js',
  'src/services/HealthCheckService.js',
  'src/services/JwtService.js',
  'src/services/LeaderboardSSE.js',
  'src/services/LimitService.js',
  'src/services/MemoEncryptionService.js',
  'src/services/NetworkFeeService.js',
  'src/services/PaymentChannelService.js',
  'src/services/PledgeFulfillmentService.js',
  'src/services/PriceOracleService.js',
  'src/services/PubSubAdapter.js',
  'src/services/SequenceManager.js',
  'src/services/TOTPService.js',
  'src/services/interfaces/IStellarService.js',
  'src/services/rateLimitStores/index.js',
  'src/services/signing/index.js',
  'src/services/websocketService.js',
  'src/utils/abuseDetector.js',
  'src/utils/asyncHandler.js',
  'src/utils/cache.js',
  'src/utils/database.js',
  'src/utils/donationValidator.js',
  'src/utils/leaderElection.js',
  'src/utils/memoCollisionDetector.js',
  'src/utils/memoValidator.js',
  'src/utils/stellarErrorHandler.js',
  'src/utils/suspiciousPatternDetector.js',
  'src/utils/timerRegistry.js',
];

module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ['eslint:recommended'],
  plugins: ['no-secrets', ...(hasSecurityPlugin ? ['security'] : []), 'local'],
  parserOptions: {
    ecmaVersion: 2022,
  },
  rules: {
    // Unused vars: flag dead variables/imports, but allow intentionally-unused
    // function arguments (interface/abstract stubs, middleware signatures) and
    // caught errors. Prefix with `_` to explicitly mark a local as unused.
    'no-unused-vars': ['error', {
      args: 'none',
      caughtErrors: 'none',
      ignoreRestSiblings: true,
      varsIgnorePattern: '^_',
    }],

    // File length budget: encourage files under 1000 lines (warn) to prevent
    // unbounded growth without blocking all work. Grandfathered large files
    // are exempt while they're being decomposed. New files must stay under budget.
    'max-lines': ['warn', {
      max: 1000,
      skipBlankLines: true,
      skipComments: true,
    }],

    // Security rules. no-secrets flags high-entropy strings; the patterns below are
    // verified non-secrets (doc paths, URLs, SQL/identifier names, env-var doc
    // strings, OpenAPI examples, the standard RFC 4648 base32 alphabet). Real
    // random tokens/keys do not match these and are still flagged.
    'no-secrets/no-secrets': ['error', {
      ignoreContent: [
        '\\.md',                                 // documentation file paths
        'https?://',                             // URLs
        'idx_recovery_guardians',                // SQL index names
        'wal_checkpoint',                        // SQLite pragma
        'buildAndSubmitFeeBumpTransaction',      // method identifier
        'INVALID_WEBHOOK_SIGNATURE',             // error-code constant
        'ENCRYPTION_KEY',                        // env-var doc string
        'REQUIRE_IDEMPOTENCY_KEY',               // env-var doc string
        'ACCESS_LOG_INCLUDE_HEALTH',             // env-var doc string
        'snapshotAt=',                           // example query string
        'stellar_public_key',                    // example placeholder
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',            // RFC 4648 base32 alphabet / placeholder keys
        '^eyJ',                                  // example JWT (OpenAPI docs)
        '\\b\\d{3}_[a-z0-9_]+\\b',                 // migration names (e.g. 020_webhook_tls_skip_verify)
        '\\bidx_[a-z0-9_]+\\b',                    // SQL index names
        '\\b[A-Z][A-Z0-9_]*=(true|false|mainnet|testnet|software)\\b', // env-var doc strings
        '\\[[A-Za-z]+=[A-Z0-9_]+\\]',              // JSDoc optional-param defaults
        'req_01HZ7GXKJ8QCVW9ABCDEF',             // example request id (error-code docs)
        'buildManifest\\(\\)',                   // JSDoc method reference
        'obj<<',                                 // embedded PDF template
        'SHARED_STATE_BACKEND',                  // env-var doc string
      ],
    }],
    ...(hasSecurityPlugin ? {
      'security/detect-object-injection': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'warn',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-require': 'warn',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
    } : {}),

    // Code quality rules that affect security
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-console': 'off',
    'local/require-async-handler': 'error',
    'local/no-floating-promises': 'error',
    'local/consistent-exports': 'error',
  },
  overrides: [
    {
      // Grandfathered export shapes: see GRANDFATHERED_EXPORT_SHAPES above.
      files: GRANDFATHERED_EXPORT_SHAPES,
      rules: {
        'local/consistent-exports': 'off',
      },
    },
    {
      // Grandfathered large files: exempt from max-lines while being decomposed.
      // See the GRANDFATHERED_LARGE_FILES declaration at the top of this file.
      files: GRANDFATHERED_LARGE_FILES,
      rules: {
        'max-lines': 'off',
      },
    },
    {
      // Enforce structured logging in all service source files (#1783). CLI
      // scripts (src/scripts, migrations) print to the console by design and are
      // exempt; startupChecks.js only uses the console when run as a CLI.
      files: ['src/**/*.js'],
      excludedFiles: [
        'src/scripts/**/*.js',
        'src/migrations/**/*.js',
        // Config loads at boot before the logger and the logger itself depends on
        // config (src/utils/log.js requires ../config), so these two files must use
        // console. The rest of src/config uses the logger like everything else (#1783).
        'src/config/index.js',
        'src/config/stellarEnvironments.js',
        'src/utils/log.js',
      ],
      rules: {
        'no-console': 'error',
      },
    },
    {
      // Centralised configuration (#1784): read environment variables through
      // src/config/env.js (typed, validated, documented in envSchema.js) rather
      // than process.env. CLI scripts and migrations run outside the app and are exempt.
      files: ['src/**/*.js'],
      excludedFiles: [
        'src/config/**/*.js',
        'src/scripts/**/*.js',
        'src/migrations/**/*.js',
      ],
      rules: {
        'no-restricted-properties': ['error', {
          object: 'process',
          property: 'env',
          message: 'Read configuration via src/config/env.js (declare the variable in src/config/envSchema.js).',
        }],
      },
    },
    {
      // Pre-existing direct reads, migrated incrementally.
      files: PROCESS_ENV_GRANDFATHERED,
      rules: {
        'no-restricted-properties': 'off',
      },
    },
    {
      files: [
        'src/services/**/*.js',
        'src/jobs/**/*.js',
        'src/workers/**/*.js',
        'src/utils/**/*.js',
        'src/middleware/**/*.js',
        'src/routes/**/*.js',
      ],
      excludedFiles: [
        'src/services/MockStellarService.js',
      ],
      rules: {
        'local/no-bare-timers': 'error',
      },
    },
  ],
  ignorePatterns: [
    'node_modules/',
    'data/',
    'logs/',
    'coverage/',
  ],
};
