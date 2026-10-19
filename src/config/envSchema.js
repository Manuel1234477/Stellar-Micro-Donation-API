'use strict';

/* eslint-disable no-secrets/no-secrets -- descriptions and placeholder examples only; no secret values live here */

/**
 * Environment Variable Schema (#1784, #1785)
 *
 * RESPONSIBILITY: Single declaration of every environment variable the
 *   application reads — its type, default, constraints and description.
 * OWNER: Platform Team
 *
 * This file is the source of truth for:
 *   - startup validation (src/config/env.js)
 *   - .env.example and docs/CONFIGURATION.md (scripts/generate-config-docs.js)
 *   - the CI check that every environment variable read in src/ is declared here
 *     (scripts/check-env-documented.js)
 *
 * Adding a variable: add an entry below, then run `npm run config:generate`.
 *
 * Entry fields:
 *   name        Variable name.
 *   group       Section used in the generated docs and .env.example.
 *   type        'string' | 'integer' | 'number' | 'boolean' | 'enum' | 'list' | 'url' | 'json'
 *   default     Value used when unset (omit for "no default").
 *   required    'always' | 'production' — startup fails when missing.
 *   secret      true → value is never printed and is left blank in .env.example.
 *   enum        Allowed values for type 'enum'.
 *   min / max   Inclusive bounds for numeric types.
 *   example     Value written (uncommented) into .env.example.
 *   deprecated  Replacement hint; the variable still works.
 *   description What the variable controls.
 */

const G0 = 'Server';
const G1 = 'Authentication & API Keys';
const G2 = 'Encryption & Secrets';
const G3 = 'Stellar / Horizon';
const G4 = 'Database';
const G5 = 'CORS';
const G6 = 'Logging';
const G7 = 'Rate Limiting';
const G8 = 'Donation Limits & Business Logic';
const G9 = 'Caching';
const G10 = 'SMTP / Email Receipts';
const G11 = 'IPFS / Pinata';
const G12 = 'Geographic Blocking';
const G13 = 'Abuse Detection';
const G14 = 'Replay & Deduplication';
const G15 = 'Backup';
const G16 = 'SSE / WebSocket Streaming';
const G17 = 'Observability & Tracing';
const G18 = 'Organisation Metadata';
const G19 = 'Signing Providers (HSM / KMS)';
const G20 = 'Miscellaneous / Feature Config';
const G21 = 'Shared State (Multi-Instance)';
const G22 = 'GraphQL';

