# Network Fee Statistics

`GET /network/fees`

Returns current Stellar network fee statistics, fee recommendations for different confirmation speeds, and a congestion level indicator. Results are cached for **30 seconds** to avoid hammering Horizon.

## Response

```json
{
  "success": true,
  "data": {
    "current": {
      "lastLedger": "12345",
      "lastLedgerBaseFee": "100",
      "ledgerCapacityUsage": "0.97",
      "feeCharged": { "p10": "100", "p50": "200", "p90": "1000", "..." : "..." },
      "maxFee":     { "p10": "100", "p50": "200", "p90": "1000", "..." : "..." }
    },
    "recommendations": {
      "fast":     "1000",
      "standard": "200",
      "slow":     "100"
    },
    "congestion": "high",
    "cachedAt": "2026-03-27T15:00:00.000Z",
    "cached": true
  },
  "timestamp": "2026-03-27T15:00:05.000Z"
}
```

## Fields

| Field | Description |
|---|---|
| `current` | Raw fee data from Horizon `/fee_stats` |
| `recommendations.fast` | p90 fee_charged — high priority, fast confirmation |
| `recommendations.standard` | p50 fee_charged — standard confirmation |
| `recommendations.slow` | p10 fee_charged — low priority, slow confirmation |
| `congestion` | `low` (< 50%), `medium` (50–79%), `high` (≥ 80%) based on `ledger_capacity_usage` |
| `cached` | `true` if response came from the 30-second cache |
| `cachedAt` | ISO timestamp of when the data was fetched |

## Security

- No authentication required — fee data is public.
- The Horizon URL is server-controlled (`HORIZON_URL` env var), never user-supplied.
- No sensitive data (keys, secrets, wallet addresses) is included in the response.

## Caching

Fee stats are cached in-memory for **30 seconds** (`Cache.set('network:fee_stats', data, 30000)`). This prevents excessive load on Horizon during high-traffic periods.
