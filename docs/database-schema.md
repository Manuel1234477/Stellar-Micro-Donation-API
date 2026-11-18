# Database Schema Reference

This document describes the current SQLite database schema for the Stellar Micro-Donation API. It covers every table, its columns (type, nullability, default, purpose), indexes, and foreign-key relationships. An ASCII ER diagram shows entity relationships at a glance.

**Source of truth:** migrations in `src/migrations/` applied in numerical order.  
**Last reviewed:** 2026-06-30

---

## How to regenerate this diagram

The schema is derived from the migration files. To inspect the live schema after running migrations:

```bash
# 1. Run all migrations against a fresh database
npm run init-db && npm run migrate

# 2. Dump the schema from SQLite
sqlite3 data/stellar_donations.db .schema

# 3. (Optional) generate a visual ER diagram with a tool such as:
#    - SchemaSpy:  https://schemaspy.org
#    - dbdiagram.io (paste CREATE TABLE DDL)
#    - sqlite-utils: sqlite-utils schema data/stellar_donations.db
```

When you add a migration, update this document to reflect the new or altered tables.

---

## ER Diagram

```
users ──────────────────────────────────────────────────────┐
  │ 1                                                        │
  │◄── transactions (senderId, receiverId)                   │
  │◄── recurring_donations (donorId, recipientId)            │
  │◄── donation_velocity (donorId, recipientId)              │
  │◄── recipient_velocity_limits (recipientId)               │
  │◄── recovery_guardians (walletId)                         │
  │◄── recovery_requests (walletId)                          │
  │                                                          │
transactions ──────────────────────────────────────────────►│
  │◄── campaigns (created_by → users)                        │
  │◄── disputes (donationId)                                 │
  │    idempotencyKey (UNIQUE)                               │
  │    stellar_tx_id  (UNIQUE)                               │
  │                                                          │
api_keys ──────────────────────────────────────────────────►│
  │◄── donation_exports (api_key_id)                         │
  │◄── api_key_usage   (api_key TEXT — not FK)               │
  │                                                          │
sep10_challenges  (standalone — challengeId PK)             │
wallets           (standalone — id TEXT PK)                 │
audit_logs        (standalone)                              │
nonce_store       (standalone)                              │
donation_totals         (recipient_id TEXT PK)             │
donation_totals_global  (id INTEGER PK, single row)        │
corporate_employers     (id TEXT PK)                        │
corporate_claims        (id TEXT PK)                        │
anomaly_history         (id INTEGER PK)                     │
anomaly_records         (id INTEGER PK)                     │
recovery_approvals ◄── recovery_requests (recoveryRequestId)│
student_fees / fee_payments (legacy fee-installment tables) │
```

---

## Tables

### `users`

Central identity table. Each row represents a Stellar wallet/account known to the platform.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `publicKey` | TEXT | NO | — | Stellar public key (Ed25519, 56 chars). UNIQUE |
| `encryptedSecret` | TEXT | YES | NULL | AES-256 encrypted Stellar secret key (optional, stored only when key custody is enabled) |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Row creation time |
| `deleted_at` | DATETIME | YES | NULL | Soft-delete timestamp; NULL = active |
| `daily_limit` | REAL | YES | NULL | Per-user daily donation cap in XLM; NULL = use global default |
| `monthly_limit` | REAL | YES | NULL | Per-user monthly donation cap in XLM |
| `per_transaction_limit` | REAL | YES | NULL | Per-transaction cap in XLM |
| `tenant_id` | TEXT | NO | `'default'` | Multi-tenancy discriminator |

**Indexes:** UNIQUE on `publicKey`.

---

### `transactions`

