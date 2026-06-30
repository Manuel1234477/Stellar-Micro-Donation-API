# Configuration Guide

This document is the authoritative reference for every environment variable read by the
application. Variables are grouped by concern. For each variable the table shows:

- **Type** — `string | number | boolean | enum`
- **Default** — value used when the variable is absent (empty string means no default)
- **Required?** — `yes` = server refuses to start without it; `no` = optional
- **Effect** — what the variable controls

> **Tip:** Copy `.env.example` to `.env` and fill in the required variables before
> starting the server locally.

---

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
22. [Unsafe Development Flags](#22-unsafe-development-flags)
23. [Secret Strength Requirements](#23-secret-strength-requirements)
24. [SSRF Protection](#24-ssrf-protection)

---

## 1. Server

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `PORT` | number | `3000` | no | TCP port the HTTP server listens on |
| `NODE_ENV` | enum | `development` | no | Runtime environment (`development`, `test`, `production`). Controls logging verbosity, startup guard behaviour, and unsafe-flag checks |
| `API_PREFIX` | string | `/api/v1` | no | Base path prefix prepended to all API routes |
| `TRUSTED_PROXIES` | string | `loopback` | no | Comma-separated list of trusted proxy IPs/CIDRs. Passed to Express `trust proxy`. Set to the address of your load balancer in production |
| `INSTANCE_ID` | string | hostname | no | Unique identifier for this process instance. Appears in structured log output for distributed tracing |
| `SHUTDOWN_TIMEOUT` | number | `10000` | no | Alias for `SHUTDOWN_TIMEOUT_MS` (milliseconds). Time allowed for in-flight requests to drain before force-exit |
| `SHUTDOWN_TIMEOUT_MS` | number | `10000` | no | Milliseconds to wait for graceful shutdown before force-exit |
| `REQUEST_TIMEOUT_MS` | number | `30000` | no | Global per-request timeout in milliseconds. Streaming endpoints are exempt |

---

## 2. Authentication & API Keys

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `API_KEYS` | string | — | **yes** | Comma-separated list of raw API keys accepted by the legacy authentication path. At least one key is required |
| `JWT_SECRET` | string | — | no | Secret used to sign and verify JWT tokens. Must satisfy [secret strength rules](#23-secret-strength-requirements) if set |
| `HOME_DOMAIN` | string | — | no | Stellar home domain used in SEP-10 web-auth challenges |
| `REQUIRE_ADMIN_2FA` | boolean | `false` | no | When `true`, admin endpoints require a valid TOTP code alongside the API key |
| `TOTP_ISSUER` | string | `StellarDonationAPI` | no | Issuer label embedded in TOTP QR codes |
| `TOTP_WINDOW` | number | `1` | no | Number of 30-second TOTP windows (±) accepted to tolerate clock skew |
| `SEP10_CHALLENGE_TTL` | number | `300` | no | Seconds a SEP-10 challenge token remains valid |
| `AUTH_MAX_ATTEMPTS` | number | `5` | no | Maximum failed authentication attempts before an IP is locked out |
| `AUTH_WINDOW_MS` | number | `60000` | no | Rolling window (ms) in which `AUTH_MAX_ATTEMPTS` failures trigger lockout |
| `AUTH_LOCKOUT_MS` | number | `900000` | no | Duration (ms) of the authentication lockout (default 15 min) |
| `REQUIRE_REQUEST_SIGNING` | boolean | `false` | no | When `true`, every mutating request must carry a valid HMAC request signature |
| `REQUEST_SIGNING_SECRET` | string | — | no | HMAC secret used to verify inbound request signatures |
| `REQUEST_SIGNING_WINDOW_SECONDS` | number | `300` | no | Seconds of clock skew tolerated in signed requests |
| `REQUIRE_IDEMPOTENCY_KEY` | boolean | `false` | no | When `true`, POST/PATCH/PUT requests without `X-Idempotency-Key` are rejected |
| `SIGNED_URL_EXPIRY_MS` | number | `3600000` | no | Lifetime of signed download/export URLs in milliseconds (default 1 h) |

---

## 3. Encryption & Secrets

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ENCRYPTION_KEY` | string (64 hex) | — | **yes** | AES-256 key used to encrypt wallet secret keys and other sensitive data at rest. Generate with `npm run generate-key`. **Changing this key makes all previously encrypted data unrecoverable.** |
| `ENCRYPTION_KEY_1` | string (64 hex) | — | no | Previous encryption key used during key rotation. Required when `ENCRYPTION_KEY_VERSION=1` |
| `ENCRYPTION_KEY_VERSION` | number | `0` | no | Active key version index. Set to `1` during key rotation to indicate `ENCRYPTION_KEY_1` is the current key |
| `NEW_ENCRYPTION_KEY` | string (64 hex) | — | no | Target key during a live re-encryption pass (`npm run migrate:reencrypt`) |
| `ENCRYPTION_SECRET` | string | — | no | Legacy symmetric encryption secret for non-wallet data paths |
| `ENCRYPTION_PRIVATE_KEY` | string | — | no | RSA/EC private key PEM used by asymmetric signing paths |
| `ENCRYPTION_PUBLIC_KEY` | string | — | no | RSA/EC public key PEM used to verify asymmetric signatures |
| `EXPORT_SIGNING_SECRET` | string | — | no | HMAC secret for signing CSV/JSON export files. Must be distinct from `ENCRYPTION_KEY` |
| `ANONYMOUS_DONATION_SECRET` | string | — | no | Secret from which anonymous donor tokens are derived. Must be distinct from `ENCRYPTION_KEY` |
| `SIGNING_PROVIDER` | enum | `local` | no | Signing backend: `local` (in-process), `hsm`, or `kms`. See [Signing Providers](#20-signing-providers-hsm--kms) |

---

## 4. Stellar / Horizon

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `STELLAR_NETWORK` | enum | `testnet` | no | Target Stellar network. Allowed: `testnet`, `mainnet`, `futurenet` |
| `STELLAR_ENVIRONMENT` | enum | `testnet` | no | Alias for `STELLAR_NETWORK` accepted by some service modules |
| `STELLAR_NETWORK_PASSPHRASE` | string | — | no | Override the network passphrase. Inferred from `STELLAR_NETWORK` when omitted |
| `HORIZON_URL` | string | — | no | Override the Horizon endpoint URL. Defaults to the canonical URL for `STELLAR_NETWORK` |
| `MOCK_STELLAR` | boolean | `true` | no | When `true`, no outbound Stellar/Horizon calls are made. Required for local dev and CI |
| `USE_MOCK_STELLAR` | boolean | `false` | no | Alias for `MOCK_STELLAR` in some service modules |
| `MOCK_STELLAR_LATENCY_MS` | number | `0` | no | Artificial delay (ms) injected by the mock Stellar service to simulate network latency |
| `DRY_RUN` | boolean | `false` | no | Skip submitting real Stellar transactions. Useful for staging. **Startup fails in production if `true`** |
| `HORIZON_POOL_SIZE` | number | `5` | no | Number of parallel Horizon HTTP connections maintained per pool |
| `HORIZON_POOL_COOLDOWN_MS` | number | `1000` | no | Minimum cooldown (ms) between using the same pool connection |
| `HORIZON_API_TIMEOUT_MS` | number | `15000` | no | Timeout (ms) for Horizon API requests |
| `HORIZON_SUBMIT_TIMEOUT_MS` | number | `30000` | no | Timeout (ms) for transaction submission to Horizon |
| `HORIZON_STREAM_TIMEOUT_MS` | number | `60000` | no | Timeout (ms) for Horizon SSE stream connections |
| `HORIZON_MAX_RETRY_ATTEMPTS` | number | `3` | no | Maximum number of automatic retries for failed Horizon requests |
| `HORIZON_RETRY_BASE_DELAY_MS` | number | `1000` | no | Base delay (ms) for Horizon retry exponential back-off |
| `HORIZON_RETRY_MAX_DELAY_MS` | number | `30000` | no | Maximum delay (ms) cap for Horizon retry back-off |
| `HORIZON_CB_FAILURE_THRESHOLD` | number | `5` | no | Number of consecutive Horizon failures before the circuit breaker opens |
| `HORIZON_CB_WINDOW_MS` | number | `60000` | no | Rolling window (ms) in which failures are counted by the circuit breaker |
| `HORIZON_CB_COOLDOWN_MS` | number | `30000` | no | Time (ms) the circuit breaker stays open before attempting a probe request |
| `STELLAR_BASE_RESERVE` | number | `0.5` | no | Minimum XLM base reserve per account entry (in XLM). Mirrors Stellar protocol value |
| `STELLAR_FEE_MULTIPLIER` | number | `1` | no | Multiplier applied to the network base fee when constructing transactions |
| `STELLAR_EXPLORER_URL` | string | — | no | Base URL of the Stellar block explorer used to build transaction links |
| `CONFIRMATION_LEDGER_THRESHOLD` | number | `3` | no | Number of ledger closings required before a transaction is considered confirmed |
| `MIN_RESERVE_XLM` | number | `1` | no | Minimum XLM balance (in XLM) required in a wallet for operations |
| `SYNC_MAX_PAGES` | number | `10` | no | Maximum number of Horizon history pages fetched during a transaction sync pass |
| `TX_SYNC_INTERVAL_MS` | number | `30000` | no | Interval (ms) between automatic transaction reconciliation runs |
| `SERVICE_SECRET_KEY` | string | — | no | Stellar secret key (`S…`) for service-initiated signing operations. Never commit. |
| `SERVICE_SIGNING_KEY` | string | — | no | Alias for `SERVICE_SECRET_KEY` used in some signing paths |
| `STELLAR_SECRET` | string | — | no | Legacy alias for the Stellar signing secret in older code paths |
| `SPONSOR_SECRET` | string | — | no | Stellar secret key of the fee-bump sponsor account |
| `RECIPIENT_SECRETS` | string | — | no | JSON-encoded map of recipient IDs to Stellar secret keys for multi-recipient flows |
| `ORGANIZATION_ADDRESS` | string | — | no | Stellar public key (`G…`) of the organisation's primary receiving account |

---

## 5. Database

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `DB_PATH` | string | `./data/stellar_donations.db` | no | File path to the SQLite database (relative to project root) |
| `DB_TYPE` | enum | `sqlite` | no | Database driver. Currently only `sqlite` is supported |
| `DB_POOL_SIZE` | number | `5` | no | Alias for `DB_POOL_MAX`. Maximum number of concurrent SQLite connections |
| `DB_POOL_MIN` | number | `1` | no | Minimum number of idle connections kept in the SQLite pool |
| `DB_POOL_MAX` | number | `5` | no | Maximum number of concurrent SQLite connections |
| `DB_ACQUIRE_TIMEOUT` | number | `10000` | no | Milliseconds to wait for an available pool connection before failing |
| `DB_QUERY_TIMEOUT_MS` | number | `5000` | no | Timeout (ms) applied to individual SQL queries |
| `SLOW_QUERY_THRESHOLD_MS` | number | `1000` | no | Queries exceeding this threshold (ms) are logged as slow |
| `SLOW_QUERY_BUFFER_SIZE` | number | `100` | no | Number of slow-query records retained in memory for the diagnostics endpoint |
| `MIGRATION_LOCK_TIMEOUT_MS` | number | `30000` | no | Milliseconds to wait for the advisory migration lock before failing |
| `MIGRATION_LOCK_POLL_INTERVAL_MS` | number | `500` | no | Polling interval (ms) when waiting for the migration lock |
| `AUDIT_LOG_RETENTION_DAYS` | number | `90` | no | Number of days to retain audit log entries before they are purged |
| `RETENTION_SCHEDULE_CRON` | string | `0 2 * * *` | no | Cron expression controlling when the data-retention cleanup job runs |
| `RETENTION_DRY_RUN` | boolean | `false` | no | When `true`, the retention job logs what it would delete without removing records |

---

## 6. CORS

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | string | `http://localhost:3000,...` | no | Comma-separated list of allowed browser origins. In production, set this explicitly — omitting it rejects all browser origins |
| `CORS_ALLOWED_METHODS` | string | `GET,POST,PUT,PATCH,DELETE,OPTIONS` | no | Comma-separated HTTP methods allowed in CORS pre-flight responses |
| `CORS_ALLOWED_HEADERS` | string | `Content-Type,Authorization,...` | no | Comma-separated request headers allowed through CORS |
| `CORS_MAX_AGE` | number | `86400` | no | `Access-Control-Max-Age` value in seconds (how long browsers may cache pre-flight results) |
| `CORS_ALLOW_ALL` | boolean | `false` | no | Allow every origin. **Startup fails in production if `true`** |

---

## 7. Logging

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `DEBUG_MODE` | boolean | `false` | no | Enable verbose debug logging. **Startup fails in production if `true`** |
| `LOG_TO_FILE` | boolean | `false` | no | Write logs to rotating files in addition to stdout |
| `LOG_DIR` | string | `./logs` | no | Directory for log files when `LOG_TO_FILE=true` |
| `LOG_VERBOSE` | boolean | `false` | no | Include request/response bodies in console log output |
| `LOG_LEVEL` | enum | `info` | no | Minimum log level: `error`, `warn`, `info`, `debug` |
| `LOG_FORMAT` | enum | `json` | no | Log output format: `json` or `pretty` |
| `LOG_BODY` | boolean | `false` | no | Log raw request and response bodies |
| `LOG_BODY_PATHS` | string | — | no | Comma-separated path prefixes for which request bodies are logged (overrides `LOG_BODY`) |
| `LOG_HEADERS` | boolean | `false` | no | Include request headers in access log entries |
| `LOG_SKIP_PATHS` | string | `/health,/metrics` | no | Comma-separated paths excluded from access log output |
| `LOG_SAMPLE_RATE` | number | `1` | no | Fraction of requests to log (0–1). `1` logs every request |
| `LOG_MAX_SIZE` | number | `10485760` | no | Maximum log file size in bytes before rotation (default 10 MB) |
| `ACCESS_LOG_INCLUDE_HEALTH` | boolean | `false` | no | When `true`, health-check requests appear in the access log |

---

## 8. Rate Limiting

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `DISABLE_RATE_LIMIT` | boolean | `false` | no | Bypass all rate-limiting middleware. **Startup fails in production if `true`** |
| `RATE_LIMIT` | number | `100` | no | Maximum requests per IP per rate-limit window (global limiter) |
| `RATE_LIMIT_MAX_REQUESTS` | number | `100` | no | Alias for `RATE_LIMIT` used in some middleware |
| `RATE_LIMIT_WINDOW_MS` | number | `60000` | no | Rolling window duration (ms) for the global rate limiter |
| `RATE_LIMIT_STORE` | enum | `memory` | no | Backing store for rate-limit counters: `memory` or `redis`. Use `redis` in multi-instance deployments |
| `RATE_LIMIT_FAIL_OPEN` | boolean | `true` | no | When `RATE_LIMIT_STORE=redis`, controls behaviour on Redis unavailability. `true` = allow requests; `false` = deny requests |
| `RATE_LIMIT_CLEANUP_INTERVAL_MS` | number | `60000` | no | Interval (ms) between in-memory store cleanup passes that evict expired windows |
| `REDIS_URL` | string | — | no | Redis connection URL (e.g. `redis://localhost:6379`). Required when `RATE_LIMIT_STORE=redis` |
| `AUTH_TOKEN_RATE_LIMIT` | number | `10` | no | Maximum requests per minute per IP on `POST /auth/token` |
| `AUTH_REFRESH_RATE_LIMIT` | number | `20` | no | Maximum requests per minute per IP on `POST /auth/refresh` |

For a full description of rate-limit layers, headers, and recommended client backoff, see
[docs/RATE_LIMITING.md](./RATE_LIMITING.md).

---

## 9. Donation Limits & Business Logic

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `MIN_DONATION_AMOUNT` | number | `0.01` | no | Minimum accepted donation amount in XLM |
| `MAX_DONATION_AMOUNT` | number | `10000` | no | Maximum accepted donation amount in XLM |
| `MAX_DAILY_DONATION_PER_DONOR` | number | `0` | no | Daily XLM cap per donor. `0` disables the cap |
| `PLATFORM_FEE_PERCENT` | number | `0` | no | Platform fee percentage deducted from each donation (0–100) |
| `MINIMUM_FEE_XLM` | number | `0` | no | Minimum platform fee in XLM regardless of `PLATFORM_FEE_PERCENT` |
| `MAXIMUM_FEE_XLM` | number | `0` | no | Maximum platform fee cap in XLM regardless of `PLATFORM_FEE_PERCENT` |
| `BULK_DONATION_CONCURRENCY` | number | `5` | no | Number of donations processed in parallel during a batch submission |
| `DISPUTE_WINDOW_DAYS` | number | `30` | no | Number of days after which a donation can no longer be disputed |
| `REFUND_WINDOW_HOURS` | number | `24` | no | Hours after a donation during which a refund can be initiated |
| `REFUND_ELIGIBILITY_WINDOW_DAYS` | number | `7` | no | Days within which a donation is eligible for refund consideration |
| `RECENT_DONATIONS_MAX_LIMIT` | number | `100` | no | Maximum number of records returned by the recent-donations endpoint |
| `RECENT_DONATIONS_CACHE_TTL_SECONDS` | number | `60` | no | TTL (seconds) for the recent-donations response cache |
| `BULK_IMPORT_MAX_ROWS` | number | `1000` | no | Maximum number of rows accepted per bulk wallet-import request |
| `BULK_IMPORT_MAX_SIZE_BYTES` | number | `5242880` | no | Maximum size (bytes) of a bulk import payload (default 5 MB) |
| `PLEDGE_EXPIRY_INTERVAL_MS` | number | `3600000` | no | Interval (ms) between pledge expiry check runs (default 1 h) |
| `API_KEY_EXPIRY_WARN_DAYS` | number | `14` | no | Days before an API key expires at which a warning is logged |

---

## 10. Caching

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `CACHE_MAX_SIZE` | number | `1000` | no | Maximum number of entries in the shared in-memory LRU cache |
| `CACHE_CLEANUP_INTERVAL_MS` | number | `60000` | no | Interval (ms) between cache eviction passes |
| `WALLET_BALANCE_CACHE_TTL_SECONDS` | number | `30` | no | TTL (seconds) for cached wallet-balance responses |
| `API_KEY_CACHE_TTL_SECONDS` | number | `60` | no | TTL (seconds) for the in-memory API key lookup cache |
| `STATS_CACHE_TTL_SECONDS` | number | `60` | no | TTL (seconds) for the donation stats cache |
| `STATS_SUMMARY_CACHE_TTL_SECONDS` | number | `300` | no | TTL (seconds) for the donation stats-summary cache |
| `FEDERATION_CACHE_TTL` | number | `3600` | no | TTL (seconds) for Stellar federation record lookups |
| `FEDERATION_CACHE_MAX_SIZE` | number | `500` | no | Maximum number of cached federation records |
| `FEDERATION_CACHE_CLEANUP_INTERVAL_MS` | number | `600000` | no | Interval (ms) between federation cache cleanup passes |

---

## 11. SMTP / Email Receipts

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `SMTP_HOST` | string | — | no | SMTP relay hostname (e.g. `smtp-relay.brevo.com`) |
| `SMTP_PORT` | number | `587` | no | SMTP port |
| `SMTP_SECURE` | boolean | `false` | no | Use TLS (`true`) or STARTTLS (`false`) for SMTP connections |
| `SMTP_USER` | string | — | no | SMTP authentication username |
| `SMTP_PASS` | string | — | no | SMTP authentication password (alias: `SMTP_PASSWORD`) |
| `SMTP_PASSWORD` | string | — | no | Alias for `SMTP_PASS` |
| `SMTP_FROM` | string | — | no | Sender address for outbound emails. Must be verified with your SMTP provider |

When `SMTP_HOST` is not set, email delivery is skipped gracefully.

---

## 12. IPFS / Pinata

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `PINATA_API_KEY` | string | — | no | Pinata API key for pinning donation impact certificates to IPFS |
| `PINATA_SECRET_KEY` | string | — | no | Pinata API secret corresponding to `PINATA_API_KEY` |
| `IPFS_GATEWAY_URL` | string | `https://gateway.pinata.cloud/ipfs` | no | Public IPFS gateway base URL used to construct certificate links |

When `PINATA_API_KEY` is not set, certificates fall back to local in-memory storage.

---

## 13. Geographic Blocking

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `GEO_BLOCKED_COUNTRIES` | string | — | no | Comma-separated ISO 3166-1 alpha-2 country codes whose requests are blocked (e.g. `RU,IR,KP`) |
| `GEO_ALLOWED_COUNTRIES` | string | — | no | Country codes that are always allowed, overriding `GEO_BLOCKED_COUNTRIES` |
| `GEO_ALLOWED_IPS` | string | — | no | Comma-separated IPs or CIDR ranges that bypass geo-blocking |
| `MAXMIND_DB_PATH` | string | `./data/GeoLite2-Country.mmdb` | no | Path to the MaxMind GeoLite2-Country binary database file |

Geo-blocking is inactive when `GEO_BLOCKED_COUNTRIES` is unset.

---

## 14. Abuse Detection

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ABUSE_WINDOW_MS` | number | `60000` | no | Rolling window (ms) in which request counts are tracked for burst detection |
| `ABUSE_SUSPICIOUS_THRESHOLD` | number | `100` | no | Number of requests within `ABUSE_WINDOW_MS` that triggers the burst-detection signal |
| `ABUSE_BLOCK_DURATION_MS` | number | `3600000` | no | Duration (ms) a flagged IP remains in the suspicious list (default 1 h) |
| `ABUSE_DB_PATH` | string | — | no | Optional path to a persistent SQLite file for abuse-detection tracking. If unset, tracking is in-memory only |

Abuse detection is observability-only — traffic is never blocked based on these signals alone.
See [docs/ABUSE_DETECTION.md](./ABUSE_DETECTION.md) for architecture details.

---

## 15. Replay & Deduplication

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `REPLAY_WINDOW_SECONDS` | number | `300` | no | Window (seconds) within which a duplicate request signature is rejected |
| `REPLAY_DETECTION_TIMEOUT_MS` | number | `5000` | no | Timeout (ms) for the replay-detection store lookup |
| `REPLAY_THRESHOLD` | number | `1` | no | Number of duplicate signatures allowed before rejection |
| `REPLAY_CLEANUP_INTERVAL_SECONDS` | number | `60` | no | Interval (seconds) between replay-store cleanup passes |
| `DEDUP_WINDOW_MS` | number | `60000` | no | Window (ms) within which identical request body hashes are deduplicated |
| `DEDUP_MEM_CACHE_MAX_SIZE` | number | `10000` | no | Maximum entries in the in-memory deduplication cache |
| `DEDUP_MEM_CACHE_CLEANUP_INTERVAL_MS` | number | `300000` | no | Interval (ms) between deduplication cache cleanup passes |
| `NONCE_CLEANUP_INTERVAL_MS` | number | `60000` | no | Interval (ms) between nonce-store cleanup passes |
| `NONCE_MAX_SIZE` | number | `100000` | no | Maximum number of nonce entries held in memory |
| `MEMO_COLLISION_WINDOW_MS` | number | `60000` | no | Window (ms) in which duplicate memo values are considered collisions |
| `MEMO_KEYS_DIR` | string | `./data/memo-keys` | no | Directory where memo encryption keys are persisted |

---

## 16. Backup

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `BACKUP_DIR` | string | `./data/backups` | no | Local directory where encrypted database backup files are written |
| `BACKUP_INTERVAL_MS` | number | `3600000` | no | Interval (ms) between automatic backup runs (default 1 h) |
| `BACKUP_S3_BUCKET` | string | — | no | S3 bucket name for off-site backup upload. When unset, backups are local only |
| `BACKUP_S3_PREFIX` | string | `backups/` | no | Key prefix used when uploading backup files to S3 |
| `AWS_REGION` | string | `us-east-1` | no | AWS region used for S3 backup uploads (and KMS if applicable) |

---

## 17. SSE / WebSocket Streaming

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ENABLE_SERVER_PUSH` | boolean | `true` | no | Enable server-sent event (SSE) and WebSocket push endpoints |
| `SSE_MAX_CONNECTIONS_PER_KEY` | number | `10` | no | Maximum concurrent SSE connections allowed per API key |
| `SSE_EVENT_BUFFER_SIZE` | number | `100` | no | Number of events buffered per SSE connection for reconnecting clients |
| `WS_MAX_WALLETS` | number | `50` | no | Maximum number of wallet subscriptions per WebSocket connection |
| `WS_HEARTBEAT_MS` | number | `30000` | no | Interval (ms) between WebSocket ping frames |
| `LEADERBOARD_KEEPALIVE_MS` | number | `15000` | no | Interval (ms) between keepalive comments on the leaderboard SSE stream |
| `PUBSUB_ADAPTER` | enum | `memory` | no | Pub/sub adapter: `memory` (in-process) or `redis` |

---

## 18. Observability & Tracing

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `OTEL_ENABLED` | boolean | `false` | no | Enable OpenTelemetry trace/metric export |
| `OTEL_SERVICE_NAME` | string | `stellar-donation-api` | no | Service name reported to the OTLP collector |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | — | no | OTLP exporter endpoint URL (e.g. `http://collector:4318`) |
| `OTEL_EXPORTER_OTLP_HEADERS` | string | — | no | Comma-separated `key=value` pairs added as headers to OTLP export requests |
| `ANOMALY_WEBHOOK_URL` | string | — | no | URL to POST anomaly-detection alerts to. When unset, alerts are logged only |
| `ORPHAN_ALERT_THRESHOLD` | number | `10` | no | Number of orphaned transactions before an alert is triggered |

---

## 19. Organisation Metadata

These variables are embedded in generated PDF receipts and tax documents.

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `ORGANIZATION_LEGAL_NAME` | string | — | no | Legal name of the organisation for receipt headers |
| `ORGANIZATION_EIN` | string | — | no | Employer Identification Number (EIN) printed on tax receipts |
| `ORGANIZATION_EMAIL` | string | — | no | Contact email address printed on receipts |
| `ORGANIZATION_PHONE` | string | — | no | Contact phone number printed on receipts |
| `ORGANIZATION_CITY` | string | — | no | City component of the organisation's mailing address |
| `ORGANIZATION_STATE` | string | — | no | State/province component of the organisation's mailing address |
| `ORGANIZATION_ZIP_CODE` | string | — | no | Postal code component of the organisation's mailing address |
| `ORGANIZATION_WEBSITE` | string | — | no | Website URL printed on receipts |

---

## 20. Signing Providers (HSM / KMS)

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `SIGNING_PROVIDER` | enum | `local` | no | Active signing backend: `local`, `hsm`, or `kms` |
| `HSM_SLOT_ID` | number | — | no | PKCS#11 slot ID when `SIGNING_PROVIDER=hsm` |
| `HSM_PIN` | string | — | no | PKCS#11 slot PIN when `SIGNING_PROVIDER=hsm` |
| `KMS_PROVIDER` | enum | — | no | Cloud KMS provider: `aws` or `gcp` |
| `KMS_KEY_ID` | string | — | no | KMS key ARN (AWS) or resource name (GCP) for remote signing |

See [ADR-003](./adr/003-signing-provider-strategy.md) for the rationale behind this strategy.

---

## 21. Miscellaneous / Feature Config

| Variable | Type | Default | Required? | Effect |
|---|---|---|---|---|
| `FEATURE_FLAGS` | string | — | no | JSON object of feature-flag overrides, e.g. `{"newDonationFlow":true}`. See [docs/FEATURE_FLAGS_RUNTIME.md](./FEATURE_FLAGS_RUNTIME.md) |
| `COINGECKO_API_KEY` | string | — | no | CoinGecko API key (`CG-…` format) for XLM/fiat exchange rate lookups. Without this, the unauthenticated endpoint is used (stricter rate limits) |
| `FEDERATION_RECORDS` | string | — | no | JSON-encoded static federation records for local development, bypassing live federation lookups |
| `FEDERATION_DOMAIN` | string | — | no | Domain used for Stellar federation lookups |
| `API_BASE_URL` | string | — | no | Publicly accessible base URL of this API, used in generated links (e.g. in receipts, webhooks) |
| `CSP_REPORT_URI` | string | — | no | URI to which CSP violation reports are sent |
| `CSP_REPORT_ONLY` | boolean | `false` | no | When `true`, CSP violations are reported but not enforced |
| `COMPRESSION_LEVEL` | number | `6` | no | zlib compression level (1–9) for gzip response encoding |
| `COMPRESSION_THRESHOLD_BYTES` | number | `1024` | no | Minimum response size (bytes) before compression is applied |
| `WEBHOOK_ALLOW_TLS_SKIP_VERIFY` | boolean | `false` | no | Disable TLS certificate verification for outbound webhook deliveries. **Never use in production** |

---

## 22. Unsafe Development Flags

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

## 23. Secret Strength Requirements

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

## 24. SSRF Protection

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
