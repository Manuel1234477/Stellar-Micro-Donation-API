# Implementing Wallet Balance Caching with TTL

## Overview
Wallet balances queried from the Stellar Horizon API frequently suffer from high latency during high-traffic load scenarios. Every raw request traditionally generated a live pull against Horizon, creating significant downstream bottlenecks and exposing rate-limits unnecessarily.

This optimization introduces localized runtime-caching using `src/utils/cache.js` resolving requests almost instantly if their polling threshold remains bounded dynamically underneath the native `WALLET_BALANCE_CACHE_TTL` boundary (defaults to `30s`).

## Behaviors
- The `GET /wallets/:id/balance` endpoint will check the cache map mapped securely behind `wallet_balance_{publicKey}` identifiers. 
- If resolving accurately under the TTL, the service answers instantaneously and appends an `X-Cache: HIT` header identifying its source.
- Expired or pristine requests resolve to Horizon cleanly returning `X-Cache: MISS`, immediately repopulating local maps natively safely.
- You can forcefully bypass this mechanism and forcefully hit Horizon by appending `?refresh=true` to the URL. (Use cautiously).
- **Proactive Cache Invalidation**: As transactions become verified inside `TransactionReconciliationService` switching to the `CONFIRMED` state, cache traces associated directly to involved components (`senderId` and `receiverId`) are automatically wiped forcing correct subsequent polling.

## Configuration
- `WALLET_BALANCE_CACHE_TTL`: Integer (milliseconds). Defaults safely to `30000ms` ensuring high consistency over transaction generation boundaries.