Records every donation/payment processed through the API.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `senderId` | INTEGER | NO | — | FK → `users.id` |
| `receiverId` | INTEGER | NO | — | FK → `users.id` |
| `amount` | REAL | NO | — | Amount in XLM (stroops stored as TEXT in some contexts via migration 021) |
| `memo` | TEXT | YES | NULL | Plaintext or encrypted memo |
| `notes` | TEXT | YES | NULL | Free-text donor notes |
| `tags` | TEXT | YES | NULL | JSON array of tag strings |
| `timestamp` | DATETIME | YES | CURRENT_TIMESTAMP | When the transaction was recorded |
| `deleted_at` | DATETIME | YES | NULL | Soft-delete timestamp |
| `idempotencyKey` | TEXT | YES | NULL | Client-supplied idempotency key. UNIQUE (partial index, non-NULL only) |
| `stellar_tx_id` | TEXT | YES | NULL | Stellar network transaction hash. UNIQUE |
| `is_orphan` | INTEGER | NO | `0` | 1 = transaction exists on-chain but no matching local record was found during sync |
| `campaign_id` | INTEGER | YES | NULL | FK → `campaigns.id` |
| `validAfter` | INTEGER | YES | `0` | Unix timestamp — transaction not valid before this time |
| `validBefore` | INTEGER | YES | `0` | Unix timestamp — transaction not valid after this time (time-bound) |
| `tenant_id` | TEXT | NO | `'default'` | Multi-tenancy discriminator |

**Indexes:**
- `idx_transactions_idempotency` on `(idempotencyKey)`
- `idx_transactions_idempotency_key_unique` UNIQUE on `(idempotencyKey) WHERE idempotencyKey IS NOT NULL`

---

### `campaigns`

Crowdfunding campaigns that donations can be attributed to.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `name` | TEXT | NO | — | Campaign display name |
| `description` | TEXT | YES | NULL | Long-form description |
| `goal_amount` | REAL | NO | — | Fundraising target in XLM |
| `current_amount` | REAL | YES | `0` | Running total donated so far |
| `start_date` | DATETIME | YES | NULL | Campaign start; NULL = starts immediately |
| `end_date` | DATETIME | YES | NULL | Campaign end; NULL = no deadline |
| `status` | TEXT | YES | `'active'` | `active` \| `completed` \| `cancelled` |
| `created_by` | INTEGER | YES | NULL | FK → `users.id` |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Row creation time |
| `updatedAt` | DATETIME | YES | CURRENT_TIMESTAMP | Last update time |
| `deleted_at` | DATETIME | YES | NULL | Soft-delete timestamp |
| `tenant_id` | TEXT | NO | `'default'` | Multi-tenancy discriminator |

---

### `recurring_donations`

Schedules for automated periodic donations.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `donorId` | INTEGER | NO | — | FK → `users.id` |
| `recipientId` | INTEGER | NO | — | FK → `users.id` |
| `amount` | REAL | NO | — | Amount per execution in XLM |
| `frequency` | TEXT | NO | — | `daily` \| `weekly` \| `monthly` \| `custom` |
| `nextExecutionDate` | DATETIME | NO | — | When the scheduler will next fire this donation |
| `status` | TEXT | YES | `'active'` | `active` \| `paused` \| `cancelled` \| `completed` |
| `executionCount` | INTEGER | YES | `0` | Number of times successfully executed |
| `customIntervalDays` | INTEGER | YES | NULL | Used when `frequency = 'custom'`; interval in days |
| `maxExecutions` | INTEGER | YES | NULL | Cap on total executions; NULL = unlimited |
| `webhookUrl` | TEXT | YES | NULL | Optional per-schedule webhook URL |
| `failureCount` | INTEGER | YES | `0` | Consecutive execution failures |
| `lastExecutionDate` | DATETIME | YES | NULL | Timestamp of the most recent execution |
| `tenant_id` | TEXT | NO | `'default'` | Multi-tenancy discriminator |

---

### `api_keys`

