# Add Database Query Performance Monitoring

## Summary

This change adds centralized database query performance monitoring to the SQLite data-access layer. Every `Database` query method now records execution time, logs slow queries that exceed `SLOW_QUERY_THRESHOLD_MS`, keeps the last 1000 slow-query entries in memory, exposes an admin-only inspection endpoint, and includes aggregate query metrics in the health check response.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `SLOW_QUERY_THRESHOLD_MS` | `100` | Logs and stores queries whose execution time is greater than this threshold. Accepts non-negative integers. |

## What Changed

### Database timing

The following `Database` methods are timed automatically through the shared execution path in `src/utils/database.js`:

- `Database.query(sql, params)`
- `Database.get(sql, params)`
- `Database.all(sql, params)`
- `Database.run(sql, params)`

Each query records:

- SQL statement text
- Database method used
- Duration in milliseconds
- Timestamp
- Failure and timeout flags for slow failures

### Slow-query retention

Slow queries are stored in memory only.

- Retention window: last 24 hours
- Capacity: last 1000 slow-query entries
- Ordering: slowest first when queried

This keeps the feature lightweight and avoids adding a new persistence dependency just for observability.

### Admin endpoint

#### `GET /admin/db/slow-queries`

Returns the slowest queries captured during the last 24 hours.

Authentication and authorization:

- Requires an authenticated API key
- Requires `admin` access (`*` permission)

Optional query parameters:

- `limit`: positive integer to cap the number of returned rows

Example response:

```json
{
  "success": true,
  "data": {
    "thresholdMs": 100,
    "averageQueryTimeMs": 4.123,
    "recentQueryCount": 37,
    "slowQueryCount": 2,
    "queries": [
      {
        "sql": "SELECT * FROM transactions WHERE id = ?",
        "method": "get",
        "durationMs": 142.551,
        "timestamp": 1774430000000,
        "isoTimestamp": "2026-03-25T10:30:00.000Z",
        "failed": false,
        "timedOut": false
      }
    ]
  }
}
```

## Health Check Metrics

`GET /health` now includes database performance metrics under `dependencies.database.performance`:

- `thresholdMs`
- `totalQueries`
- `averageQueryTimeMs`
- `slowQueryCount`
- `recentQueryCount`

The average is computed from the last 24 hours of recorded query durations.

## Logging

Queries slower than `SLOW_QUERY_THRESHOLD_MS` are logged with:

- SQL text
- Query duration
- Configured threshold
- Database method
- Failure and timeout state

## Security Assumptions

- Slow-query details are exposed only through an admin-only endpoint.
- The endpoint returns SQL text but not query parameter values, which reduces accidental disclosure of sensitive request data.
- The slow-query log is in-memory only, so it is cleared on process restart and does not create a new long-lived sensitive datastore.
- Validation rejects invalid `limit` values to avoid unbounded or malformed requests.

## Testing

Primary test file:

```bash
npm test tests/add-database-query-performance-monitoring.test.js
```

Coverage in this test includes:

- timing applied to all `Database` query methods
- slow-query detection and logging
- in-memory retention capped at 1000 entries
- 24-hour filtering and slowest-first sorting
- admin authorization checks
- invalid query parameter handling
- health-check metric exposure
