# Configurable Donation Limits Per Wallet

## Overview

Per-wallet donation limits allow admins to set custom daily, monthly, and per-transaction caps on individual wallets. When no per-wallet limit is set, the system falls back to global config defaults.

## Limits

| Limit | Field | Description |
|---|---|---|
| Per-transaction | `per_transaction_limit` | Max XLM per single donation |
| Daily | `daily_limit` | Max XLM donated in a UTC day |
| Monthly | `monthly_limit` | Max XLM donated in a UTC month |

## API

### Set Wallet Limits

```
PATCH /wallets/:id/limits
x-api-key: <admin-key>
```

**Body** (all fields optional, use `null` to clear):
```json
{
  "daily_limit": 1000,
  "monthly_limit": 10000,
  "per_transaction_limit": 200
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "publicKey": "G...",
    "daily_limit": 1000,
    "monthly_limit": 10000,
    "per_transaction_limit": 200
  }
}
```

**Error responses:**
- `400` — invalid/missing limit fields or invalid wallet ID
- `401` — missing API key
- `403` — non-admin key
- `404` — wallet not found

### Donation Response Headers

After a successful `POST /donations/send`, remaining limits are returned as headers:

```
X-Donation-Daily-Remaining: 900
X-Donation-Monthly-Remaining: 9800
```

Headers are omitted when no limit is configured for that period.

### Limit Exceeded (422)

```json
{
  "success": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Donation amount 100 exceeds per-transaction limit of 50"
  }
}
```

## Implementation

- `src/services/LimitService.js` — `checkLimits`, `getRemainingLimits`, `setWalletLimits`, `getDailyTotal`, `getMonthlyTotal`
- `src/services/DonationService.js` — calls `LimitService.checkLimits()` before executing Stellar tx; returns `remainingLimits` in result
- `src/routes/donation.js` — injects `X-Donation-Daily-Remaining` / `X-Donation-Monthly-Remaining` headers on success
- `src/routes/wallet.js` — `PATCH /wallets/:id/limits` endpoint (admin only)
- `src/scripts/initDB.js` — users table includes `daily_limit`, `monthly_limit`, `per_transaction_limit` columns