Database-backed API keys with role, quota, rotation, and expiry support.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `key_hash` | TEXT | NO | — | SHA-256 hash of the raw key. UNIQUE |
| `key_prefix` | TEXT | NO | — | First 8 chars of raw key (for display/lookup) |
| `name` | TEXT | NO | — | Human-readable label |
| `role` | TEXT | NO | `'user'` | `admin` \| `user` \| `guest` |
| `status` | TEXT | NO | `'active'` | `active` \| `deprecated` \| `revoked` |
| `created_by` | TEXT | YES | NULL | Identifier of the admin who created the key |
| `metadata` | TEXT | YES | NULL | JSON blob for arbitrary key metadata |
| `expires_at` | INTEGER | YES | NULL | Unix ms expiry; NULL = never expires |
| `last_used_at` | INTEGER | YES | NULL | Unix ms of most recent authenticated request |
| `deprecated_at` | INTEGER | YES | NULL | Unix ms when key was deprecated |
| `revoked_at` | INTEGER | YES | NULL | Unix ms when key was revoked |
| `created_at` | INTEGER | NO | — | Unix ms creation timestamp |
| `grace_period_days` | INTEGER | NO | `30` | Days after deprecation before forced revocation |
| `rotated_to_id` | INTEGER | YES | NULL | FK → `api_keys.id` of the replacement key |
| `signing_required` | INTEGER | NO | `0` | 1 = requests with this key must be HMAC-signed |
| `key_secret` | TEXT | YES | NULL | HMAC signing secret (stored encrypted) |
| `allowed_ips` | TEXT | YES | NULL | JSON array of CIDR ranges; NULL = all IPs allowed |
| `monthly_quota` | INTEGER | YES | NULL | Max requests per calendar month; NULL = unlimited |
| `quota_used` | INTEGER | NO | `0` | Requests used in the current quota window |
| `quota_reset_at` | INTEGER | YES | NULL | Unix ms when quota resets |
| `tenant_id` | TEXT | NO | `'default'` | Multi-tenancy discriminator |
| `notification_email` | TEXT | YES | NULL | Email for expiry notifications |
| `last_expiry_notification_sent_at` | INTEGER | YES | NULL | Unix ms of last expiry warning email |

**Indexes:**
- `idx_api_keys_key_hash` on `(key_hash)`
- `idx_api_keys_status` on `(status)`

---

### `audit_logs`

Immutable, integrity-protected log of security-relevant events.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `timestamp` | TEXT | NO | — | ISO-8601 event timestamp |
| `category` | TEXT | NO | — | Event category (e.g. `AUTH`, `DONATION`, `KEY_ROTATION`) |
| `action` | TEXT | NO | — | Specific action (e.g. `LOGIN`, `CREATE`, `REVOKE`) |
| `severity` | TEXT | NO | — | `INFO` \| `WARN` \| `ERROR` \| `CRITICAL` |
| `result` | TEXT | NO | — | `success` \| `failure` |
| `userId` | TEXT | YES | NULL | Stellar public key or API key identifier of the actor |
| `requestId` | TEXT | YES | NULL | Correlation ID from the HTTP request |
| `ipAddress` | TEXT | YES | NULL | Client IP address |
| `resource` | TEXT | YES | NULL | Resource affected (e.g. `donations/42`) |
| `reason` | TEXT | YES | NULL | Human-readable reason for the event |
| `details` | TEXT | YES | NULL | JSON blob with additional context |
| `integrityHash` | TEXT | NO | — | HMAC of the row contents for tamper detection |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Row insertion time |

**Indexes:** on `timestamp`, `category`, `action`, `severity`, `userId`, `requestId`.

---

### `wallets`

Wallet metadata records (separate from `users` — wallets are address-labelled containers, users are identity rows).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | TEXT | NO | PK | UUID string |
| `address` | TEXT | NO | — | Stellar public key. UNIQUE |
| `label` | TEXT | YES | NULL | Display name for the wallet |
| `ownerName` | TEXT | YES | NULL | Wallet owner's name |
| `notes` | TEXT | YES | NULL | Free-text notes |
| `leaderboard_visibility` | INTEGER | YES | `1` | 1 = visible on public leaderboard |
| `last_synced_at` | TEXT | YES | NULL | ISO-8601 timestamp of last Horizon sync |
| `last_cursor` | TEXT | YES | NULL | Horizon paging cursor for incremental sync |
| `createdAt` | TEXT | NO | — | ISO-8601 creation timestamp |
| `updatedAt` | TEXT | YES | NULL | ISO-8601 last-updated timestamp |
| `deletedAt` | TEXT | YES | NULL | Soft-delete timestamp |

