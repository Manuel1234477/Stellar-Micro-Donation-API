# Stellar Account Merge Support

## Overview

Account merge transfers all XLM from a source account to a destination account and permanently closes the source account on the Stellar network. This is useful for consolidating funds from temporary or one-time-use accounts.

---

## API Endpoint

### Merge a wallet

```
POST /wallets/:id/merge
```

**Required permission:** `wallets:delete`

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `destinationPublicKey` | string | ✅ | Stellar public key to receive all funds |
| `sourceSecret` | string | ✅ | Secret key of the wallet being closed |
| `confirm` | boolean | ✅ | Must be exactly `true` — prevents accidental closure |

**Response 200**

```json
{
  "success": true,
  "message": "Account merged successfully. Source account has been closed.",
  "data": {
    "sourceWalletId": 42,
    "sourcePublicKey": "GSOURCE...",
    "destinationPublicKey": "GDEST...",
    "mergedAmount": "499.9999900",
    "transactionHash": "abc123...",
    "ledger": 1234567,
    "mergedAt": "2026-03-26T10:00:00.000Z"
  }
}
```

**Error responses**

| Status | Condition |
|---|---|
| 400 | `confirm` is not exactly `true` |
| 400 | Missing `destinationPublicKey` or `sourceSecret` |
| 400 | Source and destination are the same wallet |
| 404 | Wallet ID not found |
| 409 | Wallet has already been merged |
| 500 | Stellar network error |

---

## Safeguards

- **Explicit confirmation** — `confirm: true` (boolean) must be present. Strings, numbers, or missing values are rejected.
- **Idempotency** — Once merged, the wallet record has `mergedAt` set. Subsequent merge attempts return 409.
- **Atomic failure** — If the Stellar operation fails, the database is not modified (no soft-delete, no audit entry).
- **Self-merge prevention** — Source and destination cannot be the same account.

---

## What happens on merge

1. `confirm: true` is validated
2. Source wallet is looked up by ID; rejected if already merged
3. `mergeAccount(sourceSecret, destinationPublicKey)` is called on the Stellar service
4. All XLM transfers to the destination; source account is closed on-chain
5. Source wallet record is soft-deleted (`mergedAt`, `mergedInto` columns set)
6. Audit entry written to `wallet_merge_audit` table

---

## Database changes

### `users` table (new columns)

| Column | Type | Description |
|---|---|---|
| `mergedAt` | DATETIME | Timestamp of merge (null = active) |
| `mergedInto` | TEXT | Destination public key |

### `wallet_merge_audit` table (new)

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `sourceWalletId` | INTEGER FK | References `users.id` |
| `sourcePublicKey` | TEXT | Source Stellar public key |
| `destinationPublicKey` | TEXT | Destination Stellar public key |
| `mergedAmount` | TEXT | XLM transferred |
| `transactionHash` | TEXT | Stellar transaction hash |
| `ledger` | INTEGER | Stellar ledger number |
| `performedBy` | TEXT | API key / user ID that triggered the merge |
| `timestamp` | DATETIME | When the merge occurred |

---

## Service layer

### `StellarService.mergeAccount(sourceSecret, destinationPublic)`

Builds and submits a Stellar `accountMerge` operation. Returns `{ hash, ledger, mergedAmount }`.

### `MockStellarService.mergeAccount(sourceSecret, destinationPublic)`

In-memory simulation: transfers balance, zeroes source, marks wallet as merged. Supports failure simulation via `enableFailureSimulation()`.

---

## Running tests

```bash
npm test tests/add-stellar-account-merge-support.test.js
```

No live Stellar network required — all tests use `MockStellarService`.
