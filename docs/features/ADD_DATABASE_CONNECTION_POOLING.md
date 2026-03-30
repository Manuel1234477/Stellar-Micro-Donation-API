# Add Database Connection Pooling

## Summary

This change replaces the previous per-query SQLite open/close pattern in `src/utils/database.js` with a reusable in-process connection pool. The public query helpers stay the same for callers, but the database layer now reuses a fixed number of SQLite connections, queues requests fairly when the pool is saturated, and exposes safe pool metrics through the health check endpoint.

## Why This Change Matters

Opening and closing a SQLite connection for every query adds avoidable overhead and increases contention under concurrent load. Reusing a small set of connections reduces repeated setup cost, limits concurrency to a predictable level, and lowers the chance of `SQLITE_BUSY` errors caused by unnecessary connection churn.

## How The Pool Works

- The pool lives entirely inside `src/utils/database.js`.
- Connections are created lazily and reused across calls to `query`, `run`, `get`, and `all`.
- The pool has a fixed maximum size controlled by `DB_POOL_SIZE`.
- When all connections are busy, new requests wait in a FIFO queue instead of creating unlimited fallback connections.
- When a connection is released, the oldest queued request receives it first.
- If a queued request waits longer than `DB_ACQUIRE_TIMEOUT`, it fails with a clear, non-sensitive error message and is removed from the queue.
- The release path is exception-safe so connections are returned after both successful and failed queries.

## Environment Variables

### `DB_POOL_SIZE`

- Type: positive integer
- Default: `5`
- Purpose: sets the maximum number of reusable SQLite connections

### `DB_ACQUIRE_TIMEOUT`

- Type: positive integer, milliseconds
- Default: `10000`
- Purpose: limits how long a queued request waits for an available pooled connection

Invalid values are rejected clearly during pool initialization.

## Queueing Behavior

- Requests beyond pool capacity are queued instead of opening more connections.
- Queue order is FIFO for fairness.
- Queue length is visible through health metrics.

## Timeout Behavior

- A queued acquisition request waits up to `DB_ACQUIRE_TIMEOUT`.
- On timeout, the request fails safely with `Timed out waiting for an available database connection`.
- Timed-out waiters are removed from the queue so they do not leak memory or block later requests.

## Health Check Metrics

`GET /health` now includes database pool metrics under the database dependency entry:

```json
{
  "dependencies": {
    "database": {
      "status": "healthy",
      "responseTime": 4,
      "pool": {
        "active": 1,
        "idle": 4,
        "waiting": 0,
        "total": 5,
        "size": 5,
        "acquireTimeout": 10000
      }
    }
  }
}
```

The exposed metrics are operational only and do not reveal secrets.

## Security And Operational Notes

- Environment variables are parsed and validated before use.
- Timeout errors do not expose internal file paths.
- The pool size is bounded, so the process cannot create unbounded SQLite connections.
- Waiters are removed on timeout and on shutdown to avoid queue leaks.
- A clean `Database.close()` path now drains the pool and supports graceful shutdown.

## Testing Notes

Focused coverage lives in `tests/add-database-connection-pooling.test.js` and covers:

- default and custom pool configuration
- invalid environment variable handling
- connection reuse
- concurrent access behavior
- queueing behavior
- acquisition timeout behavior
- release safety after failures
- health endpoint metrics
- shutdown and reinitialization

The tests use the local SQLite test database and the existing mock Stellar configuration. No live Stellar network access is required.

## SQLite-Specific Limitations

- This is an in-process pool of reusable SQLite connection objects, not a client/server pool.
- SQLite still serializes writes at the file level, so connection pooling reduces churn and bounds concurrency but does not turn SQLite into a fully parallel write database.
- For high sustained write concurrency, operational tuning may still require WAL mode and workload-specific review outside this focused change.