**Indexes:** `idx_wallets_address` on `(address)`.

---

### `sep10_challenges`

Tracks issued SEP-0010 web auth challenges. Used to enforce expiry and single-use.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `challengeId` | TEXT | NO | PK | Random 32-char hex identifier |
| `account` | TEXT | NO | — | Stellar public key the challenge was issued to |
| `expiresAt` | INTEGER | NO | — | Unix ms expiry timestamp |
| `issuedAt` | INTEGER | NO | — | Unix ms when challenge was created |
| `used` | INTEGER | NO | `0` | 1 = challenge has been consumed (single-use) |
| `usedAt` | INTEGER | YES | NULL | Unix ms when challenge was verified |

**Indexes:** `idx_sep10_challenges_expires` on `(expiresAt)`.

---

### `donation_velocity`

Rolling window counters used to enforce per-donor/recipient rate limits.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `donorId` | INTEGER | NO | — | FK → `users.id` |
| `recipientId` | INTEGER | NO | — | FK → `users.id` |
| `windowStart` | DATETIME | NO | — | Start of the velocity window |
| `totalAmount` | REAL | NO | `0` | Total donated in this window |
| `count` | INTEGER | NO | `0` | Number of donations in this window |
| `updatedAt` | DATETIME | YES | CURRENT_TIMESTAMP | Last update time |

**Indexes:** UNIQUE on `(donorId, recipientId, windowStart)`.

---

### `recipient_velocity_limits`

Per-recipient configurable donation rate limits.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `recipientId` | INTEGER | NO | — | FK → `users.id`. UNIQUE |
| `maxAmount` | REAL | YES | NULL | Max total XLM receivable per window |
| `maxCount` | INTEGER | YES | NULL | Max donations receivable per window |
| `windowType` | TEXT | NO | `'daily'` | `daily` \| `weekly` \| `monthly` |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Row creation time |
| `updatedAt` | DATETIME | YES | CURRENT_TIMESTAMP | Last update time |

---

### `disputes`

Donation disputes raised by recipients.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `donationId` | INTEGER | NO | — | FK → `transactions.id`. UNIQUE per donation |
| `recipientPublicKey` | TEXT | NO | — | Stellar public key of the disputing recipient |
| `reason` | TEXT | NO | — | Free-text reason for dispute |
| `evidence` | TEXT | YES | NULL | Supporting evidence (JSON or text) |
| `status` | TEXT | YES | `'open'` | `open` \| `resolved` \| `rejected` |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Dispute creation time |
| `updatedAt` | DATETIME | YES | CURRENT_TIMESTAMP | Last update time |
| `resolvedAt` | DATETIME | YES | NULL | When dispute was closed |
| `resolutionNotes` | TEXT | YES | NULL | Admin notes on resolution |

**Indexes:** on `(status)`, on `(recipientPublicKey)`.

---

### `donation_exports`

Tracks async CSV/JSON export jobs.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `export_id` | TEXT | NO | — | UUID for the export job. UNIQUE |
| `api_key_id` | TEXT | NO | — | FK → `api_keys.id` (which key triggered export) |
| `start_date` | TEXT | YES | NULL | Filter: donations on or after this date |
| `end_date` | TEXT | YES | NULL | Filter: donations on or before this date |
| `status_filter` | TEXT | YES | NULL | Filter: donation status |
| `sender_public_key` | TEXT | YES | NULL | Filter: sender account |
| `recipient_public_key` | TEXT | YES | NULL | Filter: recipient account |
| `format` | TEXT | NO | — | `csv` \| `json` |
| `status` | TEXT | NO | — | `pending` \| `processing` \| `completed` \| `failed` |
| `record_count` | INTEGER | YES | `0` | Rows in the exported file |
| `file_path` | TEXT | YES | NULL | Server-side file path of the completed export |
| `error_message` | TEXT | YES | NULL | Error detail if `status = failed` |
| `signed_url` | TEXT | YES | NULL | Temporary download URL |
| `signed_url_expires_at` | TEXT | YES | NULL | Expiry timestamp of the signed URL |
| `created_at` | TEXT | NO | — | ISO-8601 creation timestamp |
| `updated_at` | TEXT | YES | NULL | ISO-8601 last-updated timestamp |

