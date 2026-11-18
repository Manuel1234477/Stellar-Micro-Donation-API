# API Reference

Base URL: `http://localhost:3000/api/v1`

All requests require `X-API-Key` header. See [Authentication Guide](./authentication.md).

---

## Pagination

List endpoints support **cursor-based pagination** for efficient data retrieval and consistency.

### Query Parameters

| Parameter | Type | Default | Max | Description |
|-----------|------|---------|-----|-------------|
| `limit` | integer | 20 | 100 | Number of records per page |
| `cursor` | string | null | N/A | Opaque cursor for pagination position (from `next_cursor` or `prev_cursor`) |
| `direction` | string | `next` | N/A | Pagination direction: `next` or `prev` |
| `snapshotAt` | string | null | N/A | **Optional:** ISO-8601 timestamp for consistent snapshot pagination (see below) |

### Response Metadata

All paginated endpoints return:

```json
{
  "success": true,
  "data": [ /* records */ ],
  "pagination": {
    "next_cursor": "eyJ0aW1lc3RhbXAiOiIyMDI2LTAz...",
    "prev_cursor": null,
    "limit": 20,
    "direction": "next",
    "snapshotAt": "2026-03-26T05:00:00.000Z"
  }
}
```

### Known Limitation: Concurrent Inserts

Cursor pagination assumes the underlying dataset is immutable between requests. **With concurrent inserts:**

- Records inserted before the cursor position may be permanently missed
- Records inserted after the cursor position may appear unexpectedly on the next page

**This primarily affects batch processing and reconciliation use cases.**

### Solution: Snapshot-Based Pagination

Use the optional `snapshotAt` parameter to paginate a consistent snapshot. Records with `timestamp < snapshotAt` are guaranteed to appear exactly once across all pages.

#### Example: Batch Processing

```bash
# Start pagination session with snapshot
GET /api/v1/donations?limit=50&snapshotAt=2026-03-26T05:00:00Z

# All subsequent requests use the same snapshotAt
GET /api/v1/donations?limit=50&cursor=<next_cursor>&snapshotAt=2026-03-26T05:00:00Z

# To process new records, start a new session with current timestamp
GET /api/v1/donations?limit=50&snapshotAt=2026-03-26T05:30:00Z
```

**For more details, see [Cursor Pagination Stability](./PAGINATION_CURSOR_STABILITY.md).**

---

---

## Donations

### POST /donations
Create a new donation.

**Headers:** `X-API-Key`, `Content-Type: application/json`, `Idempotency-Key` (optional)

**Body:**
```json
{
  "senderPublicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "recipientPublicKey": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  "amount": "10.00",
  "memo": "optional note"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "transactionHash": "abc123...",
    "status": "completed",
    "amount": "10.00",
    "memo": "optional note",
    "createdAt": "2026-03-26T05:00:00.000Z"
  }
}
```

---

### GET /donations
List all donations (paginated).

**Query params:** 
- `limit` (1–100, default 20)
- `cursor` (opaque pagination cursor)
- `direction` (`next` or `prev`)
- `snapshotAt` (optional ISO-8601 timestamp for consistent pagination)
- `status` (filter by status)

**Response 200:**
```json
{
  "success": true,
  "data": [ { "id": 1, "amount": "10.00", "status": "completed", "createdAt": "2026-03-26T05:00:00Z", ... } ],
  "pagination": { 
    "next_cursor": "...", 
    "prev_cursor": null,
    "limit": 20,
    "direction": "next",
    "snapshotAt": "2026-03-26T05:00:00Z"
  }
}
```

---

### GET /donations/recent
Get recent donations.

**Query params:** `limit` (default 10, max 100)

---

### GET /donations/:id
Get a specific donation by ID.

**Response 404** if not found:
```json
{ "success": false, "error": "Donation not found" }
```

---

### GET /donations/limits
Get configured donation amount limits.

**Response 200:**
```json
{ "success": true, "data": { "min": "0.0001", "max": "10000" } }
```

---

### POST /donations/verify
Verify a donation transaction on the blockchain.

**Body:**
```json
{ "transactionHash": "abc123..." }
```

---

### PATCH /donations/:id/status
Update donation status (admin only).

**Body:**
```json
{ "status": "completed" }
```

Valid statuses: `pending`, `completed`, `failed`, `cancelled`

---

## Wallets

### POST /wallets
Register a wallet.

**Body:**
```json
{
  "publicKey": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "label": "My Wallet"
}
```

---

### GET /wallets
List all wallets.

---

### GET /wallets/:id
Get wallet by ID.

---

### GET /wallets/:publicKey/transactions
Get all transactions for a wallet address.

---

### PATCH /wallets/:id
Update wallet label or metadata.

---

## Recurring Donations (Stream)

### POST /stream/create
Create a recurring donation schedule.

**Body:**
```json
{
  "senderPublicKey": "GAAZI...",
  "recipientPublicKey": "GBRPY...",
  "amount": "5.00",
  "frequency": "weekly"
}
```

Valid frequencies: `daily`, `weekly`, `monthly`

---

