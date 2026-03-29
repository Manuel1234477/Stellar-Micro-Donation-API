# Network Status Monitoring

Provides real-time Horizon health tracking, degradation detection, and a public status API.

---

## Overview

`NetworkStatusService` polls the Stellar Horizon `/fee_stats` endpoint every 30 seconds. Each poll produces a status snapshot that is stored in a rolling 24-hour history. When the network transitions from healthy to degraded, a `network.degraded` event is emitted.

---

## Degradation Thresholds

| Metric | Threshold | Notes |
|---|---|---|
| Ledger close time | > 10 s | Computed from ledger sequence delta between polls |
| Fee surge | > 5× baseline | Baseline = 100 stroops (0.00001 XLM) |
| Error rate | > 5% | Percentage of failed Horizon polls |

---

## API Endpoints

### `GET /network/status`

Returns the most recent network health snapshot.

**Response**

```json
{
  "timestamp": "2026-03-29T23:00:00.000Z",
  "connected": true,
  "latencyMs": 142,
  "ledgerCloseTimeS": 5.2,
  "feeStroops": 100,
  "feeLevel": "normal",
  "feeSurgeMultiplier": 1.0,
  "errorRatePercent": 0.0,
  "degraded": false
}
```

| Field | Type | Description |
|---|---|---|
| `connected` | boolean | Whether the last Horizon poll succeeded |
| `latencyMs` | number \| null | Round-trip time of the last poll in milliseconds |
| `ledgerCloseTimeS` | number \| null | Average seconds per ledger close (computed from sequence delta) |
| `feeStroops` | number \| null | Mode fee charged in the last ledger (stroops) |
| `feeLevel` | `"normal"` \| `"elevated"` \| `"surge"` | Human-readable fee tier |
| `feeSurgeMultiplier` | number | Current fee ÷ baseline fee (100 stroops) |
| `errorRatePercent` | number | Percentage of polls that have failed |
| `degraded` | boolean | `true` when any threshold is exceeded |
| `error` | string | Present only when `connected` is `false` |

---

### `GET /network/status/history`

Returns all status snapshots recorded in the last 24 hours.

**Response**

```json
{
  "history": [
    {
      "timestamp": "2026-03-29T22:30:00.000Z",
      "connected": true,
      "latencyMs": 130,
      "ledgerCloseTimeS": 5.1,
      "feeStroops": 100,
      "feeLevel": "normal",
      "feeSurgeMultiplier": 1.0,
      "errorRatePercent": 0.0,
      "degraded": false
    }
  ]
}
```

Snapshots older than 24 hours are automatically pruned from memory.

---

## Webhook Event: `network.degraded`

Emitted by `NetworkStatusService` (an `EventEmitter`) the first time the network transitions from healthy to degraded. It does **not** re-fire on every poll while already degraded — only on each new healthy → degraded transition.

**Listening in `app.js`**

```js
networkStatusService.on('network.degraded', (status) => {
  console.warn('[NetworkStatus] network.degraded:', status);
  // Forward to external webhook, alert system, etc.
});
```

The `status` payload is the full snapshot object (same shape as `GET /network/status`).

---

## Fee Levels

| `feeLevel` | Condition |
|---|---|
| `normal` | surge multiplier ≤ 1× |
| `elevated` | surge multiplier 1×–3× |
| `surge` | surge multiplier > 3× |

Degradation is triggered at > 5× baseline, which always maps to `surge`.

---

## Service Lifecycle

```js
const NetworkStatusService = require('./src/services/NetworkStatusService');

const svc = new NetworkStatusService({
  horizonUrl: 'https://horizon-testnet.stellar.org', // default
  pollIntervalMs: 30_000,                            // default
});

svc.start(); // begins polling immediately, then every 30 s
svc.stop();  // clears the interval
```

`start()` is idempotent — calling it multiple times does not create duplicate timers.

---

## Architecture

```
app.js
 └─ NetworkStatusService (EventEmitter)
     ├─ _fetchHorizon()        → GET /fee_stats on Horizon
     ├─ _parseLedgerCloseTime() → ledger sequence delta
     ├─ _parseFee()             → mode fee in stroops
     ├─ _buildStatus()          → snapshot + degradation flag
     └─ _saveStatus()           → history + emit network.degraded

src/routes/network.js
 ├─ GET /network/status         → svc.getStatus()
 └─ GET /network/status/history → svc.getHistory()
```

---

## Tests

```bash
npx jest tests/network-status-monitoring.test.js --coverage
```

Coverage targets for new files: ≥ 95% statements, ≥ 90% branches, 100% lines.

Test cases cover:

- Healthy state (connected, normal fee, fast ledger)
- Fee surge degradation (> 5× baseline)
- Slow ledger close time degradation (> 10 s)
- High error rate degradation (> 5%)
- `network.degraded` event emission on first degradation
- No duplicate event emission while already degraded
- Re-emission after recovery → new degradation
- 24-hour history retention and pruning
- `GET /network/status` and `GET /network/status/history` HTTP responses
- Real `_fetchHorizon` HTTP paths (200, non-200, invalid JSON, connection error)
- 503 responses when service is not initialised
