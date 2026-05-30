# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- Remove `clientIp` and `protocol` from `GET /health` response to prevent IP enumeration (#758)
- Add allowlist validation for `category` and `severity` filter parameters in `GET /admin/audit-logs` to prevent SQL injection (#760)

### Added
- `MockStellarServiceStub`: thin (<200 line) configurable stub implementing `StellarServiceInterface` for unit tests (#756)
- `npm run changelog` script to generate changelog entries from conventional commits (#761)

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
