# DB Query Monitoring

Every database query is automatically timed. Queries that exceed a configurable threshold are logged with full context and stored in a circular in-memory buffer. Two admin endpoints expose this data for operational visibility.

## How It Works

The `Database` class wraps every call to `query`, `get`, `all`, and `run` through a single `execute` method. After each query completes (or times out), `recordQueryExecution` is called with:

- `method` — `all`, `get`, or `run`
- `sql` — the SQL statement
- `params` — the bound parameters
- `durationMs` — wall-clock time in milliseconds (sub-ms precision via `process.hrtime.bigint`)
- `failed` / `timedOut` — error flags

All queries contribute to the rolling duration window used for percentile calculations. Only queries that exceed the threshold are written to the slow-query buffer.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `SLOW_QUERY_THRESHOLD_MS` | `100` | Queries strictly above this value (ms) are logged and buffered. Set to `0` to capture every query. Must be a non-negative integer. |
| `SLOW_QUERY_BUFFER_SIZE` | `100` | Maximum number of slow-query entries kept in memory. Oldest entries are evicted when the buffer is full (circular). Must be a positive integer. |

Add these to your `.env` file:

```env
SLOW_QUERY_THRESHOLD_MS=500
SLOW_QUERY_BUFFER_SIZE=200
```

## Admin Endpoints

Both endpoints require an admin API key (`role: admin`).

### GET /admin/db/slow-queries

Returns the buffered slow queries from the last 24 hours, sorted by duration descending.

**Query parameters**

| Parameter | Type | Description |
|---|---|---|
| `limit` | positive integer | Cap the number of returned entries. |

**Response**

```json
{
  "success": true,
  "data": {
    "thresholdMs": 500,
    "averageQueryTimeMs": 12.4,
    "recentQueryCount": 840,
    "slowQueryCount": 3,
    "queries": [
      {
        "sql": "SELECT * FROM transactions WHERE senderId = ?",
        "params": [42],
        "method": "all",
        "durationMs": 812.5,
        "timestamp": 1711656265000,
        "isoTimestamp": "2026-03-28T20:44:25.000Z",
        "failed": false,
        "timedOut": false
      }
    ]
  }
}
```

### GET /admin/db/query-stats

Returns aggregate statistics over all queries recorded in the current 24-hour window.

**Response**

```json
{
  "success": true,
  "data": {
    "totalQueries": 1240,
    "averageDurationMs": 8.3,
    "p95Ms": 45,
    "p99Ms": 210,
    "slowQueryCount": 3,
    "thresholdMs": 500
  }
}
```

| Field | Description |
|---|---|
| `totalQueries` | Cumulative count since last reset / startup. |
| `averageDurationMs` | Mean duration of queries in the 24-hour window. |
| `p95Ms` | 95th-percentile duration in the 24-hour window. |
| `p99Ms` | 99th-percentile duration in the 24-hour window. |
| `slowQueryCount` | Number of entries currently in the slow-query buffer. |
| `thresholdMs` | Active threshold value. |

## Overhead

Timing uses `process.hrtime.bigint()` — a single syscall with nanosecond resolution and negligible overhead. The buffer operations are O(1) amortised (array push + conditional splice). No I/O is performed per query.

## Pruning

Entries older than 24 hours are pruned lazily on every read (`getSlowQueries`, `getQueryStats`, `getPerformanceMetrics`). No background timer is required.
