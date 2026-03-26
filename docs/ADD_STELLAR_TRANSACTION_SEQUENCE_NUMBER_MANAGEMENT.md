# Stellar Transaction Sequence Number Management

**Feature branch:** `feature/add-stellar-transaction-sequence-number-management`  
**Issue:** [#377](https://github.com/Manuel1234477/Stellar-Micro-Donation-API/issues/377)  
**Module:** `src/utils/sequenceManager.js`

---

## Table of Contents

1. [Problem Statement](#problem-statement)
2. [Solution Overview](#solution-overview)
3. [Architecture](#architecture)
4. [API Reference](#api-reference)
5. [Usage Examples](#usage-examples)
6. [Configuration](#configuration)
7. [Metrics](#metrics)
8. [Security Assumptions](#security-assumptions)
9. [Testing](#testing)
10. [Edge Cases and Limitations](#edge-cases-and-limitations)

---

## Problem Statement

Stellar transactions require a **strictly incrementing sequence number** — each
transaction must use a value exactly one greater than the account's last-committed
sequence number. Under concurrent load two or more pending transactions from the
same account will share the same starting sequence number, causing all but one to
fail with a `tx_bad_seq` error.

```
Account sequence on-chain: 100

Tx A submitted → uses 101  ✓
Tx B submitted → uses 101  ✗ tx_bad_seq (101 already used)
Tx C submitted → uses 101  ✗ tx_bad_seq
```

Without coordination this produces a thundering-herd of failures that are both
wasteful (each failed submission still costs an API round-trip) and confusing to
end users.

---

## Solution Overview

`sequenceManager.js` solves this with three complementary mechanisms:

| Mechanism | What it does |
|-----------|-------------|
| **Per-account async mutex** | Serialises all transactions from the same account so only one is in-flight at a time |
| **Sequence number cache** | Stores the last known sequence number in memory; avoids a Horizon `loadAccount` call for every transaction |
| **Optimistic retry with cache invalidation** | On `tx_bad_seq` the cache is cleared and the transaction is retried up to `maxRetries` times using exponential back-off |

---

## Architecture

```
Concurrent callers (same account)
        │   │   │
        ▼   ▼   ▼
┌────────────────────────────────┐
│       withAccountLock()        │  ← per-account Promise chain (mutex)
│                                │
│  ┌──────────────────────────┐  │
│  │   executeWithRetry()     │  │  ← retry loop (max N attempts)
│  │                          │  │
│  │  getSequenceNumber()     │  │  ← cache-first; falls back to Horizon
│  │  transactionFn(attempt)  │  │  ← caller's build+submit logic
│  │                          │  │
│  │  on tx_bad_seq:          │  │
│  │    invalidateCache()     │  │  ← forces fresh Horizon fetch
│  │    sleep(backoff)        │  │
│  │    retry ...             │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
        │
        ▼
   Horizon API
```

### Key data structures

```
lockMap      Map<accountId, Promise>  — tail of each account's lock chain
sequenceCache Map<accountId, { sequenceNumber, cachedAt }>
metrics       { conflicts, retries, cacheHits, cacheMisses, lockWaits }
```

---

## API Reference

### `createSequenceManager([config])` → `SequenceManager`

Factory function. Use this in tests and wherever you need an isolated instance.

```js
const { createSequenceManager } = require('./src/utils/sequenceManager');
const mgr = createSequenceManager({ maxRetries: 3, retryDelayMs: 50 });
```

---

### `mgr.withAccountLock(accountId, fn)` → `Promise<T>`

Acquires an exclusive per-account lock and runs `fn` inside it.
All callers for the same `accountId` are queued and run serially.

```js
await mgr.withAccountLock(senderPublicKey, async () => {
  // only one caller runs here at a time per account
});
```

---

### `mgr.getSequenceNumber(accountId, horizonClient)` → `Promise<string>`

Returns the current sequence number for `accountId`.

- **Cache hit** (entry exists and is within TTL): returns cached value,
  increments the cache optimistically, counts a cache hit.
- **Cache miss** (no entry or expired): calls `horizonClient.loadAccount(accountId)`,
  stores the result, counts a cache miss.

```js
const seq = await mgr.getSequenceNumber(publicKey, server);
```

---

### `mgr.executeWithRetry(accountId, transactionFn)` → `Promise<T>`

High-level helper. Wraps `transactionFn` inside an account lock with automatic
retry on `tx_bad_seq`.

```js
const result = await mgr.executeWithRetry(senderKey, async (attempt) => {
  const seq = await mgr.getSequenceNumber(senderKey, server);
  const tx = buildTransaction(senderKey, recipientKey, amount, seq);
  return server.submitTransaction(tx);
});
```

`transactionFn` receives the zero-based **attempt index** so callers can
adjust behaviour (e.g. logging) on retries.

---

### `mgr.invalidateCache(accountId)` → `void`

Removes `accountId` from the sequence cache. Called automatically inside
`executeWithRetry` before each retry.

---

### `mgr.clearCache([accountId])` → `void`

Clears the cache for a specific account (if `accountId` is provided) or for
all accounts (no argument).

---

### `mgr.getMetrics()` → `SequenceMetrics`

Returns a snapshot of the current metrics counters.

```ts
{
  conflicts:   number,  // total tx_bad_seq errors encountered
  retries:     number,  // total retry attempts made
  cacheHits:   number,  // times a valid cached entry was used
  cacheMisses: number,  // times the cache was cold or stale
  lockWaits:   number,  // times a task waited for an account lock
}
```

---

### `mgr.resetMetrics()` → `void`

Zeros all counters. Useful between monitoring windows or test runs.

---

### `mgr.activeLockCount()` → `number`

Returns how many accounts currently have an active lock. Useful for health checks.

---

## Usage Examples

### Basic one-time donation

```js
const { createSequenceManager } = require('./src/utils/sequenceManager');
const StellarSdk = require('stellar-sdk');

const seqMgr = createSequenceManager();
const server  = new StellarSdk.Server('https://horizon-testnet.stellar.org');

async function submitDonation(senderSecret, recipientKey, amount) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderKey     = senderKeypair.publicKey();

  return seqMgr.executeWithRetry(senderKey, async (attempt) => {
    if (attempt > 0) {
      console.log(`Retrying donation (attempt ${attempt + 1}) …`);
    }

    const seq     = await seqMgr.getSequenceNumber(senderKey, server);
    const account = new StellarSdk.Account(senderKey, seq);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: recipientKey,
          asset:       StellarSdk.Asset.native(),
          amount:      amount.toString(),
        })
      )
      .setTimeout(30)
      .build();

    tx.sign(senderKeypair);
    return server.submitTransaction(tx);
  });
}
```

### Recurring donation scheduler integration

```js
// In RecurringDonationScheduler.js
const { defaultManager } = require('../utils/sequenceManager');

async function executeDue(schedule) {
  return defaultManager.executeWithRetry(
    schedule.donorPublicKey,
    async () => submitScheduledPayment(schedule)
  );
}
```

### Monitoring metrics

```js
setInterval(() => {
  const m = seqMgr.getMetrics();
  console.log(
    `[seq-mgr] conflicts=${m.conflicts} retries=${m.retries} ` +
    `hits=${m.cacheHits} misses=${m.cacheMisses}`
  );
  seqMgr.resetMetrics(); // reset window
}, 60_000);
```

---

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `maxRetries` | `5` | Maximum retry attempts after a `tx_bad_seq` error |
| `retryDelayMs` | `100` | Base delay between retries (ms). Actual delay uses exponential back-off + ±10 % jitter |
| `cacheTtlMs` | `30000` | How long (ms) a cached sequence number is considered fresh |
| `backoffMultiplier` | `2` | Multiplier applied to `retryDelayMs` on each retry |

**Tuning advice:**

- **High-throughput senders**: lower `retryDelayMs` to `20–50 ms`; the lock
  already serialises requests so conflicts should be rare.
- **Flaky networks**: raise `maxRetries` to `8–10` and increase `retryDelayMs`.
- **Short-lived processes** (e.g. Lambda): lower `cacheTtlMs` to `5000` so
  stale cache entries don't cause spurious `tx_bad_seq` errors after a cold start.

---

## Metrics

The module exposes lightweight counters (no external dependencies):

| Metric | Interpretation |
|--------|---------------|
| `conflicts` | Rising fast → network congestion or a bug producing duplicate submits |
| `retries` | Should be ≤ `conflicts` × `maxRetries` |
| `cacheHits / cacheMisses` | Hit rate = `hits / (hits + misses)`; a healthy deployment should be > 80 % |
| `lockWaits` | High value → many tasks queued per account; consider rate-limiting at the API layer |

Metrics can be scraped and pushed to Prometheus/Datadog using a periodic
`setInterval` wrapper (see example above).

---

## Security Assumptions

| Assumption | Rationale |
|------------|-----------|
| The sequence cache is **process-local and in-memory** | Acceptable for a single-process Node.js server. A multi-process deployment (cluster, multiple pods) must use a distributed lock (e.g. Redis `SET NX`) instead of this module. |
| `accountId` (public key) is **trusted input** | All callers are internal services. No external user can inject an arbitrary account ID to monopolise a lock. |
| Cached sequence numbers are **short-lived** (default 30 s) | Prevents stale data from accumulating if the Stellar ledger advances without going through this process. |
| Private keys **never pass through** this module | The module only handles sequence numbers. Key management is the caller's responsibility. |
| The retry loop has a **bounded maximum** | Prevents infinite loops if Horizon returns persistent errors. |

---

## Testing

The test suite lives at:

```
tests/add-stellar-transaction-sequence-number-management.test.js
```

Run it with:

```bash
npm test tests/add-stellar-transaction-sequence-number-management.test.js
```

With coverage:

```bash
npm test -- --coverage --collectCoverageFrom='src/utils/sequenceManager.js' \
  tests/add-stellar-transaction-sequence-number-management.test.js
```

### What is tested

| Suite | Scenarios |
|-------|-----------|
| Factory | Default config, custom config merge, instance isolation |
| `withAccountLock` | Single task, serialisation of 10+ concurrent tasks, parallel tasks for different accounts, error propagation, lock release after error |
| `getSequenceNumber` | Cache miss (Horizon fetch), cache hit, TTL expiry, `invalidateCache`, `clearCache` (single + all), optimistic increment |
| `executeWithRetry` | Success path, retry on `tx_bad_seq`, exhaust retries, non-sequence error passthrough, cache invalidation on retry, attempt index passed to fn, `maxRetries=0`, serialisation during retry, message-string detection |
| Metrics | Snapshot isolation, `resetMetrics`, `cacheHits`, `cacheMisses`, conflict + retry counters |
| `activeLockCount` | Zero when idle, positive while locked |
| Edge cases | Horizon rejection, null error, independent caches per account, singleton exports, alternate error shape, config immutability |

---

## Edge Cases and Limitations

- **Cluster / multi-pod deployments**: The per-account lock is process-local. Use
  a distributed lock (Redis, DynamoDB conditional writes) for multi-process setups.
- **Very long-running transactions**: If `cacheTtlMs` expires while a transaction is
  being built, the next call inside the same lock window will fetch a fresh sequence —
  which is safe because the lock serialises access.
- **Ledger rollback / network upgrade**: A network-level sequence reset would cause
  persistent `tx_bad_seq` errors that exhaust `maxRetries`. Monitor `conflicts`
  metrics and alert when the conflict rate exceeds a threshold (e.g. > 10 in 60 s).
- **Memory leak prevention**: `lockMap` entries are deleted once their promise chain
  settles (`finally` clause), so the Map does not grow unboundedly even under
  sustained load.