# Leaderboard Caching & Freshness

`LeaderboardStatsService.getDonorLeaderboard()` / `getRecipientLeaderboard()`
aggregate over confirmed transactions, which is expensive to redo on every
request. Results are cached in-memory (`src/utils/cache.js`) per
`(type, period, limit)` combination.

## Freshness guarantee

- **TTL**: `LEADERBOARD_CACHE_TTL_MS` = 60 000 ms (1 minute). A cached result
  is served as-is for up to 60s after it was computed.
- **Event-driven invalidation**: every confirmed donation invalidates *all*
  leaderboard cache entries (`StatsService.invalidateLeaderboardCache()`,
  wired up in `src/services/LeaderboardSSE.js` via the `donation.confirmed`
  event), so in practice data is rarely more than one request-interval stale
  even within the 60s window.
- **SSE windows** (`daily`/`weekly`/`all-time`, used by `/leaderboard/stream`
  and `/leaderboard/snapshot`) are recomputed and broadcast immediately on
  every confirmed donation, independent of the TTL.

## Reading freshness from the API

`GET /leaderboard/donors` and `GET /leaderboard/recipients` include in
`metadata`:

| Field | Meaning |
|---|---|
| `generatedAt` | When this HTTP response was generated (always "now"). |
| `cachedAt` | When the underlying leaderboard data was actually computed. May be earlier than `generatedAt` if served from cache. |
| `ttlMs` | The cache TTL (`LEADERBOARD_CACHE_TTL_MS`). A consumer can treat the data as stale once `now - cachedAt > ttlMs`. |

## Observability

Two Prometheus metrics (`src/utils/metrics.js`, scraped at `/metrics`) report
compute vs. cache-hit behaviour:

| Metric | Type | Meaning |
|---|---|---|
| `leaderboard_cache_lookups_total{result="hit"|"miss"}` | Counter | Whether a leaderboard request was served from cache or required a full recomputation |
| `leaderboard_compute_duration_seconds` | Histogram | Wall-clock time of a full recomputation (cache miss only) |

A high miss rate relative to request rate, or a rising compute-duration p99,
indicates the dataset has grown large enough that the TTL/invalidation
strategy here should be revisited (e.g. moving to a scheduled background
precompute or incremental aggregation) before it becomes a hot-path
bottleneck.

## Why not incremental aggregation (yet)

Each lookup currently recomputes the leaderboard from the full filtered
transaction set rather than maintaining running per-donor/per-recipient
totals incrementally. Incremental aggregation would avoid the full scan on
every cache miss, but requires persisting aggregate state per period bucket
and handling edge cases (refunds/reversals, period-boundary rollover). The
metrics above give the data needed to decide if/when that investment is
justified; until the miss rate or compute duration becomes a problem, the
cache + event-driven invalidation here is the simpler, lower-risk approach.