const ENV_VARS = [
  // ── Server ──────────────────────────────────────────────────────
  { group: G0, name: 'API_PREFIX', type: 'string', default: '/api/v1', description: 'Base path prefix prepended to all API routes' },
  { group: G0, name: 'INSTANCE_ID', type: 'string', description: 'Unique identifier for this process instance (used for scheduler/sequence leases and logs). Defaults to a random UUID' },
  { group: G0, name: 'NODE_ENV', type: 'string', default: 'development', example: 'development', description: 'Runtime environment: `development`, `test` or `production`. Controls logging verbosity, startup guards and unsafe-flag checks' },
  { group: G0, name: 'PORT', type: 'integer', default: 3000, example: '3000', description: 'TCP port the HTTP server listens on' },
  { group: G0, name: 'REQUEST_TIMEOUT_MS', type: 'integer', default: 30000, description: 'Global per-request timeout in milliseconds. Streaming endpoints are exempt' },
  { group: G0, name: 'SHUTDOWN_TIMEOUT', type: 'integer', default: 30000, description: 'Alias for `SHUTDOWN_TIMEOUT_MS` (milliseconds). Time allowed for in-flight requests to drain before force-exit' },
  { group: G0, name: 'SHUTDOWN_TIMEOUT_MS', type: 'integer', default: 30000, description: 'Milliseconds to wait for graceful shutdown before force-exit' },
  { group: G0, name: 'TRUSTED_PROXIES', type: 'string', default: 'loopback', description: 'Comma-separated list of trusted proxy IPs/CIDRs. Passed to Express `trust proxy`. Set to the address of your load balancer in production' },

  // ── Authentication & API Keys ───────────────────────────────────
  { group: G1, name: 'API_KEY_EXPIRED_WINDOW_DAYS', type: 'integer', default: 1, min: 0, description: 'Notify owners of keys that expired within this many days' },
  { group: G1, name: 'API_KEY_EXPIRY_WARN_DAYS', type: 'list', default: '1,7,30', description: 'Comma-separated days-before-expiry at which key owners are warned (e.g. `30,7,1`)' },
  { group: G1, name: 'API_KEY_HEADER_WINDOW_DAYS', type: 'integer', default: 30, min: 0, description: 'Include the `X-API-Key-Expires-In` response header for keys within this many days of expiry' },
  { group: G1, name: 'API_KEY_WEBHOOK_TIMEOUT_MS', type: 'integer', default: 10000, min: 1000, description: 'Timeout (ms) for API-key expiry notification webhooks' },
  { group: G1, name: 'API_KEYS', type: 'list', required: 'always', secret: true, example: 'dev_key_1234567890,dev_key_abcdef123456', description: 'Comma-separated list of raw API keys accepted by the legacy authentication path. At least one key is required' },
  { group: G1, name: 'AUTH_LOCKOUT_MS', type: 'integer', default: 900000, description: 'Duration (ms) of the authentication lockout' },
  { group: G1, name: 'AUTH_MAX_ATTEMPTS', type: 'integer', default: 5, description: 'Maximum failed authentication attempts before an IP is locked out' },
  { group: G1, name: 'AUTH_WINDOW_MS', type: 'integer', default: 900000, example: '60000', description: 'Rolling window (ms) in which `AUTH_MAX_ATTEMPTS` failures trigger lockout' },
  { group: G1, name: 'HOME_DOMAIN', type: 'string', description: 'Stellar home domain used in SEP-10 web-auth challenges' },
  { group: G1, name: 'JWT_SECRET', type: 'string', secret: true, description: 'Secret used to sign and verify JWT tokens. Must satisfy [secret strength rules](#25-secret-strength-requirements) if set' },
  { group: G1, name: 'REFRESH_TOKEN_ABSOLUTE_TTL_DAYS', type: 'number', default: 30, min: 0, description: 'Absolute lifetime (days) of a refresh-token family, regardless of rotation' },
  { group: G1, name: 'REQUEST_SIGNING_SECRET', type: 'string', secret: true, description: 'HMAC secret used to verify inbound request signatures' },
  { group: G1, name: 'REQUEST_SIGNING_WINDOW_SECONDS', type: 'integer', default: 300, description: 'Seconds of clock skew tolerated in signed requests' },
  { group: G1, name: 'REQUIRE_ADMIN_2FA', type: 'boolean', default: false, description: 'When `true`, admin endpoints require a valid TOTP code alongside the API key' },
  { group: G1, name: 'REQUIRE_IDEMPOTENCY_KEY', type: 'boolean', default: false, description: 'When `true`, POST/PATCH/PUT requests without `X-Idempotency-Key` are rejected' },
  { group: G1, name: 'REQUIRE_REQUEST_SIGNING', type: 'boolean', default: false, description: 'When `true`, every mutating request must carry a valid HMAC request signature' },
  { group: G1, name: 'SEP10_CHALLENGE_TTL', type: 'integer', default: 300, description: 'Seconds a SEP-10 challenge token remains valid' },
  { group: G1, name: 'SIGNED_URL_EXPIRY_MS', type: 'integer', default: 3600000, description: 'Lifetime of signed download/export URLs in milliseconds' },
  { group: G1, name: 'TOTP_ISSUER', type: 'string', default: 'StellarDonationAPI', description: 'Issuer label embedded in TOTP QR codes' },
  { group: G1, name: 'TOTP_WINDOW', type: 'integer', default: 1, description: 'Number of 30-second TOTP windows (±) accepted to tolerate clock skew' },

  // ── Encryption & Secrets ────────────────────────────────────────
  { group: G2, name: 'ANONYMOUS_DONATION_SECRET', type: 'string', secret: true, description: 'Secret from which anonymous donor tokens are derived. Must be distinct from `ENCRYPTION_KEY`' },
  { group: G2, name: 'ENCRYPTED_ENCRYPTION_KEY', type: 'string', secret: true, description: 'KMS-wrapped `ENCRYPTION_KEY`. Unwrapped at startup when `KMS_KEY_ID` is set' },
  { group: G2, name: 'ENCRYPTION_KEY', type: 'string', required: 'production', secret: true, example: '<run `npm run generate-key` and paste the 64-char hex output here>', description: 'AES-256 key used to encrypt wallet secret keys and other sensitive data at rest. Generate with `npm run generate-key`. **Changing this key makes all previously encrypted data unrecoverable.**' },
  { group: G2, name: 'ENCRYPTION_KEY_1', type: 'string', secret: true, description: 'Previous encryption key used during key rotation. Required when `ENCRYPTION_KEY_VERSION=1`' },
  { group: G2, name: 'ENCRYPTION_KEY_VERSION', type: 'integer', default: 1, example: '0', description: 'Active encryption key version. `1` requires `ENCRYPTION_KEY_1` (the previous key) for rotation. Additional versions are read from `ENCRYPTION_KEY_<N>`' },
  { group: G2, name: 'ENCRYPTION_PRIVATE_KEY', type: 'string', secret: true, description: 'RSA/EC private key PEM used by asymmetric signing paths' },
  { group: G2, name: 'ENCRYPTION_PUBLIC_KEY', type: 'string', description: 'RSA/EC public key PEM used to verify asymmetric signatures' },
  { group: G2, name: 'ENCRYPTION_SECRET', type: 'string', secret: true, description: 'Legacy symmetric encryption secret for non-wallet data paths' },
  { group: G2, name: 'EXPORT_SIGNING_SECRET', type: 'string', secret: true, description: 'HMAC secret for signing CSV/JSON export files. Must be distinct from `ENCRYPTION_KEY`' },
  { group: G2, name: 'JWT_SIGNING_SECRET', type: 'string', secret: true, description: 'HMAC secret that signs access tokens (at least 32 characters). Required in production and staging. Must be distinct from `ENCRYPTION_KEY`' },
  { group: G2, name: 'JWT_SIGNING_SECRET_PREVIOUS', type: 'string', secret: true, description: 'Previous `JWT_SIGNING_SECRET`, kept during rotation so tokens issued before the change still verify' },
  { group: G2, name: 'MEMO_REENCRYPT_BATCH_SIZE', type: 'integer', default: 50, min: 1, description: 'Memos processed per batch by the background re-encryption job' },
  { group: G2, name: 'MEMO_REENCRYPT_INTERVAL_MS', type: 'integer', default: 30000, min: 1, description: 'Interval (ms) between memo re-encryption batches' },
  { group: G2, name: 'NEW_ENCRYPTION_KEY', type: 'string', secret: true, description: 'Target key during a live re-encryption pass (`npm run migrate:reencrypt`)' },
  { group: G2, name: 'ROTATION_LOCK_CACHE_TTL_MS', type: 'integer', default: 5000, min: 0, description: 'TTL (ms) of the cached key-rotation lock state' },
  { group: G2, name: 'ROTATION_LOCK_WARN_INTERVAL_MS', type: 'integer', default: 60000, min: 0, description: 'Minimum interval (ms) between "rotation in progress" warnings' },
  { group: G2, name: 'SIGNING_PROVIDER', type: 'string', default: 'software', example: 'local', description: 'Transaction signing provider: `software`/`local` (in-process key), `hsm` or `kms`' },
  { group: G2, name: 'STRIPE_WEBHOOK_SECRET', type: 'string', secret: true, description: 'HMAC secret for the `stripe` inbound webhook source' },

  // ── Stellar / Horizon ───────────────────────────────────────────
  { group: G3, name: 'ALLOW_TESTNET_IN_PRODUCTION', type: 'boolean', default: false, description: 'Break-glass override that allows `NODE_ENV=production` to target testnet. Startup fails without it' },
  { group: G3, name: 'BALANCE_ALERT_THRESHOLD_XLM', type: 'number', default: 10, min: 0, description: 'Service-account balance (XLM) below which a warning alert is sent' },
  { group: G3, name: 'BALANCE_CHECK_INTERVAL_MS', type: 'integer', default: 300000, min: 1, description: 'Interval (ms) between service-account balance checks' },
  { group: G3, name: 'BALANCE_CRITICAL_THRESHOLD_XLM', type: 'number', default: 2, min: 0, description: 'Service-account balance (XLM) below which a critical alert is sent' },
  { group: G3, name: 'CONFIRMATION_CHECK_INTERVAL_MS', type: 'integer', default: 5000, description: 'Interval (ms) between background confirmation threshold checks for pending transactions (#1606)' },
  { group: G3, name: 'CONFIRMATION_LEDGER_THRESHOLD', type: 'integer', example: '3', deprecated: 'Use CONFIRMATION_THRESHOLD', description: 'Deprecated alias of `CONFIRMATION_THRESHOLD`' },
  { group: G3, name: 'CONFIRMATION_THRESHOLD', type: 'integer', default: 1, description: 'Number of ledger closings required before a transaction is considered confirmed (min: 1, max: 10). Backwards compatible with `CONFIRMATION_LEDGER_THRESHOLD`.' },
  { group: G3, name: 'DRY_RUN', type: 'boolean', default: false, description: 'Skip submitting real Stellar transactions. Useful for staging. **Startup fails in production if `true`**' },
  { group: G3, name: 'HORIZON_API_TIMEOUT_MS', type: 'integer', default: 15000, description: 'Timeout (ms) for Horizon API calls. The network-fee estimator uses 5000 ms when unset' },
  { group: G3, name: 'HORIZON_CB_COOLDOWN_MS', type: 'integer', default: 30000, description: 'Time (ms) the circuit breaker stays open before attempting a probe request' },
  { group: G3, name: 'HORIZON_CB_FAILURE_THRESHOLD', type: 'integer', default: 5, description: 'Number of consecutive Horizon failures before the circuit breaker opens' },
  { group: G3, name: 'HORIZON_CB_WINDOW_MS', type: 'integer', default: 60000, description: 'Rolling window (ms) in which failures are counted by the circuit breaker' },
  { group: G3, name: 'HORIZON_FAILOVER_THRESHOLD', type: 'integer', default: 3, min: 1, max: 10, description: 'Consecutive failures before switching to a fallback Horizon URL' },
  { group: G3, name: 'HORIZON_FALLBACK_URLS', type: 'list', description: 'Comma-separated fallback Horizon URLs used when the primary is unhealthy' },
  { group: G3, name: 'HORIZON_MAX_RETRY_ATTEMPTS', type: 'integer', default: 3, description: 'Maximum number of automatic retries for failed Horizon requests' },
  { group: G3, name: 'HORIZON_POOL_COOLDOWN_MS', type: 'integer', default: 30000, description: 'Minimum cooldown (ms) between using the same pool connection' },
  { group: G3, name: 'HORIZON_POOL_SIZE', type: 'integer', default: 3, example: '5', description: 'Number of parallel Horizon HTTP connections maintained per pool' },
  { group: G3, name: 'HORIZON_RECOVERY_COOLDOWN_MS', type: 'integer', default: 60000, min: 10000, max: 600000, description: 'Time (ms) before retrying the primary Horizon URL after failover' },
  { group: G3, name: 'HORIZON_RETRY_BASE_DELAY_MS', type: 'integer', default: 200, description: 'Base delay (ms) for Horizon retry exponential back-off' },
  { group: G3, name: 'HORIZON_RETRY_MAX_DELAY_MS', type: 'integer', default: 2000, description: 'Maximum delay (ms) cap for Horizon retry back-off' },
  { group: G3, name: 'HORIZON_STREAM_TIMEOUT_MS', type: 'integer', default: 60000, description: 'Timeout (ms) for Horizon SSE stream connections' },
  { group: G3, name: 'HORIZON_SUBMIT_TIMEOUT_MS', type: 'integer', default: 30000, description: 'Timeout (ms) for transaction submission to Horizon' },
  { group: G3, name: 'HORIZON_URL', type: 'url', example: 'https://horizon-testnet.stellar.org', description: 'Override the Horizon endpoint URL. Defaults to the canonical URL for `STELLAR_NETWORK`' },
  { group: G3, name: 'MIN_RESERVE_XLM', type: 'number', default: 1, description: 'Minimum XLM balance (in XLM) required in a wallet for operations' },
  { group: G3, name: 'MOCK_STELLAR', type: 'boolean', default: false, example: 'true', description: 'When `true`, no outbound Stellar/Horizon calls are made. Required for local dev and CI' },
  { group: G3, name: 'MOCK_STELLAR_LATENCY_MS', type: 'integer', default: 0, description: 'Artificial delay (ms) injected by the mock Stellar service to simulate network latency' },
  { group: G3, name: 'RECIPIENT_SECRETS', type: 'string', secret: true, description: 'JSON-encoded map of recipient IDs to Stellar secret keys for multi-recipient flows' },
  { group: G3, name: 'SERVICE_ACCOUNT_PUBLIC_KEY', type: 'string', example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX', description: 'Public key of the service account monitored for low balance' },
  { group: G3, name: 'SERVICE_SECRET_KEY', type: 'string', secret: true, description: 'Stellar secret key (`S…`) for service-initiated signing operations. Never commit.' },
  { group: G3, name: 'SEP10_SIGNING_KEY', type: 'string', secret: true, description: 'Dedicated, unfunded Stellar secret key (`S…`) that signs SEP-10 challenges and is published as `SIGNING_KEY` in stellar.toml. Falls back to `STELLAR_SECRET`/`SERVICE_SECRET_KEY` when unset. Must not be a funded account.' },
  { group: G3, name: 'SERVICE_SIGNING_KEY', type: 'string', secret: true, description: 'Alias for `SERVICE_SECRET_KEY` used in some signing paths' },
  { group: G3, name: 'SIMULATION_ENABLED', type: 'boolean', default: true, description: 'Mock Stellar only: set `false` to disable transaction simulation' },
  { group: G3, name: 'SOROBAN_RPC_URL', type: 'url', description: 'Soroban RPC endpoint for smart-contract calls' },
  { group: G3, name: 'SPONSOR_SECRET', type: 'string', secret: true, description: 'Stellar secret key of the fee-bump sponsor account' },
  { group: G3, name: 'STELLAR_BASE_RESERVE', type: 'number', description: 'Override the base reserve (XLM) of the active Stellar environment preset (preset: 0.5)' },
  { group: G3, name: 'STELLAR_ENVIRONMENT', type: 'string', default: 'testnet', description: 'Alias for `STELLAR_NETWORK` accepted by some service modules' },
  { group: G3, name: 'STELLAR_EXPLORER_URL', type: 'string', description: 'Base URL of the Stellar block explorer used to build transaction links' },
  { group: G3, name: 'STELLAR_FEE_MULTIPLIER', type: 'integer', example: '1', description: 'Override the fee multiplier of the active Stellar environment preset (preset: 100)' },
  { group: G3, name: 'STELLAR_NETWORK', type: 'string', default: 'testnet', example: 'testnet', deprecated: 'Use STELLAR_ENVIRONMENT', description: 'Target Stellar network. Allowed: `testnet`, `mainnet`, `futurenet`' },
  { group: G3, name: 'STELLAR_NETWORK_PASSPHRASE', type: 'string', description: 'Override the network passphrase. Inferred from `STELLAR_NETWORK` when omitted' },
  { group: G3, name: 'STELLAR_SECRET', type: 'string', secret: true, description: 'Legacy alias for the Stellar signing secret in older code paths' },
  { group: G3, name: 'SYNC_MAX_PAGES', type: 'integer', default: 100, max: 1000, description: 'Maximum number of Horizon history pages fetched during a transaction sync pass' },
  { group: G3, name: 'TX_SYNC_INTERVAL_MS', type: 'integer', default: 900000, min: 60000, example: '30000', description: 'Interval (ms) between automatic transaction reconciliation runs' },
  { group: G3, name: 'TX_SYNC_LEASE_MULTIPLIER', type: 'integer', default: 2, min: 1, max: 10, description: 'Sync lease length as a multiple of `TX_SYNC_INTERVAL_MS`' },
  { group: G3, name: 'USE_MOCK_STELLAR', type: 'boolean', default: false, description: 'Alias for `MOCK_STELLAR` in some service modules' },

  // ── Database ────────────────────────────────────────────────────
  { group: G4, name: 'AUDIT_LOG_RETENTION_DAYS', type: 'integer', default: 90, description: 'Number of days to retain audit log entries before they are purged' },
  { group: G4, name: 'DB_ACQUIRE_TIMEOUT', type: 'integer', default: 10000, description: 'Milliseconds to wait for an available pool connection before failing' },
  { group: G4, name: 'DB_PATH', type: 'string', default: './donations.db', example: './data/stellar_donations.db', description: 'File path to the SQLite database (relative to project root)' },
  { group: G4, name: 'DB_POOL_MAX', type: 'integer', default: 10, description: 'Maximum number of concurrent SQLite connections' },
  { group: G4, name: 'DB_POOL_MIN', type: 'integer', default: 1, description: 'Minimum number of idle connections kept in the SQLite pool' },
  { group: G4, name: 'DB_POOL_SIZE', type: 'integer', default: 5, description: 'Alias for `DB_POOL_MAX`. Maximum number of concurrent SQLite connections' },
  { group: G4, name: 'DB_QUERY_TIMEOUT_MS', type: 'integer', default: 5000, description: 'Timeout (ms) applied to individual SQL queries' },
  { group: G4, name: 'DB_TYPE', type: 'string', default: 'sqlite', description: 'Database driver. Currently only `sqlite` is supported' },
  { group: G4, name: 'MIGRATION_LOCK_POLL_INTERVAL_MS', type: 'integer', default: 500, description: 'Polling interval (ms) when waiting for the migration lock' },
  { group: G4, name: 'MIGRATION_LOCK_TIMEOUT_MS', type: 'integer', default: 30000, description: 'Milliseconds to wait for the advisory migration lock before failing' },
  { group: G4, name: 'RETENTION_AUDIT_LOGS_DAYS', type: 'integer', default: 365, min: 0, description: 'Days before audit-log rows are deleted by the retention job' },
  { group: G4, name: 'RETENTION_DONATIONS_DAYS', type: 'integer', default: 2555, min: 0, description: 'Days before donation rows are eligible for retention purge' },
  { group: G4, name: 'RETENTION_DRY_RUN', type: 'boolean', default: false, description: 'When `true`, the retention job logs what it would delete without removing records' },
  { group: G4, name: 'RETENTION_IDEMPOTENCY_DAYS', type: 'integer', default: 30, min: 0, description: 'Days before idempotency keys are purged' },
  { group: G4, name: 'RETENTION_SCHEDULE_CRON', type: 'string', default: '02:00', example: '0 2 * * *', description: 'Cron expression controlling when the data-retention cleanup job runs' },
  { group: G4, name: 'SLOW_QUERY_BUFFER_SIZE', type: 'integer', default: 100, description: 'Number of slow-query records retained in memory for the diagnostics endpoint' },
  { group: G4, name: 'SLOW_QUERY_THRESHOLD_MS', type: 'integer', default: 100, example: '1000', description: 'Queries exceeding this threshold (ms) are logged as slow' },

  // ── CORS ────────────────────────────────────────────────────────
  { group: G5, name: 'CORS_ALLOW_ALL', type: 'boolean', default: false, description: 'Allow every origin. **Startup fails in production if `true`**' },
  { group: G5, name: 'CORS_ALLOWED_HEADERS', type: 'list', default: 'Content-Type,Authorization,X-API-Key,X-Request-ID,X-Idempotency-Key', description: 'Comma-separated request headers allowed through CORS' },
  { group: G5, name: 'CORS_ALLOWED_METHODS', type: 'list', default: 'GET,POST,PUT,PATCH,DELETE,OPTIONS', description: 'Comma-separated HTTP methods allowed in CORS pre-flight responses' },
  { group: G5, name: 'CORS_ALLOWED_ORIGINS', type: 'list', example: 'http://localhost:3000,http://localhost:3001,http://localhost:8080', description: 'Comma-separated list of allowed browser origins. In production, set this explicitly — omitting it rejects all browser origins' },
  { group: G5, name: 'CORS_MAX_AGE', type: 'integer', default: 86400, description: '`Access-Control-Max-Age` value in seconds (how long browsers may cache pre-flight results)' },

  // ── Logging ─────────────────────────────────────────────────────
  { group: G6, name: 'ACCESS_LOG_INCLUDE_HEALTH', type: 'boolean', default: false, description: 'When `true`, health-check requests appear in the access log' },
  { group: G6, name: 'AUDIT_LOG_FLUSH_INTERVAL_MS', type: 'integer', default: 1000, min: 1, description: 'Interval (ms) at which buffered audit-log entries are flushed to the database' },
  { group: G6, name: 'DEBUG_MODE', type: 'boolean', default: false, example: 'false', description: 'Enable verbose debug logging. **Startup fails in production if `true`**' },
  { group: G6, name: 'LOG_BODY', type: 'boolean', default: false, description: 'Log raw request and response bodies' },
  { group: G6, name: 'LOG_BODY_PATHS', type: 'list', description: 'Comma-separated path prefixes for which request bodies are logged (overrides `LOG_BODY`)' },
  { group: G6, name: 'LOG_DIR', type: 'string', default: './logs', example: './logs', description: 'Directory for log files when `LOG_TO_FILE=true`' },
  { group: G6, name: 'LOG_FORMAT', type: 'enum', default: 'text', enum: ['json', 'text'], example: 'json', description: 'Log output format: `json` or `pretty`' },
  { group: G6, name: 'LOG_HEADERS', type: 'boolean', default: false, description: 'Include request headers in access log entries' },
  { group: G6, name: 'LOG_LEVEL', type: 'string', default: 'info', description: 'Minimum log level: `debug`, `info`, `warn` or `error`' },
  { group: G6, name: 'LOG_MAX_BACKUPS', type: 'integer', default: 10, min: 1, description: 'Number of rotated log files to retain' },
  { group: G6, name: 'LOG_MAX_SIZE', type: 'integer', default: 52428800, description: 'Maximum log file size in bytes before rotation' },
  { group: G6, name: 'LOG_SAMPLE_RATE', type: 'number', default: 1, min: 0, max: 1, description: 'Fraction of requests to log (0–1). `1` logs every request' },
  { group: G6, name: 'LOG_SKIP_PATHS', type: 'list', description: 'Comma-separated paths excluded from access log output' },
  { group: G6, name: 'LOG_TO_FILE', type: 'boolean', default: false, example: 'false', description: 'Write logs to rotating files in addition to stdout' },
  { group: G6, name: 'LOG_VERBOSE', type: 'boolean', default: false, example: 'false', description: 'Include request/response bodies in console log output' },

  // ── Rate Limiting ───────────────────────────────────────────────
  { group: G7, name: 'AUTH_REFRESH_RATE_LIMIT', type: 'integer', default: 20, example: '20', description: 'Maximum requests per minute per IP on `POST /auth/refresh`' },
  { group: G7, name: 'AUTH_TOKEN_RATE_LIMIT', type: 'integer', default: 10, example: '10', description: 'Maximum requests per minute per IP on `POST /auth/token`' },
  { group: G7, name: 'DISABLE_RATE_LIMIT', type: 'boolean', default: false, description: 'Disables rate limiting. **Unsafe — startup fails in production if `true`**' },
  { group: G7, name: 'RATE_LIMIT', type: 'integer', default: 100, example: '100', description: 'Maximum requests per IP per rate-limit window (global limiter)' },
  { group: G7, name: 'RATE_LIMIT_CLEANUP_INTERVAL_MS', type: 'integer', default: 60000, description: 'Interval (ms) between in-memory store cleanup passes that evict expired windows' },
  { group: G7, name: 'RATE_LIMIT_FAIL_OPEN', type: 'boolean', default: true, description: 'When `RATE_LIMIT_STORE=redis`, controls behaviour on Redis unavailability. `true` = allow requests; `false` = deny requests' },
  { group: G7, name: 'RATE_LIMIT_MAX_REQUESTS', type: 'integer', default: 100, description: 'Alias for `RATE_LIMIT` used in some middleware' },
  { group: G7, name: 'RATE_LIMIT_STORE', type: 'enum', default: 'memory', enum: ['memory', 'redis'], description: 'Backing store for rate-limit counters: `memory` or `redis`. Use `redis` in multi-instance deployments' },
  { group: G7, name: 'RATE_LIMIT_WINDOW_MS', type: 'integer', default: 60000, description: 'Rolling window duration (ms) for the global rate limiter' },
  { group: G7, name: 'REDIS_URL', type: 'url', secret: true, description: 'Redis connection URL (e.g. `redis://localhost:6379`). Required when `RATE_LIMIT_STORE=redis`' },

  // ── Donation Limits & Business Logic ────────────────────────────
  { group: G8, name: 'BULK_DONATION_CONCURRENCY', type: 'integer', default: 5, description: 'Number of donations processed in parallel during a batch submission' },
  { group: G8, name: 'BULK_IMPORT_BATCH_SIZE', type: 'integer', default: 50, min: 1, description: 'Default database chunk size for bulk wallet imports' },
  { group: G8, name: 'BULK_IMPORT_MAX_ROWS', type: 'integer', default: 1000, description: 'Maximum number of rows accepted per bulk wallet-import request' },
  { group: G8, name: 'BULK_IMPORT_MAX_SIZE_BYTES', type: 'integer', default: 1048576, description: 'Maximum size (bytes) of a bulk import payload' },
  { group: G8, name: 'DISPUTE_WINDOW_DAYS', type: 'integer', default: 30, description: 'Number of days after which a donation can no longer be disputed' },
  { group: G8, name: 'DONATION_APPROVAL_EXPIRY_INTERVAL_MS', type: 'integer', default: 300000, min: 1, description: 'Interval (ms) of the worker that expires stale multi-signer donation approvals' },
  { group: G8, name: 'EXPORT_BATCH_SIZE', type: 'integer', default: 500, min: 1, description: 'Rows fetched per batch when generating donation exports' },
  { group: G8, name: 'MAX_DAILY_DONATION_PER_DONOR', type: 'number', default: 0, example: '0', description: 'Daily XLM cap per donor. `0` disables the cap' },
  { group: G8, name: 'MAX_DONATION_AMOUNT', type: 'number', default: 10000, example: '10000', description: 'Maximum accepted donation amount in XLM' },
  { group: G8, name: 'MAXIMUM_FEE_XLM', type: 'number', default: 10, example: '0.1', description: 'Maximum platform fee cap in XLM regardless of `PLATFORM_FEE_PERCENT`' },
  { group: G8, name: 'MIN_DONATION_AMOUNT', type: 'number', default: 0.01, example: '0.01', description: 'Minimum accepted donation amount in XLM' },
  { group: G8, name: 'MINIMUM_FEE_XLM', type: 'number', default: 0.01, description: 'Minimum platform fee in XLM regardless of `PLATFORM_FEE_PERCENT`' },
  { group: G8, name: 'MULTISIG_APPROVAL_WINDOW_MS', type: 'integer', default: 259200000, min: 60000, description: 'How long (ms) a pending multi-signer approval stays open' },
  { group: G8, name: 'MULTISIG_REQUIRED_APPROVALS', type: 'integer', default: 2, min: 2, max: 20, description: 'Approvals required for donations above `MULTISIG_THRESHOLD_XLM`' },
  { group: G8, name: 'MULTISIG_THRESHOLD_XLM', type: 'number', min: 0, description: 'Donations above this amount (XLM) require multi-signer approval. Unset disables the workflow. Must be below `MAX_DONATION_AMOUNT`' },
  { group: G8, name: 'OVERPAYMENT_TOLERANCE_XLM', type: 'number', default: 0.01, min: 0, description: 'Overpayment (XLM) tolerated before a donation is flagged as overpaid' },
  { group: G8, name: 'PLATFORM_FEE_PERCENT', type: 'number', default: 1.5, example: '0', description: 'Platform fee percentage deducted from each donation (0–100)' },
  { group: G8, name: 'PLEDGE_EXPIRY_INTERVAL_MS', type: 'integer', default: 60000, description: 'Interval (ms) between pledge expiry check runs' },
  { group: G8, name: 'RECENT_DONATIONS_CACHE_TTL_SECONDS', type: 'integer', default: 5, description: 'TTL (seconds) for the recent-donations response cache' },
  { group: G8, name: 'RECENT_DONATIONS_MAX_LIMIT', type: 'integer', default: 100, description: 'Maximum number of records returned by the recent-donations endpoint' },
  { group: G8, name: 'REFUND_ELIGIBILITY_WINDOW_DAYS', type: 'integer', default: 30, description: 'Days within which a donation is eligible for refund consideration' },
  { group: G8, name: 'REFUND_WINDOW_HOURS', type: 'integer', default: 24, description: 'Hours after a donation during which a refund can be initiated' },
  { group: G8, name: 'SCHEDULER_LOCK_TTL_MS', type: 'integer', default: 90000, min: 1, description: 'Lease TTL (ms) for the recurring-donation scheduler lock (one scheduler per cluster)' },
  { group: G8, name: 'VELOCITY_LIMIT_FREE', type: 'integer', default: 5, min: 1, description: 'Donations per `VELOCITY_WINDOW_SECONDS` allowed for free-tier keys' },
  { group: G8, name: 'VELOCITY_LIMIT_PREMIUM', type: 'integer', default: 100, min: 1, description: 'Donations per window allowed for premium-tier keys' },
  { group: G8, name: 'VELOCITY_LIMIT_STANDARD', type: 'integer', default: 20, min: 1, description: 'Donations per window allowed for standard-tier keys' },
  { group: G8, name: 'VELOCITY_WINDOW_SECONDS', type: 'integer', default: 3600, min: 1, description: 'Window (seconds) for donation velocity limits' },

  // ── Caching ─────────────────────────────────────────────────────
  { group: G9, name: 'API_KEY_CACHE_TTL_SECONDS', type: 'integer', default: 60, description: 'TTL (seconds) for the in-memory API key lookup cache' },
  { group: G9, name: 'CACHE_CLEANUP_INTERVAL_MS', type: 'integer', default: 60000, description: 'Interval (ms) between cache eviction passes' },
  { group: G9, name: 'CACHE_MAX_SIZE', type: 'integer', default: 10000, example: '1000', description: 'Maximum number of entries in the shared in-memory LRU cache' },
  { group: G9, name: 'FEDERATION_CACHE_CLEANUP_INTERVAL_MS', type: 'integer', default: 300000, description: 'Interval (ms) between federation cache cleanup passes' },
  { group: G9, name: 'FEDERATION_CACHE_MAX_SIZE', type: 'integer', default: 5000, description: 'Maximum number of cached federation records' },
  { group: G9, name: 'FEDERATION_CACHE_TTL', type: 'integer', default: 300, description: 'TTL (seconds) for Stellar federation record lookups' },
  { group: G9, name: 'LEADERBOARD_CACHE_TTL_SECONDS', type: 'integer', default: 60, min: 1, description: 'TTL (seconds) of the leaderboard stats cache' },
  { group: G9, name: 'STATS_CACHE_TTL_SECONDS', type: 'integer', default: 60, description: 'TTL (seconds) for the donation stats cache' },
  { group: G9, name: 'STATS_SUMMARY_CACHE_TTL_SECONDS', type: 'integer', default: 60, description: 'TTL (seconds) for the donation stats-summary cache' },
  { group: G9, name: 'WALLET_BALANCE_CACHE_TTL_SECONDS', type: 'integer', default: 30, description: 'TTL (seconds) for cached wallet-balance responses' },

  // ── SMTP / Email Receipts ───────────────────────────────────────
  { group: G10, name: 'ADMIN_ALERT_EMAIL', type: 'string', description: 'Recipient address for service-account low-balance alert emails' },
  { group: G10, name: 'NOTIFICATION_EMAIL', type: 'string', description: 'Recipient for export-ready notification emails when the job has no email. Falls back to `SMTP_TO`' },
  { group: G10, name: 'SMTP_FROM', type: 'string', description: 'Sender address for outbound emails. Must be verified with your SMTP provider' },
  { group: G10, name: 'SMTP_HOST', type: 'string', example: 'smtp-relay.brevo.com', description: 'SMTP relay hostname (e.g. `smtp-relay.brevo.com`)' },
  { group: G10, name: 'SMTP_PASS', type: 'string', secret: true, description: 'SMTP authentication password (alias: `SMTP_PASSWORD`)' },
  { group: G10, name: 'SMTP_PASSWORD', type: 'string', secret: true, description: 'Alias for `SMTP_PASS`' },
  { group: G10, name: 'SMTP_PORT', type: 'integer', default: 587, description: 'SMTP port' },
  { group: G10, name: 'SMTP_SECURE', type: 'boolean', default: false, description: 'Use TLS (`true`) or STARTTLS (`false`) for SMTP connections' },
  { group: G10, name: 'SMTP_TO', type: 'string', description: 'Fallback recipient for export notifications' },
  { group: G10, name: 'SMTP_USER', type: 'string', description: 'SMTP authentication username' },

  // ── IPFS / Pinata ───────────────────────────────────────────────
  { group: G11, name: 'IPFS_GATEWAY_URL', type: 'string', default: 'https://gateway.pinata.cloud/ipfs', description: 'Public IPFS gateway base URL used to construct certificate links' },
  { group: G11, name: 'PINATA_API_KEY', type: 'string', secret: true, description: 'Pinata API key for pinning donation impact certificates to IPFS' },
  { group: G11, name: 'PINATA_SECRET_KEY', type: 'string', secret: true, description: 'Pinata API secret corresponding to `PINATA_API_KEY`' },

  // ── Geographic Blocking ─────────────────────────────────────────
  { group: G12, name: 'GEO_ALLOWED_COUNTRIES', type: 'list', description: 'Country codes that are always allowed, overriding `GEO_BLOCKED_COUNTRIES`' },
  { group: G12, name: 'GEO_ALLOWED_IPS', type: 'list', description: 'Comma-separated IPs or CIDR ranges that bypass geo-blocking' },
  { group: G12, name: 'GEO_BLOCKED_COUNTRIES', type: 'list', description: 'Comma-separated ISO 3166-1 alpha-2 country codes whose requests are blocked (e.g. `RU,IR,KP`)' },
  { group: G12, name: 'GEO_STRICT_MODE', type: 'boolean', default: true, description: 'When the GeoIP database is unavailable or a lookup fails, block () or allow () the request' },
  { group: G12, name: 'MAXMIND_DB_PATH', type: 'string', default: './data/GeoLite2-Country.mmdb', description: 'Path to the MaxMind GeoLite2-Country binary database file' },

  // ── Abuse Detection ─────────────────────────────────────────────
  { group: G13, name: 'ABUSE_ANOMALY_THRESHOLD', type: 'number', default: 0.8, min: 0, max: 1, description: 'Anomaly score (0–1) above which a request pattern is flagged as anomalous' },
  { group: G13, name: 'ABUSE_BLOCK_DURATION_MS', type: 'integer', default: 86400000, example: '3600000', description: 'Duration (ms) a flagged IP remains in the suspicious list' },
  { group: G13, name: 'ABUSE_DB_PATH', type: 'string', description: 'Optional path to a persistent SQLite file for abuse-detection tracking. If unset, tracking is in-memory only' },
  { group: G13, name: 'ABUSE_PATTERN_THRESHOLD', type: 'integer', default: 5, min: 1, description: 'Number of repeated suspicious patterns that triggers the pattern-detection signal' },
  { group: G13, name: 'ABUSE_SUSPICIOUS_THRESHOLD', type: 'integer', default: 10, example: '100', description: 'Number of requests within `ABUSE_WINDOW_MS` that triggers the burst-detection signal' },
  { group: G13, name: 'ABUSE_VELOCITY_THRESHOLD', type: 'integer', default: 30, min: 1, description: 'Requests within `ABUSE_VELOCITY_WINDOW_MS` that trigger the velocity signal' },
  { group: G13, name: 'ABUSE_VELOCITY_WINDOW_MS', type: 'integer', default: 60000, min: 1, description: 'Rolling window (ms) for the velocity signal' },
  { group: G13, name: 'ABUSE_WINDOW_MS', type: 'integer', default: 3600000, example: '60000', description: 'Rolling window (ms) in which request counts are tracked for burst detection' },

  // ── Replay & Deduplication ──────────────────────────────────────
  { group: G14, name: 'BODY_DEDUP_WINDOW_SECONDS', type: 'integer', default: 60, min: 1, description: 'Window (seconds) in which identical mutating requests without an Idempotency-Key are deduplicated by body hash' },
  { group: G14, name: 'MEMO_COLLISION_WINDOW_MS', type: 'integer', default: 300000, description: 'Window (ms) in which duplicate memo values are considered collisions' },
  { group: G14, name: 'MEMO_KEYS_DIR', type: 'string', default: './data/memo-keys', description: 'Directory where memo encryption keys are persisted' },
  { group: G14, name: 'NONCE_CLEANUP_INTERVAL_MS', type: 'integer', default: 300000, description: 'Interval (ms) between nonce-store cleanup passes' },
  { group: G14, name: 'NONCE_MAX_SIZE', type: 'integer', default: 100000, description: 'Maximum number of nonce entries held in memory' },
  { group: G14, name: 'REPLAY_CLEANUP_INTERVAL_SECONDS', type: 'integer', default: 60, description: 'Interval (seconds) between replay-store cleanup passes' },
  { group: G14, name: 'REPLAY_DETECTION_TIMEOUT_MS', type: 'integer', default: 200, description: 'Timeout (ms) for the replay-detection store lookup' },
  { group: G14, name: 'REPLAY_THRESHOLD', type: 'integer', default: 3, description: 'Number of duplicate signatures allowed before rejection' },
  { group: G14, name: 'REPLAY_WINDOW_SECONDS', type: 'integer', default: 60, example: '300', description: 'Window (seconds) within which a duplicate request signature is rejected' },

  // ── Backup ──────────────────────────────────────────────────────
  { group: G15, name: 'AWS_REGION', type: 'string', default: 'us-east-1', description: 'AWS region used for S3 backup uploads (and KMS if applicable)' },
  { group: G15, name: 'BACKUP_DIR', type: 'string', default: './data/backups', description: 'Local directory where encrypted database backup files are written' },
  { group: G15, name: 'BACKUP_INTERVAL_MS', type: 'integer', default: 86400000, example: '3600000', description: 'Interval (ms) between automatic backup runs' },
  { group: G15, name: 'BACKUP_S3_BUCKET', type: 'string', description: 'S3 bucket name for off-site backup upload. When unset, backups are local only' },
  { group: G15, name: 'BACKUP_S3_PREFIX', type: 'string', default: 'backups/', description: 'Key prefix used when uploading backup files to S3' },

  // ── SSE / WebSocket Streaming ───────────────────────────────────
  { group: G16, name: 'ENABLE_SERVER_PUSH', type: 'boolean', default: false, description: 'Enable server-sent event (SSE) and WebSocket push endpoints' },
  { group: G16, name: 'LEADERBOARD_KEEPALIVE_MS', type: 'integer', default: 15000, description: 'Interval (ms) between keepalive comments on the leaderboard SSE stream' },
  { group: G16, name: 'PUBSUB_ADAPTER', type: 'enum', default: 'memory', enum: ['memory', 'redis'], description: 'Pub/sub adapter: `memory` (in-process) or `redis`' },
  { group: G16, name: 'SSE_EVENT_BUFFER_SIZE', type: 'integer', default: 100, description: 'Number of events buffered per SSE connection for reconnecting clients' },
  { group: G16, name: 'SSE_MAX_CONNECTIONS_PER_KEY', type: 'integer', default: 5, min: 1, example: '10', description: 'Maximum concurrent SSE streams per API key. Enforced cluster-wide when `SHARED_STATE_BACKEND=redis`' },
  { group: G16, name: 'WS_HEARTBEAT_MS', type: 'integer', default: 30000, description: 'Interval (ms) between WebSocket ping frames' },
  { group: G16, name: 'WS_MAX_WALLETS', type: 'integer', default: 50, description: 'Maximum number of wallet subscriptions per WebSocket connection' },

  // ── Observability & Tracing ─────────────────────────────────────
  { group: G17, name: 'ANOMALY_WEBHOOK_URL', type: 'string', description: 'URL to POST anomaly-detection alerts to. When unset, alerts are logged only' },
  { group: G17, name: 'ORPHAN_ALERT_THRESHOLD', type: 'integer', default: 1, description: 'Number of orphaned transactions before an alert is triggered' },
  { group: G17, name: 'OTEL_ENABLED', type: 'boolean', default: true, example: 'false', description: 'Enable OpenTelemetry tracing. Set `false` to disable' },
  { group: G17, name: 'OTEL_EXPORTER_OTLP_ENDPOINT', type: 'url', example: 'http://collector:4318', description: 'OTLP exporter endpoint URL (e.g. `http://collector:4318`)' },
  { group: G17, name: 'OTEL_EXPORTER_OTLP_HEADERS', type: 'string', description: 'Comma-separated `key=value` pairs added as headers to OTLP export requests' },
  { group: G17, name: 'OTEL_SERVICE_NAME', type: 'string', default: 'stellar-donation-api', description: 'Service name reported to the OTLP collector' },

  // ── Organisation Metadata ───────────────────────────────────────
  { group: G18, name: 'ORGANIZATION_ADDRESS', type: 'string', description: 'Street address printed on tax receipts' },
  { group: G18, name: 'ORGANIZATION_CITY', type: 'string', description: 'City component of the organisation\'s mailing address' },
  { group: G18, name: 'ORGANIZATION_EIN', type: 'string', description: 'Employer Identification Number (EIN) printed on tax receipts' },
  { group: G18, name: 'ORGANIZATION_EMAIL', type: 'string', description: 'Contact email address printed on receipts' },
  { group: G18, name: 'ORGANIZATION_LEGAL_NAME', type: 'string', description: 'Legal name of the organisation for receipt headers' },
  { group: G18, name: 'ORGANIZATION_PHONE', type: 'string', description: 'Contact phone number printed on receipts' },
  { group: G18, name: 'ORGANIZATION_STATE', type: 'string', description: 'State/province component of the organisation\'s mailing address' },
  { group: G18, name: 'ORGANIZATION_WEBSITE', type: 'string', description: 'Website URL printed on receipts' },
  { group: G18, name: 'ORGANIZATION_ZIP_CODE', type: 'string', description: 'Postal code component of the organisation\'s mailing address' },

  // ── Signing Providers (HSM / KMS) ───────────────────────────────
  { group: G19, name: 'AWS_KMS_KEY_ID', type: 'string', description: 'Alias of `KMS_KEY_ID` read by the `generate-key` script' },
  { group: G19, name: 'HSM_PIN', type: 'string', secret: true, description: 'PKCS#11 slot PIN when `SIGNING_PROVIDER=hsm`' },
  { group: G19, name: 'HSM_SLOT_ID', type: 'string', description: 'PKCS#11 slot ID when `SIGNING_PROVIDER=hsm`' },
  { group: G19, name: 'KMS_KEY_ID', type: 'string', description: 'KMS key ARN (AWS) or resource name (GCP) for remote signing' },
  { group: G19, name: 'KMS_PROVIDER', type: 'string', default: 'local', description: 'Cloud KMS provider: `aws` or `gcp`' },

  // ── Miscellaneous / Feature Config ──────────────────────────────
  { group: G20, name: 'API_BASE_URL', type: 'string', example: 'http://localhost:3000', description: 'Publicly accessible base URL of this API, used in signed download links. Defaults to `http://localhost:$PORT`' },
  { group: G20, name: 'COINGECKO_API_KEY', type: 'string', secret: true, description: 'CoinGecko API key (`CG-…` format) for XLM/fiat exchange rate lookups. Without this, the unauthenticated endpoint is used (stricter rate limits)' },
  { group: G20, name: 'COMPRESSION_LEVEL', type: 'integer', default: 4, min: 1, max: 9, description: 'zlib compression level (1–9) for gzip response encoding' },
  { group: G20, name: 'COMPRESSION_THRESHOLD_BYTES', type: 'integer', default: 1024, description: 'Minimum response size (bytes) before compression is applied' },
  { group: G20, name: 'CSP_REPORT_ONLY', type: 'boolean', default: false, description: 'When `true`, CSP violations are reported but not enforced' },
  { group: G20, name: 'CSP_REPORT_URI', type: 'string', default: '/csp-report', description: 'URI to which CSP violation reports are sent' },
  { group: G20, name: 'ENABLE_CHANGELOG_ENDPOINT', type: 'boolean', default: false, description: 'Mount the public `/changelog` endpoint' },
  { group: G20, name: 'FEATURE_FLAGS', type: 'string', description: 'JSON object of feature-flag overrides, e.g. `{"newDonationFlow":true}`. See [docs/FEATURE_FLAGS_RUNTIME.md](./FEATURE_FLAGS_RUNTIME.md)' },
  { group: G20, name: 'FEDERATION_DOMAIN', type: 'string', description: 'Domain used for Stellar federation lookups' },
  { group: G20, name: 'FEDERATION_RECORDS', type: 'string', description: 'JSON-encoded static federation records for local development, bypassing live federation lookups' },
  { group: G20, name: 'WEBHOOK_ALLOW_TLS_SKIP_VERIFY', type: 'string', example: 'false', description: 'Set to `break-glass` to allow webhooks with TLS verification disabled in production. Any other value is ignored' },
  { group: G20, name: 'WEBHOOK_RETRY_INTERVAL_MS', type: 'integer', default: 30000, min: 1, description: 'Interval (ms) of the outgoing-webhook retry worker' },
  { group: G20, name: 'XLM_USDC_ASSET', type: 'string', example: 'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', description: '`CODE:ISSUER` of the stablecoin used for the Stellar DEX price fallback. The XLM/USD rate is the mid-market price of this orderbook when CoinGecko is unavailable' },

  // ── Shared State (Multi-Instance) ───────────────────────────────
  { group: G21, name: 'INBOUND_WEBHOOK_SOURCES', type: 'json', description: 'JSON array of inbound webhook sources registered at boot on every instance, e.g. `[{"name":"stripe","secretEnv":"STRIPE_WEBHOOK_SECRET","headerName":"stripe-signature"}]`' },
  { group: G21, name: 'SHARED_STATE_BACKEND', type: 'enum', default: 'memory', enum: ['memory', 'redis'], description: 'Backend for correctness-critical state (body-hash dedup, request-signing nonces, SSE per-key limits). Use `redis` when running more than one replica' },
  { group: G21, name: 'SHARED_STATE_FAIL_OPEN', type: 'boolean', default: true, description: 'When the shared backend is unreachable, fall back to per-process state (`true`) or reject the request (`false`)' },
  { group: G21, name: 'SHARED_STATE_KEY_PREFIX', type: 'string', default: 'smd:', description: 'Prefix for every key written to the shared-state backend' },
  { group: G21, name: 'SHARED_STATE_REDIS_URL', type: 'url', secret: true, description: 'Redis URL for the shared-state backend. Falls back to `REDIS_URL`' },

  // ── GraphQL ─────────────────────────────────────────────────────
  { group: G22, name: 'GRAPHQL_LIST_FIELD_COST', type: 'integer', default: 10, min: 1, description: 'Complexity cost assigned to each list field' },
  { group: G22, name: 'GRAPHQL_MAX_COMPLEXITY', type: 'integer', default: 1000, min: 1, description: 'Maximum computed query complexity before a GraphQL query is rejected' },
  { group: G22, name: 'GRAPHQL_MAX_DEPTH', type: 'integer', default: 6, min: 1, description: 'Maximum GraphQL query nesting depth' },
];

/**
 * Variables read through a dynamic name (e.g. `process.env[\`ENCRYPTION_KEY_${n}\`]`).
 * Each pattern must be matched by any name the code constructs at runtime.
 */
const ENV_VAR_PATTERNS = [
  { pattern: /^ENCRYPTION_KEY_\d+$/, group: G2, description: 'Versioned encryption keys used during rotation (`ENCRYPTION_KEY_1`, `ENCRYPTION_KEY_2`, …)' },
];

/** Variables set by tooling rather than operators; exempt from documentation. */
const IMPLICIT_ENV_VARS = new Set(['npm_package_version']);

const GROUPS = [...new Set(ENV_VARS.map((v) => v.group))];

module.exports = { ENV_VARS, ENV_VAR_PATTERNS, IMPLICIT_ENV_VARS, GROUPS };