### GET /stream/schedules
List all recurring schedules.

---

### GET /stream/schedules/:id
Get a specific schedule.

---

### DELETE /stream/schedules/:id
Cancel a recurring schedule.

---

## Statistics

### GET /stats/daily
Daily donation volume. **Query:** `startDate`, `endDate` (ISO 8601)

### GET /stats/weekly
Weekly donation volume.

### GET /stats/summary
Overall summary: total donations, total volume, unique donors/recipients.

### GET /stats/donors
Stats grouped by donor wallet.

### GET /stats/recipients
Stats grouped by recipient wallet.

### GET /stats/analytics-fees
Fee analytics summary.

### GET /stats/wallet/:walletAddress/analytics
Analytics for a specific wallet address.

---

## Transactions

### GET /transactions
Paginated transaction list. **Query:** `limit`, `cursor`, `walletAddress`

### POST /transactions/sync
Sync transactions from Stellar network for a wallet.

**Body:**
```json
{ "publicKey": "GAAZI..." }
```

---

## Admin / Inspection (Admin Only)

### POST /admin/inspect/xdr
Decode and inspect an arbitrary Stellar XDR envelope. Returns the decoded transaction details without storing them.

**Headers:** `X-API-Key` (Admin), `Content-Type: application/json`

**Body:**
```json
{ "xdr": "AAAAAgAAAAD..." }
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "hash": "abc123...",
    "source": "GAAZI...",
    "fee": "100",
    "sequence": "123456",
    "operations": [ ... ],
    "memo": { "type": "none" },
    "signatures": [ ... ]
  }
}
```

---

### GET /admin/inspect/xdr/:id
Inspect the XDR envelope of a stored transaction by its ID.

**Headers:** `X-API-Key` (Admin)

**Response 200:**
Returns the same decoded structure as `POST /admin/inspect/xdr`.

---

### POST /admin/inspect/xdr/decode
Fully decode an XDR envelope: operations with type-specific fields, signatures,
and fee-bump envelopes (`type: "feeBump"` with `innerTransaction`).

**Headers:** `X-API-Key` (Admin)

**Body:** `{ "xdr": "<base64>", "network": "testnet" | "public" }`

> `POST /admin/transactions/decode-xdr` is a deprecated alias of this endpoint
> (sunset 1 Jan 2027).

---

### Consolidated admin routes and deprecated paths (#1778)

Each feature now has one route module. Deprecated paths answer exactly as before
for one release and add `Deprecation: true`, `Sunset: Sat, 01 Jan 2027 00:00:00 GMT`
and `Link: <successor>; rel="successor-version"` headers.

| Feature | Module | Canonical paths | Deprecated paths → successor |
|---|---|---|---|
| Wallet limits | `routes/admin/walletLimits.js` | `/admin/wallets/:id/limits` | — (`walletDonationLimits.js` was shadowed by this router and never reachable; removed) |
| XDR inspection | `routes/admin/inspect.js` | `/admin/inspect/xdr`, `/admin/inspect/xdr/decode`, `/admin/inspect/xdr/:id` | `POST /admin/transactions/decode-xdr` → `POST /admin/inspect/xdr/decode` |
| Geo rules | `routes/admin/geoRules.js` | `/admin/geo-rules`, `/:id`, `/test`, `/active`, `/config`, `/reload-db`, `/block/:cc`, `/allow/:cc` | `GET /admin/geo-blocking/rules` → `/admin/geo-rules/active`; `POST /admin/geo-blocking/block\|allow` → `POST /admin/geo-rules`; `DELETE /admin/geo-blocking/block\|allow/:cc` → `/admin/geo-rules/block\|allow/:cc`; `GET\|PUT /admin/geo-blocking` → `/admin/geo-rules/config`; `POST /admin/geo-blocking/reload-db` → `/admin/geo-rules/reload-db` |
| Corporate matching | `routes/corporateMatching.js` | `/api/v1/corporate-matching/*` (members), `/admin/corporate-matching/*`, `/api/v2/corporate-matching/*` | — (paths unchanged) |
| Audit log export | `routes/auditLogExport.js` | `/api/v1/api-keys/:id/audit-log*`, `/admin/audit-logs/export/*` | — (paths unchanged) |
| API key usage | `routes/apiKeyUsage.js` | `/api/v1/api-keys/:id/usage*`, `/api/v1/api-keys/:id/analytics*`, `/admin/api-keys/usage`, `/admin/api-keys/:id/analytics` | — (paths unchanged) |
| Feature flags | `routes/admin/featureFlags.js` | `/admin/feature-flags` (mounted once) | — |

Donation matching programs (`/admin/matching-programs`) are a separate feature
with their own service and tables, so they keep their own module.

---

## Health

### GET /health
Returns API health status. No authentication required.

**Response 200:**
```json
{ "status": "ok" }
```

---

## Error Responses

All errors follow this shape:

```json
{
  "success": false,
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Validation error / bad request |
| 401 | Missing or invalid API key |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 409 | Conflict (e.g. duplicate idempotency key) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

For full request/response examples, see [API Examples](./API_EXAMPLES.md).
