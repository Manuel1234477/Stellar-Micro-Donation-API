# Graceful Shutdown

On `SIGTERM` (or `SIGINT`), the server performs an ordered shutdown to avoid leaving transactions in an inconsistent state.

## Shutdown Sequence

1. Set `isShuttingDown = true` — new requests receive `503 Service Unavailable`
2. Call `server.close()` — stop accepting new TCP connections
3. Wait for all in-flight requests to complete (polling every 500ms)
4. Flush pending webhook deliveries (`WebhookService.flushPending()`)
5. Stop the `RecurringDonationScheduler` and wait for any running job (`stopGracefully()`)
6. Stop all other background services (reconciliation, audit log retention, transaction sync, expiry worker, quota reset)
7. Shut down `NetworkStatusService`
8. Close the database connection pool
9. `process.exit(0)`

If the total shutdown time exceeds `SHUTDOWN_TIMEOUT_MS`, a forced exit is triggered with a warning log showing the count of abandoned in-flight requests.

## Configuration

| Env Var | Default | Description |
|---|---|---|
| `SHUTDOWN_TIMEOUT_MS` | `30000` | Max ms to wait before forced exit |

## Logging

Each step emits a structured log entry at `INFO` level:

```
[SHUTDOWN] HTTP server closed to new connections
[SHUTDOWN] Waiting for 3 in-flight requests to complete...
[SHUTDOWN] All in-flight requests completed.
[SHUTDOWN] Webhooks flushed
[SHUTDOWN] Scheduler stopped
[SHUTDOWN] Database pool closed
[SHUTDOWN] Graceful shutdown complete.
```

On forced exit:
```
[SHUTDOWN] Forced shutdown after 30000ms timeout { abandonedRequests: 2 }
```

## RecurringDonationScheduler.stopGracefully(timeoutMs)

Clears the polling interval, then waits up to `timeoutMs` (default 10s) for `executingSchedules` to drain before returning.
