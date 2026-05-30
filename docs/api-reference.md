# API Reference

Base URL: `http://localhost:3000/api/v1`

All requests require `X-API-Key` header. See [Authentication Guide](./authentication.md).

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

**Query params:** `limit` (default 20), `cursor`, `status`

**Response 200:**
```json
{
  "success": true,
  "data": [ { "id": 1, "amount": "10.00", "status": "completed", ... } ],
  "pagination": { "nextCursor": "...", "hasMore": false }
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
