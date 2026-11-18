# Multi-Instance State Inventory (#1786)

The API can run as several replicas (`deploy/kubernetes/deployment.yaml` sets
`replicas`). Anything kept in a module-level `Map`/`Set` exists once **per process**,
so with more than one replica each pod sees only its own copy.

This page lists that state, says whether per-process is acceptable, and says what
to configure when it is not.

## Running more than one replica

Set these on every replica, all pointing at the same Redis:

```env
SHARED_STATE_BACKEND=redis
SHARED_STATE_REDIS_URL=redis://redis:6379   # or REDIS_URL
RATE_LIMIT_STORE=redis                      # cluster-wide rate limits
PUBSUB_ADAPTER=redis                        # SSE events reach every pod
```

The Redis backends use the [`ioredis`](https://github.com/redis/ioredis) client, which
is loaded lazily and is not a hard dependency. Install it in images that run more than
one replica. If Redis is requested but `ioredis` or the URL is missing, the process logs
a warning and falls back to per-process state.

`SHARED_STATE_FAIL_OPEN` (default `true`) controls what happens when Redis is
unreachable at request time: fall back to per-process state (`true`) or fail the
operation (`false`).

## Shared-state store

`src/utils/sharedStateStore.js` defines a small async interface:

| Method | Purpose |
|---|---|
| `get(key)` / `set(key, value, ttlMs)` / `delete(key)` | JSON values with a TTL |
| `setIfAbsent(key, value, ttlMs)` | Atomic first-writer-wins (Redis `SET NX PX`) |
| `addMember(setKey, member, ttlMs)` | Add/refresh a member of an expiring set; returns the live count |
| `removeMember(setKey, member)` / `countMembers(setKey)` | Expiring-set maintenance |

Backends: `MemorySharedStateStore` (default, per-process) and `RedisSharedStateStore`
(keys prefixed with `SHARED_STATE_KEY_PREFIX`, expiring sets stored as sorted sets
scored by expiry time).

## Inventory

### Correctness-critical — shared when `SHARED_STATE_BACKEND=redis`

| State | Location | Behaviour with the redis backend |
|---|---|---|
| Body-hash deduplication cache | `src/middleware/deduplication.js` (`_cache`) | Cached responses are stored under `dedup:<hash>`. A retry on another pod is answered from the cache with `X-Deduplicated: true`. |
| Request-signing nonces | `src/utils/nonceStore.js` | Nonces are recorded with `setIfAbsent` under `nonce:<nonce>` for the signature window. A replay on another pod is rejected. |
| SSE per-key connection limit | `src/services/SseManager.js` (`_clients`) | Every stream is registered in the expiring set `sse:conn:<apiKey>`, refreshed on each heartbeat and expiring after 3 missed heartbeats. A connection that pushes the key over `SSE_MAX_CONNECTIONS_PER_KEY` receives a `connection_limit_exceeded` event and is closed. The open sockets themselves stay per-pod; events reach them through `PUBSUB_ADAPTER`. |
| Rate-limit counters | `src/middleware/RateLimitStore.js`, `src/services/rateLimitStores/` | Already shared via `RATE_LIMIT_STORE=redis`. |
| SSE event fan-out | `src/services/PubSubAdapter.js` | Already shared via `PUBSUB_ADAPTER=redis`. |

### Per-process configuration — consistent because every pod loads the same config

| State | Location | Notes |
|---|---|---|
| Inbound webhook sources | `src/middleware/inboundWebhookVerification.js` (`sources`) | Registered at boot from `INBOUND_WEBHOOK_SOURCES` on every replica. Do not call `registerWebhookSource()` from request handlers. |
| Schema / method registries | `src/middleware/schemaRegistry.js`, `src/middleware/methodRegistry.js` | Built at startup from code. |
| Federation records | `src/routes/federation.js` (`federationRegistry`) | Seeded from `FEDERATION_RECORDS`. Records added at runtime are per-pod. |
| Feature-flag cache | `src/utils/featureFlags.js` (`flagCache`) | Cache of the database table. |

### Caches — per-process is acceptable

Entries are derived from the database or an upstream service, expire, and are safe
to miss or to differ briefly between pods.

`src/models/apiKeys.js` (`keyCache`, ≤ 5 min TTL), `src/utils/cache.js`,
`src/utils/federation.js`, `src/routes/federationLookup.js`,
`src/middleware/rotationLock.js`, `src/services/SequenceCacheService.js`,
`src/services/RecipientAccountService.js`, `src/services/LeaderboardStatsService.js`,
`src/services/PriceOracleService.js`, `src/utils/tracing.js` (`_traceStore`).

### Heuristics — per-process lowers sensitivity but does not break correctness

With N replicas behind a round-robin load balancer, each pod sees roughly 1/N of a
client's traffic, so thresholds trip later.

| State | Location |
|---|---|
| Abuse / suspicious-pattern detection | `src/utils/abuseDetector.js`, `src/utils/suspiciousPatternDetector.js`, `src/services/AbuseDetectionService.js` |
| Request replay detection (fingerprint counts) | `src/utils/replayDetector.js` (`TrackingStore`) |
| Brute-force login protection | `src/utils/bruteForceProtection.js` |
| Memo collision detection | `src/utils/memoCollisionDetector.js` |
| Anomaly detection history | `src/services/AnomalyDetectionService.js` |
| API key usage records | `src/services/ApiKeyUsageService.js` |

### Known per-pod state that needs sticky sessions or a follow-up

These still live in one pod. With several replicas, a follow-up request routed to a
different pod will not find the entry. Use session affinity for the admin routes, or
move them to the database in a follow-up.

| State | Location | Effect on another pod |
|---|---|---|
| Restore confirmation tokens | `src/routes/admin/backup.js` (`confirmTokens`) | Confirmation step fails; request a new token. |
| Admin job status (vacuum, integrity, reconciliation, security scan, bulk import) | `src/routes/admin/db.js`, `src/routes/admin/reconciliation.js`, `src/routes/admin/securityScan.js`, `src/services/BulkWalletImportService.js` | Job status polling returns not-found. |
| Per-donor daily-limit lock | `src/routes/donations/helpers.js` (`_donorLocks`) | Concurrent donations from one donor on two pods are not serialised; the daily limit can be exceeded by one in-flight donation. |
| Offer / receipt logs | `src/routes/offers.js`, `src/routes/receipt.js` | Listing shows only the pod's own entries. |
| GraphQL subscription events | `src/graphql/pubsub.js` | Subscribers on other pods do not receive the event. |
| Mock Stellar ledger | `src/services/MockStellarService.js` | Test/dev only (`MOCK_STELLAR=true`). |

## Verification

`tests/integration/multi-instance-shared-state.test.js` builds two app instances with
separate module registries, as two pods would have, against one shared store. It
checks that a retried donation is deduplicated across instances, that a nonce used on
one instance is rejected on the other, and that the SSE per-key limit is enforced
across both.
