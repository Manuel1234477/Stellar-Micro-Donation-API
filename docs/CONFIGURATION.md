# Configuration Guide

This document is the authoritative reference for every environment variable read by the
application. Variables are grouped by concern. For each variable the table shows:

- **Type** — `string | integer | number | boolean | enum | list | url | json`
- **Default** — value used when the variable is absent (`—` means no default)
- **Required?** — `yes` = server refuses to start without it; `production` = required
  when `NODE_ENV=production`; `no` = optional
- **Effect** — what the variable controls

The reference tables are **generated** from `src/config/envSchema.js`, which is also used
to validate the environment at startup (`src/config/env.js`) and to generate
`.env.example`. To add or change a variable, edit the schema and run:

```bash
npm run config:generate   # rewrite .env.example and the tables below
npm run config:check      # what CI runs: schema covers src/, generated files are current
```

> **Tip:** Copy `.env.example` to `.env` and fill in the required variables before
> starting the server locally.

---

<!-- BEGIN GENERATED: env reference — edit src/config/envSchema.js, then run `npm run config:generate` -->

## Contents

1. [Server](#1-server)
2. [Authentication & API Keys](#2-authentication--api-keys)
3. [Encryption & Secrets](#3-encryption--secrets)
4. [Stellar / Horizon](#4-stellar--horizon)
5. [Database](#5-database)
6. [CORS](#6-cors)
7. [Logging](#7-logging)
8. [Rate Limiting](#8-rate-limiting)
9. [Donation Limits & Business Logic](#9-donation-limits--business-logic)
10. [Caching](#10-caching)
11. [SMTP / Email Receipts](#11-smtp--email-receipts)
12. [IPFS / Pinata](#12-ipfs--pinata)
13. [Geographic Blocking](#13-geographic-blocking)
14. [Abuse Detection](#14-abuse-detection)
15. [Replay & Deduplication](#15-replay--deduplication)
16. [Backup](#16-backup)
17. [SSE / WebSocket Streaming](#17-sse--websocket-streaming)
18. [Observability & Tracing](#18-observability--tracing)
19. [Organisation Metadata](#19-organisation-metadata)
20. [Signing Providers (HSM / KMS)](#20-signing-providers-hsm--kms)
21. [Miscellaneous / Feature Config](#21-miscellaneous--feature-config)
22. [Shared State (Multi-Instance)](#22-shared-state-multi-instance)
23. [GraphQL](#23-graphql)

260 variables are declared. Further topics follow the reference below.

---

## 1. Server

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `API_PREFIX` | string | `/api/v1` | no | Base path prefix prepended to all API routes |
| `INSTANCE_ID` | string | — | no | Unique identifier for this process instance (used for scheduler/sequence leases and logs). Defaults to a random UUID |
| `NODE_ENV` | string | `development` | no | Runtime environment: `development`, `test` or `production`. Controls logging verbosity, startup guards and unsafe-flag checks |
| `PORT` | integer | `3000` | no | TCP port the HTTP server listens on |
| `REQUEST_TIMEOUT_MS` | integer | `30000` | no | Global per-request timeout in milliseconds. Streaming endpoints are exempt |
| `SHUTDOWN_TIMEOUT` | integer | `30000` | no | Alias for `SHUTDOWN_TIMEOUT_MS` (milliseconds). Time allowed for in-flight requests to drain before force-exit |
| `SHUTDOWN_TIMEOUT_MS` | integer | `30000` | no | Milliseconds to wait for graceful shutdown before force-exit |
| `TRUSTED_PROXIES` | string | `loopback` | no | Comma-separated list of trusted proxy IPs/CIDRs. Passed to Express `trust proxy`. Set to the address of your load balancer in production |

---

## 2. Authentication & API Keys

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `API_KEY_EXPIRED_WINDOW_DAYS` | integer | `1` | no | Notify owners of keys that expired within this many days Minimum: 0. |
| `API_KEY_EXPIRY_WARN_DAYS` | list (comma-separated) | `1,7,30` | no | Comma-separated days-before-expiry at which key owners are warned (e.g. `30,7,1`) |
| `API_KEY_HEADER_WINDOW_DAYS` | integer | `30` | no | Include the `X-API-Key-Expires-In` response header for keys within this many days of expiry Minimum: 0. |
| `API_KEY_WEBHOOK_TIMEOUT_MS` | integer | `10000` | no | Timeout (ms) for API-key expiry notification webhooks Minimum: 1000. |
| `API_KEYS` | list (comma-separated) | — | **yes** | Comma-separated list of raw API keys accepted by the legacy authentication path. At least one key is required Secret. |
| `AUTH_LOCKOUT_MS` | integer | `900000` | no | Duration (ms) of the authentication lockout |
| `AUTH_MAX_ATTEMPTS` | integer | `5` | no | Maximum failed authentication attempts before an IP is locked out |
| `AUTH_WINDOW_MS` | integer | `900000` | no | Rolling window (ms) in which `AUTH_MAX_ATTEMPTS` failures trigger lockout |
| `HOME_DOMAIN` | string | — | no | Stellar home domain used in SEP-10 web-auth challenges |
| `JWT_SECRET` | string | — | no | Secret used to sign and verify JWT tokens. Must satisfy [secret strength rules](#25-secret-strength-requirements) if set Secret. |
| `REFRESH_TOKEN_ABSOLUTE_TTL_DAYS` | number | `30` | no | Absolute lifetime (days) of a refresh-token family, regardless of rotation Minimum: 0. |
| `REQUEST_SIGNING_SECRET` | string | — | no | HMAC secret used to verify inbound request signatures Secret. |
| `REQUEST_SIGNING_WINDOW_SECONDS` | integer | `300` | no | Seconds of clock skew tolerated in signed requests |
| `REQUIRE_ADMIN_2FA` | boolean | `false` | no | When `true`, admin endpoints require a valid TOTP code alongside the API key |
| `REQUIRE_IDEMPOTENCY_KEY` | boolean | `false` | no | When `true`, POST/PATCH/PUT requests without `X-Idempotency-Key` are rejected |
| `REQUIRE_REQUEST_SIGNING` | boolean | `false` | no | When `true`, every mutating request must carry a valid HMAC request signature |
| `SEP10_CHALLENGE_TTL` | integer | `300` | no | Seconds a SEP-10 challenge token remains valid |
| `SIGNED_URL_EXPIRY_MS` | integer | `3600000` | no | Lifetime of signed download/export URLs in milliseconds |
| `TOTP_ISSUER` | string | `StellarDonationAPI` | no | Issuer label embedded in TOTP QR codes |
| `TOTP_WINDOW` | integer | `1` | no | Number of 30-second TOTP windows (±) accepted to tolerate clock skew |

---

## 3. Encryption & Secrets

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ANONYMOUS_DONATION_SECRET` | string | — | no | Secret from which anonymous donor tokens are derived. Must be distinct from `ENCRYPTION_KEY` Secret. |
| `ENCRYPTED_ENCRYPTION_KEY` | string | — | no | KMS-wrapped `ENCRYPTION_KEY`. Unwrapped at startup when `KMS_KEY_ID` is set Secret. |
| `ENCRYPTION_KEY` | string | — | **production** | AES-256 key used to encrypt wallet secret keys and other sensitive data at rest. Generate with `npm run generate-key`. **Changing this key makes all previously encrypted data unrecoverable.** Secret. |
| `ENCRYPTION_KEY_1` | string | — | no | Previous encryption key used during key rotation. Required when `ENCRYPTION_KEY_VERSION=1` Secret. |
| `ENCRYPTION_KEY_VERSION` | integer | `1` | no | Active encryption key version. `1` requires `ENCRYPTION_KEY_1` (the previous key) for rotation. Additional versions are read from `ENCRYPTION_KEY_<N>` |
| `ENCRYPTION_PRIVATE_KEY` | string | — | no | RSA/EC private key PEM used by asymmetric signing paths Secret. |
| `ENCRYPTION_PUBLIC_KEY` | string | — | no | RSA/EC public key PEM used to verify asymmetric signatures |
| `ENCRYPTION_SECRET` | string | — | no | Legacy symmetric encryption secret for non-wallet data paths Secret. |
| `EXPORT_SIGNING_SECRET` | string | — | no | HMAC secret for signing CSV/JSON export files. Must be distinct from `ENCRYPTION_KEY` Secret. |
| `MEMO_REENCRYPT_BATCH_SIZE` | integer | `50` | no | Memos processed per batch by the background re-encryption job Minimum: 1. |
| `MEMO_REENCRYPT_INTERVAL_MS` | integer | `30000` | no | Interval (ms) between memo re-encryption batches Minimum: 1. |
| `NEW_ENCRYPTION_KEY` | string | — | no | Target key during a live re-encryption pass (`npm run migrate:reencrypt`) Secret. |
| `ROTATION_LOCK_CACHE_TTL_MS` | integer | `5000` | no | TTL (ms) of the cached key-rotation lock state Minimum: 0. |
| `ROTATION_LOCK_WARN_INTERVAL_MS` | integer | `60000` | no | Minimum interval (ms) between "rotation in progress" warnings Minimum: 0. |
| `SIGNING_PROVIDER` | string | `software` | no | Transaction signing provider: `software`/`local` (in-process key), `hsm` or `kms` |
| `STRIPE_WEBHOOK_SECRET` | string | — | no | HMAC secret for the `stripe` inbound webhook source Secret. |
| `^ENCRYPTION_KEY_\d+$` (pattern) | string | — | no | Versioned encryption keys used during rotation (`ENCRYPTION_KEY_1`, `ENCRYPTION_KEY_2`, …) |

---

## 4. Stellar / Horizon

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ALLOW_TESTNET_IN_PRODUCTION` | boolean | `false` | no | Break-glass override that allows `NODE_ENV=production` to target testnet. Startup fails without it |
| `BALANCE_ALERT_THRESHOLD_XLM` | number | `10` | no | Service-account balance (XLM) below which a warning alert is sent Minimum: 0. |
| `BALANCE_CHECK_INTERVAL_MS` | integer | `300000` | no | Interval (ms) between service-account balance checks Minimum: 1. |
| `BALANCE_CRITICAL_THRESHOLD_XLM` | number | `2` | no | Service-account balance (XLM) below which a critical alert is sent Minimum: 0. |
| `CONFIRMATION_CHECK_INTERVAL_MS` | integer | `5000` | no | Interval (ms) between background confirmation threshold checks for pending transactions (#1606) |
| `CONFIRMATION_LEDGER_THRESHOLD` | integer | — | no | Deprecated alias of `CONFIRMATION_THRESHOLD` **Deprecated** — Use CONFIRMATION_THRESHOLD. |
| `CONFIRMATION_THRESHOLD` | integer | `1` | no | Number of ledger closings required before a transaction is considered confirmed (min: 1, max: 10). Backwards compatible with `CONFIRMATION_LEDGER_THRESHOLD`. |
| `DRY_RUN` | boolean | `false` | no | Skip submitting real Stellar transactions. Useful for staging. **Startup fails in production if `true`** |
| `HORIZON_API_TIMEOUT_MS` | integer | `15000` | no | Timeout (ms) for Horizon API calls. The network-fee estimator uses 5000 ms when unset |
| `HORIZON_CB_COOLDOWN_MS` | integer | `30000` | no | Time (ms) the circuit breaker stays open before attempting a probe request |
| `HORIZON_CB_FAILURE_THRESHOLD` | integer | `5` | no | Number of consecutive Horizon failures before the circuit breaker opens |
| `HORIZON_CB_WINDOW_MS` | integer | `60000` | no | Rolling window (ms) in which failures are counted by the circuit breaker |
| `HORIZON_FAILOVER_THRESHOLD` | integer | `3` | no | Consecutive failures before switching to a fallback Horizon URL Range: 1–10. |
| `HORIZON_FALLBACK_URLS` | list (comma-separated) | — | no | Comma-separated fallback Horizon URLs used when the primary is unhealthy |
| `HORIZON_MAX_RETRY_ATTEMPTS` | integer | `3` | no | Maximum number of automatic retries for failed Horizon requests |
| `HORIZON_POOL_COOLDOWN_MS` | integer | `30000` | no | Minimum cooldown (ms) between using the same pool connection |
| `HORIZON_POOL_SIZE` | integer | `3` | no | Number of parallel Horizon HTTP connections maintained per pool |
| `HORIZON_RECOVERY_COOLDOWN_MS` | integer | `60000` | no | Time (ms) before retrying the primary Horizon URL after failover Range: 10000–600000. |
| `HORIZON_RETRY_BASE_DELAY_MS` | integer | `200` | no | Base delay (ms) for Horizon retry exponential back-off |
| `HORIZON_RETRY_MAX_DELAY_MS` | integer | `2000` | no | Maximum delay (ms) cap for Horizon retry back-off |
| `HORIZON_STREAM_TIMEOUT_MS` | integer | `60000` | no | Timeout (ms) for Horizon SSE stream connections |
| `HORIZON_SUBMIT_TIMEOUT_MS` | integer | `30000` | no | Timeout (ms) for transaction submission to Horizon |
| `HORIZON_URL` | url | — | no | Override the Horizon endpoint URL. Defaults to the canonical URL for `STELLAR_NETWORK` |
| `MIN_RESERVE_XLM` | number | `1` | no | Minimum XLM balance (in XLM) required in a wallet for operations |
| `MOCK_STELLAR` | boolean | `false` | no | When `true`, no outbound Stellar/Horizon calls are made. Required for local dev and CI |
| `MOCK_STELLAR_LATENCY_MS` | integer | `0` | no | Artificial delay (ms) injected by the mock Stellar service to simulate network latency |
| `RECIPIENT_SECRETS` | string | — | no | JSON-encoded map of recipient IDs to Stellar secret keys for multi-recipient flows Secret. |
| `SERVICE_ACCOUNT_PUBLIC_KEY` | string | — | no | Public key of the service account monitored for low balance |
| `SERVICE_SECRET_KEY` | string | — | no | Stellar secret key (`S…`) for service-initiated signing operations. Never commit. Secret. |
| `SERVICE_SIGNING_KEY` | string | — | no | Alias for `SERVICE_SECRET_KEY` used in some signing paths Secret. |
| `SIMULATION_ENABLED` | boolean | `true` | no | Mock Stellar only: set `false` to disable transaction simulation |
| `SOROBAN_RPC_URL` | url | — | no | Soroban RPC endpoint for smart-contract calls |
| `SPONSOR_SECRET` | string | — | no | Stellar secret key of the fee-bump sponsor account Secret. |
| `STELLAR_BASE_RESERVE` | number | — | no | Override the base reserve (XLM) of the active Stellar environment preset (preset: 0.5) |
| `STELLAR_ENVIRONMENT` | string | `testnet` | no | Alias for `STELLAR_NETWORK` accepted by some service modules |
| `STELLAR_EXPLORER_URL` | string | — | no | Base URL of the Stellar block explorer used to build transaction links |
| `STELLAR_FEE_MULTIPLIER` | integer | — | no | Override the fee multiplier of the active Stellar environment preset (preset: 100) |
| `STELLAR_NETWORK` | string | `testnet` | no | Target Stellar network. Allowed: `testnet`, `mainnet`, `futurenet` **Deprecated** — Use STELLAR_ENVIRONMENT. |
| `STELLAR_NETWORK_PASSPHRASE` | string | — | no | Override the network passphrase. Inferred from `STELLAR_NETWORK` when omitted |
| `STELLAR_SECRET` | string | — | no | Legacy alias for the Stellar signing secret in older code paths Secret. |
| `SYNC_MAX_PAGES` | integer | `100` | no | Maximum number of Horizon history pages fetched during a transaction sync pass Maximum: 1000. |
| `TX_SYNC_INTERVAL_MS` | integer | `900000` | no | Interval (ms) between automatic transaction reconciliation runs Minimum: 60000. |
| `TX_SYNC_LEASE_MULTIPLIER` | integer | `2` | no | Sync lease length as a multiple of `TX_SYNC_INTERVAL_MS` Range: 1–10. |
| `USE_MOCK_STELLAR` | boolean | `false` | no | Alias for `MOCK_STELLAR` in some service modules |

---

## 5. Database

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `AUDIT_LOG_RETENTION_DAYS` | integer | `90` | no | Number of days to retain audit log entries before they are purged |
| `DB_ACQUIRE_TIMEOUT` | integer | `10000` | no | Milliseconds to wait for an available pool connection before failing |
| `DB_PATH` | string | `./donations.db` | no | File path to the SQLite database (relative to project root) |
| `DB_POOL_MAX` | integer | `10` | no | Maximum number of concurrent SQLite connections |
| `DB_POOL_MIN` | integer | `1` | no | Minimum number of idle connections kept in the SQLite pool |
| `DB_POOL_SIZE` | integer | `5` | no | Alias for `DB_POOL_MAX`. Maximum number of concurrent SQLite connections |
| `DB_QUERY_TIMEOUT_MS` | integer | `5000` | no | Timeout (ms) applied to individual SQL queries |
| `DB_TYPE` | string | `sqlite` | no | Database driver. Currently only `sqlite` is supported |
| `MIGRATION_LOCK_POLL_INTERVAL_MS` | integer | `500` | no | Polling interval (ms) when waiting for the migration lock |
| `MIGRATION_LOCK_TIMEOUT_MS` | integer | `30000` | no | Milliseconds to wait for the advisory migration lock before failing |
| `RETENTION_AUDIT_LOGS_DAYS` | integer | `365` | no | Days before audit-log rows are deleted by the retention job Minimum: 0. |
| `RETENTION_DONATIONS_DAYS` | integer | `2555` | no | Days before donation rows are eligible for retention purge Minimum: 0. |
| `RETENTION_DRY_RUN` | boolean | `false` | no | When `true`, the retention job logs what it would delete without removing records |
| `RETENTION_IDEMPOTENCY_DAYS` | integer | `30` | no | Days before idempotency keys are purged Minimum: 0. |
| `RETENTION_SCHEDULE_CRON` | string | `02:00` | no | Cron expression controlling when the data-retention cleanup job runs |
| `SLOW_QUERY_BUFFER_SIZE` | integer | `100` | no | Number of slow-query records retained in memory for the diagnostics endpoint |
| `SLOW_QUERY_THRESHOLD_MS` | integer | `100` | no | Queries exceeding this threshold (ms) are logged as slow |

---

## 6. CORS

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `CORS_ALLOW_ALL` | boolean | `false` | no | Allow every origin. **Startup fails in production if `true`** |
| `CORS_ALLOWED_HEADERS` | list (comma-separated) | `Content-Type,Authorization,X-API-Key,X-Request-ID,X-Idempotency-Key` | no | Comma-separated request headers allowed through CORS |
| `CORS_ALLOWED_METHODS` | list (comma-separated) | `GET,POST,PUT,PATCH,DELETE,OPTIONS` | no | Comma-separated HTTP methods allowed in CORS pre-flight responses |
| `CORS_ALLOWED_ORIGINS` | list (comma-separated) | — | no | Comma-separated list of allowed browser origins. In production, set this explicitly — omitting it rejects all browser origins |
| `CORS_MAX_AGE` | integer | `86400` | no | `Access-Control-Max-Age` value in seconds (how long browsers may cache pre-flight results) |

---

## 7. Logging

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ACCESS_LOG_INCLUDE_HEALTH` | boolean | `false` | no | When `true`, health-check requests appear in the access log |
| `AUDIT_LOG_FLUSH_INTERVAL_MS` | integer | `1000` | no | Interval (ms) at which buffered audit-log entries are flushed to the database Minimum: 1. |
| `DEBUG_MODE` | boolean | `false` | no | Enable verbose debug logging. **Startup fails in production if `true`** |
| `LOG_BODY` | boolean | `false` | no | Log raw request and response bodies |
| `LOG_BODY_PATHS` | list (comma-separated) | — | no | Comma-separated path prefixes for which request bodies are logged (overrides `LOG_BODY`) |
| `LOG_DIR` | string | `./logs` | no | Directory for log files when `LOG_TO_FILE=true` |
| `LOG_FORMAT` | enum (json \| text) | `text` | no | Log output format: `json` or `pretty` |
| `LOG_HEADERS` | boolean | `false` | no | Include request headers in access log entries |
| `LOG_LEVEL` | string | `info` | no | Minimum log level: `debug`, `info`, `warn` or `error` |
| `LOG_MAX_BACKUPS` | integer | `10` | no | Number of rotated log files to retain Minimum: 1. |
| `LOG_MAX_SIZE` | integer | `52428800` | no | Maximum log file size in bytes before rotation |
| `LOG_SAMPLE_RATE` | number | `1` | no | Fraction of requests to log (0–1). `1` logs every request Range: 0–1. |
| `LOG_SKIP_PATHS` | list (comma-separated) | — | no | Comma-separated paths excluded from access log output |
| `LOG_TO_FILE` | boolean | `false` | no | Write logs to rotating files in addition to stdout |
| `LOG_VERBOSE` | boolean | `false` | no | Include request/response bodies in console log output |

---

## 8. Rate Limiting

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `AUTH_REFRESH_RATE_LIMIT` | integer | `20` | no | Maximum requests per minute per IP on `POST /auth/refresh` |
| `AUTH_TOKEN_RATE_LIMIT` | integer | `10` | no | Maximum requests per minute per IP on `POST /auth/token` |
| `DISABLE_RATE_LIMIT` | boolean | `false` | no | Disables rate limiting. **Unsafe — startup fails in production if `true`** |
| `RATE_LIMIT` | integer | `100` | no | Maximum requests per IP per rate-limit window (global limiter) |
| `RATE_LIMIT_CLEANUP_INTERVAL_MS` | integer | `60000` | no | Interval (ms) between in-memory store cleanup passes that evict expired windows |
| `RATE_LIMIT_FAIL_OPEN` | boolean | `true` | no | When `RATE_LIMIT_STORE=redis`, controls behaviour on Redis unavailability. `true` = allow requests; `false` = deny requests |
| `RATE_LIMIT_MAX_REQUESTS` | integer | `100` | no | Alias for `RATE_LIMIT` used in some middleware |
| `RATE_LIMIT_STORE` | enum (memory \| redis) | `memory` | no | Backing store for rate-limit counters: `memory` or `redis`. Use `redis` in multi-instance deployments |
| `RATE_LIMIT_WINDOW_MS` | integer | `60000` | no | Rolling window duration (ms) for the global rate limiter |
| `REDIS_URL` | url | — | no | Redis connection URL (e.g. `redis://localhost:6379`). Required when `RATE_LIMIT_STORE=redis` Secret. |

---

## 9. Donation Limits & Business Logic

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `BULK_DONATION_CONCURRENCY` | integer | `5` | no | Number of donations processed in parallel during a batch submission |
| `BULK_IMPORT_BATCH_SIZE` | integer | `50` | no | Default database chunk size for bulk wallet imports Minimum: 1. |
| `BULK_IMPORT_MAX_ROWS` | integer | `1000` | no | Maximum number of rows accepted per bulk wallet-import request |
| `BULK_IMPORT_MAX_SIZE_BYTES` | integer | `1048576` | no | Maximum size (bytes) of a bulk import payload |
| `DISPUTE_WINDOW_DAYS` | integer | `30` | no | Number of days after which a donation can no longer be disputed |
| `DONATION_APPROVAL_EXPIRY_INTERVAL_MS` | integer | `300000` | no | Interval (ms) of the worker that expires stale multi-signer donation approvals Minimum: 1. |
| `EXPORT_BATCH_SIZE` | integer | `500` | no | Rows fetched per batch when generating donation exports Minimum: 1. |
| `MAX_DAILY_DONATION_PER_DONOR` | number | `0` | no | Daily XLM cap per donor. `0` disables the cap |
| `MAX_DONATION_AMOUNT` | number | `10000` | no | Maximum accepted donation amount in XLM |
| `MAXIMUM_FEE_XLM` | number | `10` | no | Maximum platform fee cap in XLM regardless of `PLATFORM_FEE_PERCENT` |
| `MIN_DONATION_AMOUNT` | number | `0.01` | no | Minimum accepted donation amount in XLM |
| `MINIMUM_FEE_XLM` | number | `0.01` | no | Minimum platform fee in XLM regardless of `PLATFORM_FEE_PERCENT` |
| `MULTISIG_APPROVAL_WINDOW_MS` | integer | `259200000` | no | How long (ms) a pending multi-signer approval stays open Minimum: 60000. |
| `MULTISIG_REQUIRED_APPROVALS` | integer | `2` | no | Approvals required for donations above `MULTISIG_THRESHOLD_XLM` Range: 2–20. |
| `MULTISIG_THRESHOLD_XLM` | number | — | no | Donations above this amount (XLM) require multi-signer approval. Unset disables the workflow. Must be below `MAX_DONATION_AMOUNT` Minimum: 0. |
| `OVERPAYMENT_TOLERANCE_XLM` | number | `0.01` | no | Overpayment (XLM) tolerated before a donation is flagged as overpaid Minimum: 0. |
| `PLATFORM_FEE_PERCENT` | number | `1.5` | no | Platform fee percentage deducted from each donation (0–100) |
| `PLEDGE_EXPIRY_INTERVAL_MS` | integer | `60000` | no | Interval (ms) between pledge expiry check runs |
| `RECENT_DONATIONS_CACHE_TTL_SECONDS` | integer | `5` | no | TTL (seconds) for the recent-donations response cache |
| `RECENT_DONATIONS_MAX_LIMIT` | integer | `100` | no | Maximum number of records returned by the recent-donations endpoint |
| `REFUND_ELIGIBILITY_WINDOW_DAYS` | integer | `30` | no | Days within which a donation is eligible for refund consideration |
| `REFUND_WINDOW_HOURS` | integer | `24` | no | Hours after a donation during which a refund can be initiated |
| `SCHEDULER_LOCK_TTL_MS` | integer | `90000` | no | Lease TTL (ms) for the recurring-donation scheduler lock (one scheduler per cluster) Minimum: 1. |
| `VELOCITY_LIMIT_FREE` | integer | `5` | no | Donations per `VELOCITY_WINDOW_SECONDS` allowed for free-tier keys Minimum: 1. |
| `VELOCITY_LIMIT_PREMIUM` | integer | `100` | no | Donations per window allowed for premium-tier keys Minimum: 1. |
| `VELOCITY_LIMIT_STANDARD` | integer | `20` | no | Donations per window allowed for standard-tier keys Minimum: 1. |
| `VELOCITY_WINDOW_SECONDS` | integer | `3600` | no | Window (seconds) for donation velocity limits Minimum: 1. |

---

## 10. Caching

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `API_KEY_CACHE_TTL_SECONDS` | integer | `60` | no | TTL (seconds) for the in-memory API key lookup cache |
| `CACHE_CLEANUP_INTERVAL_MS` | integer | `60000` | no | Interval (ms) between cache eviction passes |
| `CACHE_MAX_SIZE` | integer | `10000` | no | Maximum number of entries in the shared in-memory LRU cache |
| `FEDERATION_CACHE_CLEANUP_INTERVAL_MS` | integer | `300000` | no | Interval (ms) between federation cache cleanup passes |
| `FEDERATION_CACHE_MAX_SIZE` | integer | `5000` | no | Maximum number of cached federation records |
| `FEDERATION_CACHE_TTL` | integer | `300` | no | TTL (seconds) for Stellar federation record lookups |
| `LEADERBOARD_CACHE_TTL_SECONDS` | integer | `60` | no | TTL (seconds) of the leaderboard stats cache Minimum: 1. |
| `STATS_CACHE_TTL_SECONDS` | integer | `60` | no | TTL (seconds) for the donation stats cache |
| `STATS_SUMMARY_CACHE_TTL_SECONDS` | integer | `60` | no | TTL (seconds) for the donation stats-summary cache |
| `WALLET_BALANCE_CACHE_TTL_SECONDS` | integer | `30` | no | TTL (seconds) for cached wallet-balance responses |

---

## 11. SMTP / Email Receipts

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ADMIN_ALERT_EMAIL` | string | — | no | Recipient address for service-account low-balance alert emails |
| `NOTIFICATION_EMAIL` | string | — | no | Recipient for export-ready notification emails when the job has no email. Falls back to `SMTP_TO` |
| `SMTP_FROM` | string | — | no | Sender address for outbound emails. Must be verified with your SMTP provider |
| `SMTP_HOST` | string | — | no | SMTP relay hostname (e.g. `smtp-relay.brevo.com`) |
| `SMTP_PASS` | string | — | no | SMTP authentication password (alias: `SMTP_PASSWORD`) Secret. |
| `SMTP_PASSWORD` | string | — | no | Alias for `SMTP_PASS` Secret. |
| `SMTP_PORT` | integer | `587` | no | SMTP port |
| `SMTP_SECURE` | boolean | `false` | no | Use TLS (`true`) or STARTTLS (`false`) for SMTP connections |
| `SMTP_TO` | string | — | no | Fallback recipient for export notifications |
| `SMTP_USER` | string | — | no | SMTP authentication username |

> **Startup validation:** When `SMTP_HOST` is set, the startup checks verify that `SMTP_FROM` is also configured and, if `SMTP_USER` is provided, that `SMTP_PASSWORD` (or `SMTP_PASS`) is present. The check also attempts to verify the SMTP connection; a failed verification logs a warning but does not block startup.

---

## 11a. Webhook Email Notifications

These variables control the email notifications sent when a webhook is auto-disabled after repeated delivery failures (`WebhookEmailNotificationService`). They only take effect when `SMTP_HOST` is configured.

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `WEBHOOK_NOTIFICATION_DEDUP_WINDOW_MS` | integer | `3600000` | no | Duration (ms) of the deduplication window — a second notification for the same webhook is suppressed within this window |
| `WEBHOOK_NOTIFICATION_MAX_RETRIES` | integer | `3` | no | Maximum retry attempts for failed notification emails |
| `WEBHOOK_NOTIFICATION_RETRY_DELAYS_MS` | string | `60000,300000,1800000` | no | Comma-separated retry delays (ms) for each successive retry attempt |

---

## 12. IPFS / Pinata

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `IPFS_GATEWAY_URL` | string | `https://gateway.pinata.cloud/ipfs` | no | Public IPFS gateway base URL used to construct certificate links |
| `PINATA_API_KEY` | string | — | no | Pinata API key for pinning donation impact certificates to IPFS Secret. |
| `PINATA_SECRET_KEY` | string | — | no | Pinata API secret corresponding to `PINATA_API_KEY` Secret. |

---

## 13. Geographic Blocking

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `GEO_ALLOWED_COUNTRIES` | list (comma-separated) | — | no | Country codes that are always allowed, overriding `GEO_BLOCKED_COUNTRIES` |
| `GEO_ALLOWED_IPS` | list (comma-separated) | — | no | Comma-separated IPs or CIDR ranges that bypass geo-blocking |
| `GEO_BLOCKED_COUNTRIES` | list (comma-separated) | — | no | Comma-separated ISO 3166-1 alpha-2 country codes whose requests are blocked (e.g. `RU,IR,KP`) |
| `GEO_STRICT_MODE` | boolean | `true` | no | When the GeoIP database is unavailable or a lookup fails, block () or allow () the request |
| `MAXMIND_DB_PATH` | string | `./data/GeoLite2-Country.mmdb` | no | Path to the MaxMind GeoLite2-Country binary database file |

---

## 14. Abuse Detection

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ABUSE_ANOMALY_THRESHOLD` | number | `0.8` | no | Anomaly score (0–1) above which a request pattern is flagged as anomalous Range: 0–1. |
| `ABUSE_BLOCK_DURATION_MS` | integer | `86400000` | no | Duration (ms) a flagged IP remains in the suspicious list |
| `ABUSE_DB_PATH` | string | — | no | Optional path to a persistent SQLite file for abuse-detection tracking. If unset, tracking is in-memory only |
| `ABUSE_PATTERN_THRESHOLD` | integer | `5` | no | Number of repeated suspicious patterns that triggers the pattern-detection signal Minimum: 1. |
| `ABUSE_SUSPICIOUS_THRESHOLD` | integer | `10` | no | Number of requests within `ABUSE_WINDOW_MS` that triggers the burst-detection signal |
| `ABUSE_VELOCITY_THRESHOLD` | integer | `30` | no | Requests within `ABUSE_VELOCITY_WINDOW_MS` that trigger the velocity signal Minimum: 1. |
| `ABUSE_VELOCITY_WINDOW_MS` | integer | `60000` | no | Rolling window (ms) for the velocity signal Minimum: 1. |
| `ABUSE_WINDOW_MS` | integer | `3600000` | no | Rolling window (ms) in which request counts are tracked for burst detection |

---

## 15. Replay & Deduplication

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `BODY_DEDUP_WINDOW_SECONDS` | integer | `60` | no | Window (seconds) in which identical mutating requests without an Idempotency-Key are deduplicated by body hash Minimum: 1. |
| `MEMO_COLLISION_WINDOW_MS` | integer | `300000` | no | Window (ms) in which duplicate memo values are considered collisions |
| `MEMO_KEYS_DIR` | string | `./data/memo-keys` | no | Directory where memo encryption keys are persisted. Must be outside the repository when `NODE_ENV=production` (startup fails otherwise) |
| `NONCE_CLEANUP_INTERVAL_MS` | integer | `300000` | no | Interval (ms) between nonce-store cleanup passes |
| `NONCE_MAX_SIZE` | integer | `100000` | no | Maximum number of nonce entries held in memory |
| `REPLAY_CLEANUP_INTERVAL_SECONDS` | integer | `60` | no | Interval (seconds) between replay-store cleanup passes |
| `REPLAY_DETECTION_TIMEOUT_MS` | integer | `200` | no | Timeout (ms) for the replay-detection store lookup |
| `REPLAY_THRESHOLD` | integer | `3` | no | Number of duplicate signatures allowed before rejection |
| `REPLAY_WINDOW_SECONDS` | integer | `60` | no | Window (seconds) within which a duplicate request signature is rejected |

---

## 16. Backup

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `AWS_REGION` | string | `us-east-1` | no | AWS region used for S3 backup uploads (and KMS if applicable) |
| `BACKUP_DIR` | string | `./data/backups` | no | Local directory where encrypted database backup files are written |
| `BACKUP_INTERVAL_MS` | integer | `86400000` | no | Interval (ms) between automatic backup runs |
| `BACKUP_S3_BUCKET` | string | — | no | S3 bucket name for off-site backup upload. When unset, backups are local only |
| `BACKUP_S3_PREFIX` | string | `backups/` | no | Key prefix used when uploading backup files to S3 |

---

## 17. SSE / WebSocket Streaming

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ENABLE_SERVER_PUSH` | boolean | `false` | no | Enable server-sent event (SSE) and WebSocket push endpoints |
| `LEADERBOARD_KEEPALIVE_MS` | integer | `15000` | no | Interval (ms) between keepalive comments on the leaderboard SSE stream |
| `PUBSUB_ADAPTER` | enum (memory \| redis) | `memory` | no | Pub/sub adapter: `memory` (in-process) or `redis` |
| `SSE_EVENT_BUFFER_SIZE` | integer | `100` | no | Number of events buffered per SSE connection for reconnecting clients |
| `SSE_MAX_CONNECTIONS_PER_KEY` | integer | `5` | no | Maximum concurrent SSE streams per API key. Enforced cluster-wide when `SHARED_STATE_BACKEND=redis` Minimum: 1. |
| `WS_HEARTBEAT_MS` | integer | `30000` | no | Interval (ms) between WebSocket ping frames |
| `WS_MAX_WALLETS` | integer | `50` | no | Maximum number of wallet subscriptions per WebSocket connection |

---

## 18. Observability & Tracing

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ANOMALY_WEBHOOK_URL` | string | — | no | URL to POST anomaly-detection alerts to. When unset, alerts are logged only |
| `ORPHAN_ALERT_THRESHOLD` | integer | `1` | no | Number of orphaned transactions before an alert is triggered |
| `OTEL_ENABLED` | boolean | `true` | no | Enable OpenTelemetry tracing. Set `false` to disable |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | url | — | no | OTLP exporter endpoint URL (e.g. `http://collector:4318`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | string | — | no | Comma-separated `key=value` pairs added as headers to OTLP export requests |
| `OTEL_SERVICE_NAME` | string | `stellar-donation-api` | no | Service name reported to the OTLP collector |

---

## 19. Organisation Metadata

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ORGANIZATION_ADDRESS` | string | — | no | Street address printed on tax receipts |
| `ORGANIZATION_CITY` | string | — | no | City component of the organisation's mailing address |
| `ORGANIZATION_EIN` | string | — | no | Employer Identification Number (EIN) printed on tax receipts |
| `ORGANIZATION_EMAIL` | string | — | no | Contact email address printed on receipts |
| `ORGANIZATION_LEGAL_NAME` | string | — | no | Legal name of the organisation for receipt headers |
| `ORGANIZATION_PHONE` | string | — | no | Contact phone number printed on receipts |
| `ORGANIZATION_STATE` | string | — | no | State/province component of the organisation's mailing address |
| `ORGANIZATION_WEBSITE` | string | — | no | Website URL printed on receipts |
| `ORGANIZATION_ZIP_CODE` | string | — | no | Postal code component of the organisation's mailing address |

---

## 20. Signing Providers (HSM / KMS)

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `AWS_KMS_KEY_ID` | string | — | no | Alias of `KMS_KEY_ID` read by the `generate-key` script |
| `HSM_PIN` | string | — | no | PKCS#11 slot PIN when `SIGNING_PROVIDER=hsm` Secret. |
| `HSM_SLOT_ID` | string | — | no | PKCS#11 slot ID when `SIGNING_PROVIDER=hsm` |
| `KMS_KEY_ID` | string | — | no | KMS key ARN (AWS) or resource name (GCP) for remote signing |
| `KMS_PROVIDER` | string | `local` | no | Cloud KMS provider: `aws` or `gcp` |

---

## 21. Miscellaneous / Feature Config

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `API_BASE_URL` | string | — | no | Publicly accessible base URL of this API, used in signed download links. Defaults to `http://localhost:$PORT` |
| `COINGECKO_API_KEY` | string | — | no | CoinGecko API key (`CG-…` format) for XLM/fiat exchange rate lookups. Without this, the unauthenticated endpoint is used (stricter rate limits) Secret. |
| `COMPRESSION_LEVEL` | integer | `4` | no | zlib compression level (1–9) for gzip response encoding Range: 1–9. |
| `COMPRESSION_THRESHOLD_BYTES` | integer | `1024` | no | Minimum response size (bytes) before compression is applied |
| `CSP_REPORT_ONLY` | boolean | `false` | no | When `true`, CSP violations are reported but not enforced |
| `CSP_REPORT_URI` | string | `/csp-report` | no | URI to which CSP violation reports are sent |
| `ENABLE_CHANGELOG_ENDPOINT` | boolean | `false` | no | Mount the public `/changelog` endpoint |
| `FEATURE_FLAGS` | string | — | no | JSON object of feature-flag overrides, e.g. `{"newDonationFlow":true}`. See [docs/FEATURE_FLAGS_RUNTIME.md](./FEATURE_FLAGS_RUNTIME.md) |
| `FEDERATION_DOMAIN` | string | — | no | Domain used for Stellar federation lookups |
| `FEDERATION_RECORDS` | string | — | no | JSON-encoded static federation records for local development, bypassing live federation lookups |
| `WEBHOOK_ALLOW_TLS_SKIP_VERIFY` | string | — | no | Set to `break-glass` to allow webhooks with TLS verification disabled in production. Any other value is ignored |
| `WEBHOOK_RETRY_INTERVAL_MS` | integer | `30000` | no | Interval (ms) of the outgoing-webhook retry worker Minimum: 1. |
| `XLM_USDC_ASSET` | string | — | no | `CODE:ISSUER` of the stablecoin used for the Stellar DEX price fallback. The XLM/USD rate is the mid-market price of this orderbook when CoinGecko is unavailable |

---

## 22. Shared State (Multi-Instance)

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `INBOUND_WEBHOOK_SOURCES` | json | — | no | JSON array of inbound webhook sources registered at boot on every instance, e.g. `[{"name":"stripe","secretEnv":"STRIPE_WEBHOOK_SECRET","headerName":"stripe-signature"}]` |
| `SHARED_STATE_BACKEND` | enum (memory \| redis) | `memory` | no | Backend for correctness-critical state (body-hash dedup, request-signing nonces, SSE per-key limits). Use `redis` when running more than one replica |
| `SHARED_STATE_FAIL_OPEN` | boolean | `true` | no | When the shared backend is unreachable, fall back to per-process state (`true`) or reject the request (`false`) |
| `SHARED_STATE_KEY_PREFIX` | string | `smd:` | no | Prefix for every key written to the shared-state backend |
| `SHARED_STATE_REDIS_URL` | url | — | no | Redis URL for the shared-state backend. Falls back to `REDIS_URL` Secret. |

---

## 23. GraphQL

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `GRAPHQL_LIST_FIELD_COST` | integer | `10` | no | Complexity cost assigned to each list field Minimum: 1. |
| `GRAPHQL_MAX_COMPLEXITY` | integer | `1000` | no | Maximum computed query complexity before a GraphQL query is rejected Minimum: 1. |
| `GRAPHQL_MAX_DEPTH` | integer | `6` | no | Maximum GraphQL query nesting depth Minimum: 1. |

---

<!-- END GENERATED: env reference -->

---

## 24. Unsafe Development Flags

The following variables are provided for local development only. The startup checks
(`src/utils/startupChecks.js`) will **abort the process** if any is `true` when
`NODE_ENV=production`.

| Variable | Purpose | Production behaviour |
|---|---|---|
| `DISABLE_RATE_LIMIT` | Bypass all rate-limiting middleware | **Startup fails** |
| `CORS_ALLOW_ALL` | Allow every origin in CORS responses | **Startup fails** |
| `DEBUG_MODE` | Enable verbose debug logging | **Startup fails** |
| `DRY_RUN` | Skip real Stellar transactions | **Startup fails** |

In non-production environments the server starts but logs a prominent `⚠ WARN` for each
active flag.

### Example — safe `.env` for production

```env
NODE_ENV=production
DISABLE_RATE_LIMIT=false
CORS_ALLOW_ALL=false
DEBUG_MODE=false
DRY_RUN=false
CORS_ALLOWED_ORIGINS=https://app.example.com
```

---

## 25. Secret Strength Requirements

All signing and encryption secrets are validated at startup. The server **will refuse to
start** if any secret fails the following rules:

1. **Minimum length** — at least 32 bytes (64 hex chars for hex secrets).
2. **No known placeholders** — values containing `changeme`, `secret`, `password`,
   `placeholder`, `example`, `todo`, `fixme`, or the patterns from `.env.example` are
   rejected.
3. **Unique across roles** — `ENCRYPTION_KEY`, `EXPORT_SIGNING_SECRET`,
   `ANONYMOUS_DONATION_SECRET`, and `JWT_SECRET` must all be distinct values.

| Variable | Role |
|---|---|
| `ENCRYPTION_KEY` | AES-256 data encryption (64 hex chars) |
| `EXPORT_SIGNING_SECRET` | HMAC signature for CSV/JSON exports |
| `ANONYMOUS_DONATION_SECRET` | Token derivation for anonymous donations |
| `JWT_SECRET` | JWT signing |

Generate strong secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or
npm run generate-key
```

---

## 26. Startup Configuration Validation (#1234)

`npm start` runs `npm run validate-env` (and the boot sequence in `src/app.js` runs the
same checks again with `exitOnFailure`) before the HTTP port is bound. Invalid or missing
**required** configuration aborts startup with a non-zero exit code and a message naming
the offending variable; misconfigured **optional** configuration logs a `⚠ WARN` and starts
with defaults.

### Hard failures (startup aborts)

| Variable / condition | Expectation |
|---|---|
| `ENCRYPTION_KEY` | exactly 64 hexadecimal characters, not a placeholder in production |
| `API_KEYS` | at least one non-empty key |
| `HORIZON_URL` (when set) | a valid `http(s)` URL; **HTTPS required in production** |
| `DB_PATH` (effective) | parent directory exists and is writable; file readable/writable when present |
| `SERVICE_SECRET_KEY` / `SERVICE_SIGNING_KEY` / `STELLAR_SECRET` / `SPONSOR_SECRET` (when set) | valid Stellar secret key format (`S` + 55 base32 chars) |
| `DB_POOL_SIZE`, `DB_POOL_MIN`, `DB_POOL_MAX`, `DB_ACQUIRE_TIMEOUT`, `DB_QUERY_TIMEOUT_MS`, `SLOW_QUERY_THRESHOLD_MS`, `SLOW_QUERY_BUFFER_SIZE` | positive (or non-negative where noted) integers — the SQLite pool hard-throws on invalid values |
| `PORT` | integer between 1 and 65535 |
| `SIGNING_PROVIDER` | one of `local`, `hsm`, `kms`; `hsm` requires `HSM_SLOT_ID` + `HSM_PIN`; `kms` requires `KMS_PROVIDER` + `KMS_KEY_ID` |
| `REQUIRE_REQUEST_SIGNING=true` | `REQUEST_SIGNING_SECRET` must be set |
| `RATE_LIMIT_STORE=redis` | `REDIS_URL` must be set |
| `ENCRYPTION_KEY_VERSION=1` | `ENCRYPTION_KEY_1` must be set |
| Unsafe flags in production (`DISABLE_RATE_LIMIT`, `CORS_ALLOW_ALL`, `DEBUG_MODE`, `DRY_RUN`) | must be `false` |

### Warnings (startup continues)

- `HORIZON_URL` override that does not match the canonical URL for the configured network
- Database directory/file permission hygiene (recommended `0700` / `0600`)
- Missing Stellar signing keys in production on a live network
- Horizon tuning knobs out of range (`HORIZON_POOL_SIZE`, timeouts, retry/circuit-breaker settings)
- Incoherent pool ranges (`DB_POOL_MIN > DB_POOL_MAX`)
- `MOCK_STELLAR=true` in production
- `STELLAR_ENVIRONMENT` and `STELLAR_NETWORK` set to different values
- Secrets absent in production (`EXPORT_SIGNING_SECRET`, `ANONYMOUS_DONATION_SECRET`, `JWT_SECRET`)

---

## 27. SSRF Protection

All outbound HTTP requests (webhooks, IPFS pinning, federation lookups) are validated by
`src/utils/ssrf.js` before the connection is made. The validator:

- Enforces **HTTPS only** (rejects `http:`, `file:`, etc.).
- Blocks requests to private/loopback/link-local/cloud-metadata IP ranges:
  - `127.0.0.0/8` (loopback)
  - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (private)
  - `169.254.0.0/16` (link-local / AWS Instance Metadata Service)
  - `fc00::/7`, `fe80::/10` (IPv6 ULA / link-local)
- Performs **DNS resolution** and validates every returned IP to prevent DNS-rebinding
  attacks.

Affected callers: `WebhookService`, `src/utils/ipfs.js`, `src/utils/federation.js`.

---

## Horizon Connection Pool Sizing

`StellarService` round-robins Horizon calls across a small pool of `Horizon.Server`
instances (`src/services/HorizonPool.js`) so that a single misbehaving connection
doesn't serialize every Stellar call behind it. Pool behaviour is controlled by:

| Variable | Default | Purpose |
|---|---|---|
| `HORIZON_POOL_SIZE` | `3` (capped at `10`) | Number of `Horizon.Server` instances per process |
| `HORIZON_POOL_COOLDOWN_MS` | `30000` | How long a member that hit a transient network error stays out of rotation before a health-check re-admits it |

### Why pool size matters

- **Too small** — every retry/backoff on a failing member serializes calls onto
  the remaining members, increasing p95/p99 latency under load and bringing
  the failing member back into rotation (via cooldown) before traffic has
  recovered.
- **Too large** — `HORIZON_POOL_SIZE` is *per process*. The number that matters
  for rate-limit purposes is `HORIZON_POOL_SIZE × number_of_instances`. The
  public Horizon fleet (`horizon.stellar.org` / `horizon-testnet.stellar.org`)
  rate-limits per source IP; a self-hosted Horizon enforces whatever limit
  operators configure. Sizing the pool without accounting for instance count
  is the single most common way to get an entire fleet throttled at once.

### Sizing guidance

1. Start from your Horizon rate limit (requests/second) for the IP(s) your
   fleet egresses from.
2. Decide your target fleet-wide concurrent-request budget, leaving headroom
   (e.g. 70-80% of the hard limit) for retries and bursts.
3. `HORIZON_POOL_SIZE ≈ target_budget / number_of_instances`. Round down —
   it is always safer to under-provision a pool (callers wait briefly via
   round-robin reuse) than to over-provision and trip the shared rate limit.
4. Re-check the math whenever you change instance count (e.g. autoscaling)
   — the pool size is per-instance and does not adjust itself.
5. `HORIZON_POOL_COOLDOWN_MS` should be long enough that a transient Horizon
   blip doesn't flap a member in and out of rotation, but short enough that a
   recovered Horizon node isn't left idle for minutes. 30s (the default) is a
   reasonable starting point; raise it if `horizon_pool_cooldown_events_total`
   shows members flapping repeatedly.

### Observability

Pool health is exposed via Prometheus metrics (`src/utils/metrics.js`,
scraped at `/metrics`):

| Metric | Type | Meaning |
|---|---|---|
| `horizon_pool_size` | Gauge | Configured pool size |
| `horizon_pool_healthy_count` | Gauge | Members currently in rotation |
| `horizon_pool_unhealthy_count` | Gauge | Members currently cooling down |
| `horizon_pool_cooldown_events_total` | Counter | Times a member was marked unhealthy after a transient failure |
| `horizon_pool_recovery_events_total` | Counter | Times a member was re-admitted after cooldown |
| `horizon_pool_acquire_duration_seconds` | Histogram | Time spent in `getServer()` acquiring a pool member |

A sustained rise in `horizon_pool_unhealthy_count` or a high rate of
`horizon_pool_cooldown_events_total` indicates the pool is undersized or
Horizon itself is degraded — both are strong signals to revisit the sizing
math above before tripping the fleet-wide rate limit.

### Retry / circuit-breaker integration

Cooldown is already tied into the unified retry policy: `StellarService._executeWithRetry`
(`src/services/StellarService.js`) wraps every Horizon call in the shared
circuit breaker, and on a transient network error it calls
`HorizonPool.markUnhealthy()` for the specific member that failed *before*
retrying on the next pool member. This means a single bad connection is
isolated within the same retry attempt rather than waiting for a future
request to discover it.
