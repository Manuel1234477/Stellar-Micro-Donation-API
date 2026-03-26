# TransactionSyncService Horizon API Pagination

## Overview
The `TransactionSyncService` previously suffered from a hardcoded limit fetching only the static first `50` transactions. This caused wallets with extensive transaction histories to lose older sync events forever.

This update resolves the bug by dynamically traversing the `<next>` linkage cursors encoded by the Horizon API utilizing the `paging_token` and traversing through history efficiently up to a configurable `maxTransactions` cap to prevent runaway loops unbounded logic.

## Changes Implemented
- **Incremental Sync**: The `Wallet` model now tracks the `last_synced_cursor` column indicating the `paging_token` of the newest transaction previously processed for that target `wallet.address`.
- **Directional State Swap**: `TransactionSyncService` intelligently swaps its query behavior:
  - If a `last_synced_cursor` exists, it triggers an `order(asc)` pull extending out forward finding exclusively **new** transactions created *after* the `last_synced_cursor`.
  - If no prior sync context exists, it falls back to `order(desc)` fetching aggressively upwards backward fetching up to `maxTransactions` history.
- **Controlled Pagination**: By default, `syncWalletTransactions(address, maxTransactions = 500)` will follow response bindings, merging the accumulated history until the ceiling boundary (`500`) breaches safely.

## Metrics Observability 
Telemetry is emitted natively utilizing local logger tools. Information generated on sync spans:
```json
{
  "level": "INFO", 
  "scope": "TX_SYNC",
  "message": "Synced transactions for wallet",
  "walletAddress": "GXXX...",
  "syncedCount": 65,
  "fetchedCount": 65,
  "durationMs": 421
}
```

## Security
- `maxTransactions` tightly restricts boundless processing.
- `MockStellarService` and native `StellarSdk` methods were accurately mocked against testing infrastructure guaranteeing deterministic behavior. Memory limits and database crashes evaluated structurally.
