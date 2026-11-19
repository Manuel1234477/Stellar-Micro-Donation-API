# Cursor-Based Pagination Guide

## Overview

The Stellar Micro-Donation API uses cursor-based pagination for efficient, consistent list operations. Cursor-based pagination is superior to offset-based pagination for large datasets and concurrent operations.

## Advantages Over Offset Pagination

- **Performance**: No need to skip N rows; direct index lookup via `WHERE id > :cursor`
- **Consistency**: Immune to inserts/deletes between page requests; results never shift
- **Scalability**: Constant query time regardless of page number
- **Cursor Stability**: Opaque, base64-encoded cursors are forward-compatible

## Supported Endpoints

The following list endpoints support cursor-based pagination:

- `GET /donations` — List all donations
- `GET /wallets` — List all wallets
- `GET /campaigns` — List all campaigns
- `GET /stream/schedules` — List payment streams
- `GET /webhooks` — List webhooks
- `GET /wallets/{id}/balance-history` — Wallet balance history

## Query Parameters

### Basic Pagination

```
GET /donations?limit=20
```

**Parameters:**
- `limit` (optional, default: 20, max: 100) — Number of results per page
- `cursor` (optional) — Opaque base64-encoded cursor from a previous response
- `direction` (optional, default: "next") — Pagination direction ("next" or "prev")

### Snapshot Mode (Point-in-Time Consistency)

```
GET /donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20
```

Use `snapshotAt` to get consistent pagination across inserts:
- `snapshotAt` (optional) — ISO-8601 timestamp restricting results to records created before this moment
  - Include `snapshotAt` on **every subsequent request** when paginating a fixed snapshot
  - Results are "frozen" at the snapshot moment, preventing duplicates/skips even if records are inserted

## Example: Basic Pagination

Request the first page:

```bash
curl "https://api.example.com/donations?limit=20"
```

Response:

```json
{
  "success": true,
  "count": 20,
  "data": [
    { "id": "d123", "amount": 100, "status": "confirmed", "createdAt": "2026-05-30T12:00:00.000Z" },
    ...
  ],
  "pagination": {
    "limit": 20,
    "direction": "next",
    "nextCursor": "eyJ0aW1lc3RhbXAiOiIyMDI2LTA1LTMwVDEyOjAwOjAwLjAwMFoiLCJpZCI6ImQxMjMifQ==",
    "prevCursor": null
  }
}
```

Request the next page using `nextCursor`:

```bash
curl "https://api.example.com/donations?limit=20&cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTA1LTMwVDEyOjAwOjAwLjAwMFoiLCJpZCI6ImQxMjMifQ=="
```

Continue until `nextCursor` is `null` (no more pages).

## Example: Snapshot Mode (Consistent Pagination)

Capture a snapshot moment and paginate consistently:

```bash
# First request: capture snapshot
curl "https://api.example.com/donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20"

# All subsequent requests: repeat snapshotAt
curl "https://api.example.com/donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20&cursor=..."
curl "https://api.example.com/donations?snapshotAt=2026-05-30T12:00:00.000Z&limit=20&cursor=..."
```

Even if new donations are inserted while you paginate, the snapshot guarantees you'll never see the same record twice and never skip a record.

## Pagination Response Format

All paginated list endpoints return:

```json
{
  "success": true,
  "count": 20,
  "data": [ /* list of items */ ],
  "pagination": {
    "limit": 20,
    "direction": "next",
    "nextCursor": "eyJ...",   // null if last page
    "prevCursor": "eyJ...",    // null if first page
    "snapshotAt": "2026-05-30T12:00:00.000Z"  // only if provided
  }
}
```

**Pagination Metadata:**
- `limit` — Items per page (reflected from request)
- `direction` — Direction of pagination ("next" or "prev")
- `nextCursor` — Opaque cursor for the next page, or `null` if at end
- `prevCursor` — Opaque cursor for the previous page, or `null` if at beginning
- `snapshotAt` — Snapshot timestamp (only present if provided in request)

## Cursor Structure (Reference)

Cursors are base64url-encoded JSON objects:

```json
{
  "timestamp": "2026-05-30T12:00:00.000Z",
  "id": "d123"
}
```

Cursors are **opaque** — clients should treat them as magic tokens and not parse them. The structure is an implementation detail that may change.

## Backward Compatibility

Offset-based pagination (`offset`, `page` parameters) is **deprecated** but still supported on select endpoints for backward compatibility. New code should use cursor-based pagination.

**Note:** Offset pagination should not be used for large datasets or where consistency is required, as it:
- Has O(n) query time (must skip N rows)
- Produces inconsistent results if records are inserted/deleted between requests

## Best Practices

1. **Always use cursors** — Don't maintain your own offset counter
2. **Use snapshotAt for consistency** — If you need to process all records exactly once, use snapshot mode
3. **Handle null cursors** — Stop pagination when `nextCursor` is `null`
4. **Don't parse cursors** — Treat them as opaque strings; their structure is not part of the API contract
5. **Respect max limits** — If you request `limit=200`, it will be clamped to 100; check the response to see the actual limit
6. **Check response metadata** — Always inspect `pagination` in the response to understand available cursors

## Error Handling

### Invalid Cursor

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid cursor parameter"
  }
}
```

Fix by starting a new request without a cursor (first page).

### Invalid snapshotAt

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid snapshotAt parameter: must be a valid ISO-8601 timestamp"
  }
}
```

Fix by omitting `snapshotAt` or providing a valid ISO-8601 timestamp (e.g., `2026-05-30T12:00:00.000Z`).

## Performance Notes

- Cursor queries use indexed lookups: `WHERE id > :cursor` with an index on `id`
- Snapshot queries add: `AND createdAt <= :snapshotAt` (indexed)
- Page size impacts latency linearly; very large limits (e.g., 1000) may timeout
- Pagination is read-only; it does not lock or hold transactions

## Migration Guide (Offset → Cursor)

If you're currently using offset pagination, migrate as follows:

**Before (deprecated):**
```bash
curl "https://api.example.com/donations?offset=0&limit=20"
curl "https://api.example.com/donations?offset=20&limit=20"
```

**After (recommended):**
```bash
curl "https://api.example.com/donations?limit=20"
# Use nextCursor from response
curl "https://api.example.com/donations?limit=20&cursor=eyJ..."
```

No changes to application logic are needed; simply use the cursors from the response instead of calculating offsets.
