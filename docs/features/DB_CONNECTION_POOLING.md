# DB Connection Pooling

## Overview

The database layer uses a connection pool with configurable min/max connections, periodic health monitoring, and automatic reconnection with exponential backoff.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DB_POOL_MIN` | `1` | Minimum connections kept alive |
| `DB_POOL_MAX` | `10` | Maximum connections allowed |
| `DB_POOL_SIZE` | `5` | Initial pool size (capped at `DB_POOL_MAX`) |
| `DB_ACQUIRE_TIMEOUT` | `5000` | Max ms to wait for a connection |

## Health Monitoring

A background ping runs every **30 seconds** (`SELECT 1`). On failure the pool attempts to reconnect with exponential backoff (base 500 ms, max 30 s, up to 10 attempts).

## Pool Exhaustion Event

When all connections are in use and waiters are queued, the `database.degraded` event is emitted on the `Database` class:

```js
const Database = require('./src/utils/database');
Database.on('database.degraded', ({ waiting, active, total }) => {
  // alert / scale-up logic
});
```

## API Endpoint

### `GET /admin/db/pool-status`

Returns a snapshot of the current pool state. Requires admin API key.

**Response**
```json
{
  "success": true,
  "data": {
    "poolSize": 5,
    "poolMin": 1,
    "poolMax": 10,
    "active": 2,
    "idle": 3,
    "waiting": 0,
    "healthy": true
  }
}
```