---

### `corporate_employers`

Registered employers for the corporate donation-matching programme.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | TEXT | NO | PK | UUID string |
| `name` | TEXT | NO | — | Employer display name |
| `matchRatio` | INTEGER | NO | — | Match multiplier percentage (e.g. `100` = 1:1 match) |
| `annualCap` | REAL | NO | — | Annual XLM cap on total matching payouts |
| `addedAt` | TEXT | NO | — | ISO-8601 registration timestamp |

---

### `corporate_claims`

Individual match claims by donors against a registered employer.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | TEXT | NO | PK | UUID string |
| `donorId` | TEXT | NO | — | Stellar public key of the donor |
| `employerId` | TEXT | NO | — | FK → `corporate_employers.id` |
| `donationAmount` | REAL | NO | — | Original donation amount in XLM |
| `matchAmount` | REAL | NO | — | Calculated match amount in XLM |
| `status` | TEXT | NO | `'pending'` | `pending` \| `approved` \| `rejected` \| `paid` |
| `createdAt` | TEXT | NO | — | ISO-8601 claim creation timestamp |
| `reviewedAt` | TEXT | YES | NULL | ISO-8601 review timestamp |
| `rejectReason` | TEXT | YES | NULL | Reason for rejection |
| `txId` | TEXT | YES | NULL | Stellar transaction ID for the match payment |

**Indexes:** on `(employerId, donorId, status, createdAt)`.

---

### `nonce_store`

Single-use nonces for replay-attack prevention on signed requests.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `nonce` | TEXT | NO | PK | The nonce value |
| `usedAt` | DATETIME | YES | CURRENT_TIMESTAMP | When the nonce was first seen |
| `expiresAt` | DATETIME | NO | — | After this time the nonce record may be purged |

**Indexes:** `idx_nonce_store_expiresAt` on `(expiresAt)`.

---

### `donation_totals`

Pre-aggregated per-recipient donation totals for fast leaderboard and stats queries.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `recipient_id` | TEXT | NO | PK | Stellar public key of the recipient |
| `total_stroops` | TEXT | NO | `'0'` | Cumulative donated amount in stroops (stored as TEXT to avoid JS integer overflow) |
| `donation_count` | INTEGER | NO | `0` | Number of donations received |
| `updated_at` | DATETIME | YES | CURRENT_TIMESTAMP | Last aggregation time |

---

### `donation_totals_global`

Single-row global aggregate (enforced via `CHECK (id = 1)`).

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | PK — must be `1` | Singleton row identifier |
| `total_stroops` | TEXT | NO | `'0'` | Platform-wide cumulative donated stroops |
| `donation_count` | INTEGER | NO | `0` | Platform-wide total donation count |
| `updated_at` | DATETIME | YES | CURRENT_TIMESTAMP | Last aggregation time |

---

### `api_key_usage`

Per-request usage records for analytics and per-key rate limiting.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `api_key` | TEXT | NO | — | Raw key prefix (not a FK — for performance) |
| `timestamp` | INTEGER | NO | — | Unix ms request timestamp |
| `latency_ms` | INTEGER | NO | — | End-to-end request latency in milliseconds |
| `status_code` | INTEGER | NO | — | HTTP response status code |
| `path` | TEXT | NO | `'/'` | Request path |
| `method` | TEXT | NO | `'GET'` | HTTP method |

