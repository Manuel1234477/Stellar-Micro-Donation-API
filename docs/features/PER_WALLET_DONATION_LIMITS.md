# Per-Wallet Donation Limits

## Overview

Admins can configure per-wallet donation limits (minimum, maximum per transaction, daily cap) that override global defaults. Wallets without explicit limits fall back to global configuration.

## Admin Endpoints

All endpoints require `admin` role.

### Set Per-Wallet Limits

```
POST /admin/wallets/:id/limits
```

**Body:**
```json
{
  "min_amount": 0.01,
  "max_amount": 500,
  "daily_cap": 1000,
  "monthly_limit": 5000
}
```

All fields are optional. Use `null` to clear a specific limit. Aliases: `per_transaction_limit` = `max_amount`, `daily_limit` = `daily_cap`.

**Responses:**
- `201` – Limits set
- `400` – Invalid value or `min_amount >= max_amount`
- `404` – Wallet not found

---

### Get Current Limits

```
GET /admin/wallets/:id/limits
```

Returns explicit overrides, effective limits (with global fallback), and global defaults.

**Example response:**
```json
{
  "success": true,
  "data": {
    "walletId": 42,
    "publicKey": "GDKV6...",
    "explicit": {
      "per_transaction_limit": 500,
      "daily_limit": 1000,
      "monthly_limit": null
    },
    "effective": {
      "per_transaction_limit": 500,
      "daily_limit": 1000,
      "monthly_limit": null
    },
    "globalDefaults": {
      "per_transaction_limit": 10000,
      "daily_limit": 50000,
      "monthly_limit": null
    }
  }
}
```

---

### Reset to Global Defaults

```
DELETE /admin/wallets/:id/limits
```

Clears all explicit per-wallet overrides. The wallet will fall back to global limits.

---

## Donation Response Headers

Every `POST /donations` response includes:

| Header | Description |
|--------|-------------|
| `X-Wallet-Limit-Min` | Effective minimum donation amount |
| `X-Wallet-Limit-Max` | Effective maximum per-transaction limit |

---

## Enforcement

`LimitService.checkLimits(userId, amount)` enforces limits in this order:

1. Per-wallet `per_transaction_limit` (if set) → else global `maxAmount`
2. Per-wallet `daily_limit` (if set) → else global `maxDailyPerDonor`
3. Per-wallet `monthly_limit` (if set) → no global fallback

Violations return HTTP `422` with the specific limit violated.
