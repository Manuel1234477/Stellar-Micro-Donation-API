# Donation Analytics Dashboard Data Endpoint

Adds `GET /stats/dashboard` — a single endpoint that returns all data needed to render a donation analytics dashboard, with configurable time range, granularity, and 5-minute caching.

## Endpoint

### `GET /stats/dashboard`

**Query parameters:**

| Parameter        | Type   | Default | Description |
|------------------|--------|---------|-------------|
| `period`         | string | `30d`   | Time range: `24h`, `7d`, `30d`, `4w`, `3m`, `1y`, etc. |
| `granularity`    | string | auto    | `hourly` \| `daily` \| `weekly` \| `monthly` |
| `topN`           | number | `10`    | Number of top donors/recipients to return |
| `movingAvgWindow`| number | `3`     | Moving average window size |

**Auto granularity selection:**

| Period length | Granularity |
|---------------|-------------|
| ≤ 48 hours    | hourly      |
| ≤ 14 days     | daily       |
| ≤ 90 days     | weekly      |
| > 90 days     | monthly     |

**Example:**
```
GET /stats/dashboard?period=30d&granularity=daily&topN=5
x-api-key: <your-key>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "30d",
    "granularity": "weekly",
    "dateRange": { "start": "...", "end": "..." },
    "summary": {
      "totalDonations": 142,
      "totalAmount": 1430.5,
      "avgAmount": 10.07
    },
    "trend": [
      { "bucket": "2026-W01", "count": 12, "totalAmount": 120.0, "avgAmount": 10.0 }
    ],
    "trendMovingAvg": [
      { "bucket": "2026-W01", "movingAvg": 110.0 }
    ],
    "topDonors": [
      { "address": "GABC...", "totalAmount": 250.0, "count": 25 }
    ],
    "topRecipients": [
      { "address": "GXYZ...", "totalAmount": 300.0, "count": 30 }
    ],
    "cached": false
  }
}
```

## Error Responses

| Scenario | Status | Code |
|----------|--------|------|
| Invalid period string | 400 | `INVALID_PARAM` |
| Invalid granularity value | 400 | `INVALID_PARAM` |

## Caching

Results are cached for **5 minutes** per unique combination of `period`, `granularity`, `topN`, and `movingAvgWindow`. The cache is automatically invalidated when a `donation.created` event fires.

## New Functions in `StatsService`

| Function | Description |
|----------|-------------|
| `parsePeriod(period)` | Parses period string → `{start, end, granularity}` |
| `bucketByGranularity(txs, granularity)` | Groups transactions into time buckets |
| `movingAverage(buckets, window)` | Computes simple moving average over buckets |
| `getDashboardData(options)` | Assembles full dashboard payload with caching |

## Files Changed

| File | Change |
|------|--------|
| `src/services/StatsService.js` | Added `parsePeriod`, `bucketByGranularity`, `movingAverage`, `getDashboardData`; cache invalidation hook |
| `src/routes/stats.js` | Added `GET /stats/dashboard` route |
| `tests/implement-donation-analytics-dashboard-data-endpoi.test.js` | New — 38 tests |
