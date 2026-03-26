# Architecture Overview

## System Design

The Stellar Micro-Donation API is a Node.js/Express REST API that records and executes micro-donations on the Stellar blockchain. It uses SQLite for persistence and supports both live Stellar network calls and a mock mode for development/testing.

```
Clients (HTTP)
     │
     ▼
Express.js API Layer          ← routes/, middleware/
     │
     ▼
Service Layer                 ← services/
  ├── DonationService
  ├── StellarService / MockStellarService
  └── RecurringDonationScheduler (background, 60s interval)
     │
     ├──────────────────────┐
     ▼                      ▼
SQLite Database         Stellar Network
(stellar_donations.db)  (Horizon API)
```

## Key Components

### API Layer (`src/routes/`)

| File | Responsibility |
|------|---------------|
| `app.js` | Express app setup, middleware registration, server bootstrap |
| `donation.js` | Donation CRUD, verification, status updates |
| `wallet.js` | Wallet metadata management, transaction history |
| `stream.js` | Recurring donation schedule management |
| `stats.js` | Analytics and aggregation endpoints |
| `transaction.js` | Paginated transaction listing, Stellar sync |

### Middleware (`src/middleware/`)

| Middleware | Purpose |
|-----------|---------|
| `apiKey.js` | API key authentication |
| `rbac.js` | Role-based permission checks |
| `rateLimiter.js` | Per-endpoint rate limiting |
| `idempotency.js` | Duplicate request prevention |
| `schemaValidation.js` | Request body validation |
| `payloadSizeLimiter.js` | Request size enforcement |

### Service Layer (`src/services/`)

**`StellarService`** — wraps the Stellar SDK. Handles:
- Submitting payment transactions to Horizon
- Loading account details and balances
- Transaction verification by hash

**`MockStellarService`** — drop-in replacement for testing. Returns deterministic fake responses without any network calls. Activated via `MOCK_STELLAR=true`.

**`RecurringDonationScheduler`** — background service that polls the database every 60 seconds for due recurring donations and executes them via `StellarService`.

**`DonationService`** — orchestrates donation creation: validates inputs, calls `StellarService`, persists to SQLite, handles idempotency.

### Data Layer (`src/utils/database.js`)

SQLite via `better-sqlite3`. Three core tables:

- `users` — wallet public keys
- `transactions` — donation records with status, memo, idempotency key
- `recurring_donations` — schedules with frequency and next execution date

### Configuration (`src/config/`)

`stellar.js` exports `getStellarService()` which returns either `StellarService` or `MockStellarService` based on the `MOCK_STELLAR` env var. All environment validation runs at startup.

## Request Lifecycle

```
Request
  → apiKey middleware (authenticate)
  → rbac middleware (authorize)
  → rateLimiter (throttle)
  → idempotency check (deduplicate)
  → schemaValidation (validate body)
  → payloadSizeLimiter (size check)
  → route handler
  → DonationService / StellarService
  → SQLite persist
  → Response
```

## Security Model

- All endpoints require an API key (`X-API-Key` header)
- Three roles: `admin` (all), `user` (standard ops), `guest` (read-only)
- API keys stored hashed in SQLite; support rotation with zero downtime
- Sensitive values (keys, secrets) masked in all log output
- Input sanitized against XSS and injection at middleware layer

## Scalability Notes

This is a single-process application backed by SQLite. It is suitable for low-to-medium traffic. For higher scale:
- Replace SQLite with PostgreSQL
- Run multiple processes behind a load balancer (SQLite WAL mode supports concurrent reads)
- Move the scheduler to a dedicated worker process
