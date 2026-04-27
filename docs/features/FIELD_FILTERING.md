# API Response Field Filtering

Clients can request only the fields they need using the `?fields` query parameter. This reduces payload size and improves performance for bandwidth-constrained clients.

## Usage

Append `?fields=<comma-separated paths>` to any list or detail endpoint.

```
GET /donations?fields=id,amount,status
GET /wallets?fields=id,address,balance
GET /donations/123?fields=id,amount,donor.name
```

## Dot Notation (Nested Fields)

Use `.` to select nested fields:

```
GET /donations?fields=id,donor.name,wallet.address
```

Response:
```json
{
  "success": true,
  "data": {
    "id": "abc123",
    "donor": { "name": "Alice" },
    "wallet": { "address": "GABC..." }
  }
}
```

## Response Header

When field filtering is active, the response includes:

```
X-Fields-Applied: true
```

## Error Handling

Invalid field paths return **HTTP 400**:

```json
{
  "success": false,
  "error": {
    "code": "INVALID_FIELD_PATH",
    "message": "Invalid field path: \"bad field!\". Field paths must contain only alphanumeric characters, underscores, and dots."
  }
}
```

Invalid paths include:
- Paths with spaces or special characters (e.g. `bad field!`, `id;drop`)
- Empty segments (e.g. `id..amount`)

## Security Assumptions

- **No path injection.** Each segment is validated against `/^[a-zA-Z0-9_]+$/`. Special characters, SQL fragments, and shell metacharacters are rejected with 400.
- **Blocked fields.** Sensitive fields (`password`, `secret`, `privateKey`, `secretKey`) are permanently blocked and return 400 if requested.
- **No silent ignoring.** Invalid paths always return 400 — they are never silently dropped.
- **Envelope preserved.** Top-level envelope fields (`success`, `count`, `meta`) are always included. Only the `data` payload is filtered.
