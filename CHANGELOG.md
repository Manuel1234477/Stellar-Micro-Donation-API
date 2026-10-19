# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- `SocialRecoveryService.setGuardians()` failed with `DatabaseError` because the test schema lacked the migration 045 columns; guardian replacement is now atomic and rejects duplicate keys (#1695)
- Transaction model no longer queries `donations_store` at require time; the store loads after migrations in the bootstrap sequence and `/health/ready` reports not-ready until it has loaded (#1696)
- `rotationLockMiddleware` caches rotation status (`ROTATION_LOCK_CACHE_TTL_MS`), fails open with a rate-limited warning when the lock is unreadable, and migration 040 now actually creates `rotation_locks` (#1697)
- Admin backup routes are mounted at `/admin/backups` as documented; added `POST /admin/backups/:backupId/verify` and OpenAPI/RBAC coverage (#1698)

### Deprecated
- Unversioned API paths now redirect to their versioned equivalents with `308 Permanent Redirect` and carry `Deprecation: true`, `Sunset: Sat, 01 Jan 2027 00:00:00 GMT` and `Link: </api/v1/...>; rel="successor-version"` headers (#1802, #1803):
  - All legacy paths covered by the #738 redirects (e.g. `/stats/overpayments`, `/stats/memo-collisions`) now emit the deprecation headers
  - `/channels` is no longer mounted directly; it redirects to `/api/v1/channels` with the same headers (#1803)
  - Legacy-path usage is logged and counted in metrics per API key so remaining callers can be identified
  - **Removal date: 2027-01-01.** After this date the unversioned redirects (including `/channels`) will be removed. Migrate all clients to `/api/v1/*` before then; see `docs/VERSIONING_STRATEGY.md`.

### Security
- Remove `clientIp` and `protocol` from `GET /health` response to prevent IP enumeration (#758)
- Add allowlist validation for `category` and `severity` filter parameters in `GET /admin/audit-logs` to prevent SQL injection (#760)
- Add container image vulnerability scanning to CI pipeline with Trivy (#1233)
  - Automated scanning on Dockerfile/dependency changes and daily schedule
  - Build fails on CRITICAL/HIGH vulnerabilities
  - Allowlist process for accepted/unfixable findings in `.trivyignore`
  - Scan reports uploaded to GitHub Security tab and CI artifacts
  - Local scanning scripts for developers (`npm run scan:container`)

### Added
- Central environment schema `src/config/envSchema.js` declaring all 260 variables with type, default and description; the environment is validated once at startup and exposed as a frozen, typed object via `src/config/env.js` (#1784)
- `.env.example` and the variable reference in `docs/CONFIGURATION.md` are generated from the schema (`npm run config:generate`); `npm run config:check` fails CI when `src/` reads an undeclared variable or the generated files are stale (#1785)
- `no-restricted-properties` lint rule blocks new direct `process.env` reads outside `src/config` (existing files grandfathered) (#1784)
- `SharedStateStore` with memory and Redis backends; with `SHARED_STATE_BACKEND=redis`, body-hash deduplication, request-signing nonces and SSE per-key connection limits are shared across replicas. Inventory of module-level state in `docs/architecture/multi-instance-state.md` (#1786)
- Inbound webhook sources are registered at boot from `INBOUND_WEBHOOK_SOURCES` so every replica has the same set (#1786)
- Stellar DEX orderbook fallback for XLM price discovery when CoinGecko is unavailable or rate-limited (#1567):
  - XLM/USD is derived from the mid-market price of the best bid and ask on the XLM/USDC orderbook
  - Both sources share the existing 5-minute rate cache; a fresh DEX price is preferred over a stale cached one
  - `GET /health` and `GET /api/v1/exchange-rates` report the active price source
  - Quote asset is configurable via `XLM_USDC_ASSET` (defaults to the Circle USDC issuer for the active network)
- `MockStellarServiceStub`: thin (<200 line) configurable stub implementing `StellarServiceInterface` for unit tests (#756)
- `npm run changelog` script to generate changelog entries from conventional commits (#761)
- Container security documentation in `docs/CONTAINER_SECURITY.md` (#1233)
- Comprehensive startup configuration validation in `src/utils/startupChecks.js` (#1234):
  - Horizon URL format and protocol policy (HTTPS required in production)
  - Database path existence/writability (respects `DB_PATH`) plus permission warnings
  - Stellar signing-key format validation (`SERVICE_SECRET_KEY`, `STELLAR_SECRET`, `SERVICE_SIGNING_KEY`, `SPONSOR_SECRET`)
  - Numeric range validation for DB/Horizon pool sizes and timeouts
  - Mutually-exclusive / co-required flag validation (`SIGNING_PROVIDER`→HSM/KMS creds, `REQUIRE_REQUEST_SIGNING`→`REQUEST_SIGNING_SECRET`, `RATE_LIMIT_STORE=redis`→`REDIS_URL`, `ENCRYPTION_KEY_VERSION=1`→`ENCRYPTION_KEY_1`)
  - Boot sequence (`src/app.js`) now runs the checks with `exitOnFailure` before binding the port
- Fix `isBlockedIPv4` in `src/utils/ssrf.js` so private/link-local ranges with the high bit set (e.g. `192.168.0.0/16`, `172.16.0.0/12`, `169.254.0.0/16`) are actually blocked (#1119)

### Changed
- Startup checks log through the structured logger when run by the server (console output is kept for `npm run validate-env`); `no-console` now covers all of `src/config` except the two files the logger depends on (#1783)
- Corrected defaults in `docs/CONFIGURATION.md` that disagreed with the code (e.g. `SSE_MAX_CONNECTIONS_PER_KEY` is 5, `TX_SYNC_INTERVAL_MS` is 15 min, `PLATFORM_FEE_PERCENT` is 1.5) (#1785)

---

## [1.0.0] - 2025-04-01

### Added
- One-time donations via `POST /donations` with Stellar testnet/mainnet support
- Recurring donation schedules (`POST /stream/create`, `GET /stream/schedules`)
- Wallet management endpoints (`POST /wallets`, `GET /wallets`, `PATCH /wallets/:id`)
- Donation analytics and statistics (`GET /stats/daily`, `/stats/weekly`, `/stats/summary`)
- API key authentication with role-based access control (admin / user / guest)
- Zero-downtime API key rotation with versioning and graceful deprecation
- Mock mode (`MOCK_STELLAR=true`) for development without network calls
- Debug mode (`DEBUG_MODE=true`) for verbose logging
- Rate limiting on donation endpoints
- Idempotency key support to prevent duplicate transactions
- Sensitive data masking in all application logs
- Automated recurring donation scheduler (runs every 60 s)
- Audit logging for all security-sensitive operations
- `GET /health`, `GET /health/live`, `GET /health/ready` health check endpoints
- `GET /admin/audit-logs` paginated audit log query endpoint
- Stellar failure simulation for network error testing
- SQLite database with migration support
- OpenAPI / Swagger documentation at `/api-docs`
- GraphQL endpoint at `/graphql`
- Webhook delivery with retry queue
- Geo-blocking middleware
- Circuit breaker for external service calls
- Transaction reconciliation service
- PDF tax receipt generation
- CSV export for donations and audit logs
- Prometheus metrics at `/metrics`

### Security
- Helmet middleware for HTTP security headers
- CORS origin allowlist
- Request replay detection
- IP allowlist support
- Payload size limits on all endpoints

[Unreleased]: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Manuel1234477/Stellar-Micro-Donation-API/releases/tag/v1.0.0
