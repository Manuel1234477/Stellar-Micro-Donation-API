# Add Cursor Pagination To All List Endpoints

## Summary

This change adds reusable, cursor-based pagination to the following list endpoints:

- `GET /donations`
- `GET /wallets`
- `GET /admin/audit-logs`

The implementation uses deterministic ordering based on a timestamp field plus a unique `id`, returns opaque cursors, and preserves existing authentication and authorization behavior.

## Endpoints Affected

### `GET /donations`

Returns donations ordered by `timestamp DESC, id DESC`.

### `GET /wallets`

Returns wallets ordered by `createdAt DESC, id DESC`.

### `GET /admin/audit-logs`

Returns audit logs ordered by `timestamp DESC, id DESC`.

This endpoint remains protected by admin authorization.

## Query Parameters

All three endpoints support the same pagination parameters:

- `cursor`
  - Optional opaque cursor returned by a previous paginated response
- `limit`
  - Optional integer
  - Default: `20`
  - Maximum: `100`
- `direction`
  - Optional string
  - Allowed values: `next`, `prev`
  - Default: `next`

`GET /admin/audit-logs` also continues to support its existing filters:

- `category`
- `action`
- `severity`
- `userId`
- `requestId`
- `startDate`
- `endDate`

## Response Format

The existing response shape is preserved and pagination metadata is added under `meta`:

```json
{
  "success": true,
  "data": [],
  "count": 0,
  "meta": {
    "limit": 20,
    "direction": "next",
    "next_cursor": null,
    "prev_cursor": null
  }
}
```

## Cursor Behavior

- `next_cursor`
  - Use this to request the next page of older records
- `prev_cursor`
  - Use this to request the previous page of newer records
- Cursors are opaque base64url-encoded payloads
- Clients should treat cursors as tokens and should not construct them manually

## Headers

Each paginated endpoint now returns:

- `X-Total-Count`
  - Total number of records matching the endpoint query before pagination is applied

Examples:

- `GET /donations` with 57 matching records returns `X-Total-Count: 57`
- `GET /admin/audit-logs?severity=HIGH` returns the total count for only `HIGH` audit logs

## Example Requests

```bash
curl -H "x-api-key: test-key" \
  "http://localhost:3000/donations?limit=20"
```

```bash
curl -H "x-api-key: test-key" \
  "http://localhost:3000/wallets?limit=10&cursor=eyJ0aW1lc3RhbXAiOiIyMDI2LTAxLTAxVDAwOjEwOjAwLjAwMFoiLCJpZCI6IjEwIn0&direction=next"
```

```bash
curl -H "x-api-key: admin-test-key" \
  "http://localhost:3000/admin/audit-logs?severity=HIGH&limit=25"
```

## Example Responses

First page:

```json
{
  "success": true,
  "data": [
    {
      "id": "25"
    }
  ],
  "count": 1,
  "meta": {
    "limit": 20,
    "direction": "next",
    "next_cursor": "opaque-next-cursor",
    "prev_cursor": null
  }
}
```

Middle page:

```json
{
  "success": true,
  "data": [
    {
      "id": "10"
    }
  ],
  "count": 1,
  "meta": {
    "limit": 20,
    "direction": "next",
    "next_cursor": "opaque-next-cursor",
    "prev_cursor": "opaque-prev-cursor"
  }
}
```

Last page:

```json
{
  "success": true,
  "data": [
    {
      "id": "1"
    }
  ],
  "count": 1,
  "meta": {
    "limit": 20,
    "direction": "next",
    "next_cursor": null,
    "prev_cursor": "opaque-prev-cursor"
  }
}
```

## Validation Errors

Requests fail safely with a `4xx` validation error when:

- `limit` is not an integer
- `limit < 1`
- `limit > 100`
- `direction` is not `next` or `prev`
- `cursor` is malformed
- `cursor` is validly encoded but does not belong to the current filtered result set

## Security Considerations

- Sort fields are fixed server-side and cannot be controlled by the client
- SQL queries use parameter binding for all client-supplied values
- Malformed cursors are handled as validation errors and do not crash the server
- Cursor metadata exposes only opaque pagination tokens, not raw SQL details
- Admin-only protection on `GET /admin/audit-logs` is unchanged

## Efficiency Notes

- Cursor queries fetch only the requested page size plus one extra record to determine whether another page exists
- `X-Total-Count` is computed with a dedicated count query scoped to the same filters
- In-memory list endpoints reuse a shared pagination utility to keep behavior consistent and reviewable

## Testing Notes

Coverage for this change is provided by:

- `tests/add-pagination-to-all-list-endpoints.test.js`

The test suite covers:

- success cases
- validation failures
- first, middle, and last pages
- forward and backward navigation
- malformed and unknown cursors
- invalid limits and directions
- `X-Total-Count`
- empty datasets
- admin protection for audit logs

Tests run against local JSON/SQLite fixtures and do not require a live Stellar network.
