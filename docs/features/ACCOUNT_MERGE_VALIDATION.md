# Account Merge Validation

## Overview

Account merging transfers all XLM from a source account to a destination and removes the source from the Stellar ledger. The API exposes pre-merge eligibility validation to surface blocking conditions before attempting the merge.

## Endpoints

### Check Merge Eligibility

```
GET /wallets/:id/merge/eligibility
```

Returns all blocking conditions that would prevent a merge.

**Permissions:** `wallets:read`

**Blocking condition types:**

| Type | Description |
|------|-------------|
| `non_zero_trustline` | Non-native asset with non-zero balance |
| `open_offers` | Account has open DEX offers |
| `data_entries` | Account has data entries |
| `already_merged` | Wallet was already merged |

**Example response (eligible):**
```json
{
  "success": true,
  "data": {
    "walletId": 42,
    "publicKey": "GDKV6...",
    "eligible": true,
    "blockers": []
  }
}
```

**Example response (blocked):**
```json
{
  "success": true,
  "data": {
    "walletId": 42,
    "publicKey": "GDKV6...",
    "eligible": false,
    "blockers": [
      { "type": "non_zero_trustline", "detail": "Non-zero trustline: USDC (balance: 50.0000000)" },
      { "type": "open_offers", "detail": "Account has open DEX offers" }
    ]
  }
}
```

**Responses:**
- `200` – Eligibility check complete
- `404` – Wallet not found
- `409` – Wallet already merged

---

### Merge Account

```
POST /wallets/:id/merge
```

Merges the wallet into a destination account. Automatically runs eligibility check first — returns `400` if any blockers exist.

**Permissions:** `wallets:delete`

**Body:**
```json
{
  "destinationPublicKey": "GDEST...",
  "sourceSecret": "SSOURCE...",
  "confirm": true
}
```

**Responses:**
- `200` – Merged successfully
- `400` – Eligibility check failed (includes `blockers` array)
- `400` – Missing fields or invalid destination
- `404` – Wallet not found
- `409` – Already merged

**Example blocked response:**
```json
{
  "success": false,
  "error": "Account is not eligible for merge",
  "data": {
    "blockers": [
      { "type": "non_zero_trustline", "detail": "Non-zero trustline: USDC (balance: 50.0000000)" }
    ]
  }
}
```

---

## StellarService API

### `validateMergeEligibility(publicKey)`

```js
const { eligible, blockers } = await stellarService.validateMergeEligibility(publicKey);
```

Available on both `StellarService` (live Horizon) and `MockStellarService` (in-memory simulation).

**MockStellarService** checks:
- `wallet.balances` for non-zero non-native assets
- `wallet.openOffers` array
- `wallet.dataEntries` object

---

## Workflow

```
GET /wallets/:id/merge/eligibility   ← check first
  → eligible: true
POST /wallets/:id/merge              ← proceed
  → merged successfully
```