**Indexes:** on `(api_key)`, on `(api_key, timestamp)`.

---

### `anomaly_history`

Raw request events used by the anomaly detection service to compute baselines.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `key_id` | TEXT | NO | — | API key identifier |
| `ip` | TEXT | YES | NULL | Client IP address |
| `country` | TEXT | YES | NULL | ISO country code (if geo-lookup is enabled) |
| `hour` | INTEGER | YES | NULL | Hour-of-day (0–23) for pattern analysis |
| `request_timestamp` | INTEGER | NO | — | Unix ms |
| `endpoint` | TEXT | YES | NULL | API endpoint path |
| `created_at` | INTEGER | NO | — | Unix ms row insertion time |

**Indexes:** on `(key_id)`, on `(request_timestamp)`.

---

### `anomaly_records`

Detected anomaly events for alerting and audit.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `key_id` | TEXT | NO | — | API key that triggered the anomaly |
| `type` | TEXT | NO | — | Anomaly type (e.g. `UNUSUAL_VOLUME`, `NEW_COUNTRY`) |
| `detail` | TEXT | YES | NULL | Human-readable description |
| `timestamp` | INTEGER | NO | — | Unix ms when anomaly was detected |
| `created_at` | INTEGER | NO | — | Unix ms row insertion time |

**Indexes:** on `(key_id)`, on `(timestamp)`.

---

### `recovery_guardians`

Social-recovery guardians associated with a wallet.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `walletId` | INTEGER | NO | — | FK → `users.id` |
| `guardianPublicKey` | TEXT | NO | — | Guardian's Stellar public key |
| `threshold` | INTEGER | YES | NULL | Minimum approvals required (overrides request threshold if set) |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Registration time |

**Constraints:** UNIQUE on `(walletId, guardianPublicKey)`.

---

### `recovery_requests`

Pending requests to replace a wallet's public key via social recovery.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `walletId` | INTEGER | NO | — | FK → `users.id` |
| `newPublicKey` | TEXT | NO | — | Replacement Stellar public key |
| `status` | TEXT | NO | `'pending'` | `pending` \| `approved` \| `rejected` \| `executed` |
| `threshold` | INTEGER | NO | — | Number of guardian approvals required |
| `executeAfter` | DATETIME | NO | — | Earliest time the recovery may be executed (time-lock) |
| `createdAt` | DATETIME | YES | CURRENT_TIMESTAMP | Request creation time |
| `executedAt` | DATETIME | YES | NULL | When the recovery was executed |

---

### `recovery_approvals`

Guardian approval records for an active recovery request.

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | INTEGER | NO | AUTOINCREMENT PK | Internal surrogate key |
| `recoveryRequestId` | INTEGER | NO | — | FK → `recovery_requests.id` |
| `guardianPublicKey` | TEXT | NO | — | Approving guardian's Stellar public key |
| `approvedAt` | DATETIME | YES | CURRENT_TIMESTAMP | Approval timestamp |

**Constraints:** UNIQUE on `(recoveryRequestId, guardianPublicKey)`.

---

### `student_fees` / `fee_payments`

Legacy fee-installment tables from early development. Kept for schema compatibility.

**`student_fees`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Surrogate key |
| `studentId` | TEXT | Student identifier |
| `description` | TEXT | Fee description |
| `totalAmount` | REAL | Total amount due |
| `paidAmount` | REAL | Amount paid so far |
| `createdAt` / `updatedAt` | DATETIME | Timestamps |
| `deleted_at` | DATETIME | Soft-delete |
| `tenant_id` | TEXT | Multi-tenancy |

**`fee_payments`**

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Surrogate key |
| `feeId` | INTEGER | FK → `student_fees.id` |
| `amount` | REAL | Payment amount |
| `note` | TEXT | Optional note |
| `paidAt` | DATETIME | Payment timestamp |
| `deleted_at` | DATETIME | Soft-delete |
| `tenant_id` | TEXT | Multi-tenancy |
