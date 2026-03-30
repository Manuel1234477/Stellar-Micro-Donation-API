# Transaction Cost Breakdown

## Overview

Before confirming a donation, clients can request a full itemized cost breakdown showing the donation amount, Stellar network fee, optional platform fee, and total — all accurate to 7 decimal places (Stellar stroops precision). USD equivalents are included when an exchange rate is provided.

---

## Endpoint

```
GET /donations/cost-breakdown
```

**Required permission:** `donations:read`

### Query Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `amount` | number | ✅ | Donation amount in XLM (must be > 0) |
| `sender` | string | ❌ | Sender public key (reserved for future balance checks) |
| `surgeFeeMultiplier` | number | ❌ | Surge fee multiplier ≥ 1 (default: 1) |
| `xlmUsdRate` | number | ❌ | Current XLM/USD rate for USD equivalents (default: 0 = omit USD) |

### Response 200

```json
{
  "success": true,
  "data": {
    "donationAmount": { "xlm": "100.0000000", "usd": "12.00" },
    "networkFee":     { "xlm": "0.0000100",   "usd": "0.00", "baseFeeStroops": 100, "surgeFeeMultiplier": 1 },
    "platformFee":    { "xlm": "2.0000000",   "usd": "0.24", "percent": 2 },
    "total":          { "xlm": "102.0000100", "usd": "12.24" },
    "xlmUsdRate": 0.12,
    "rateTimestamp": "2026-03-26T10:00:00.000Z",
    "precision": "7 decimal places (stroops)"
  }
}
```

When `xlmUsdRate` is not provided, all `usd` fields and `rateTimestamp` are `null`.

---

## Fee Components

### Network Fee (Stellar Base Fee)

- **Protocol constant:** 100 stroops = `0.0000100` XLM
- **Surge fee:** Multiply by `surgeFeeMultiplier` during network congestion
- Not configurable without a code change

### Platform Fee

- Configured via `PLATFORM_FEE_PERCENT` environment variable
- Defaults to `0` (no platform fee)
- Applied as a percentage of the donation amount
- Example: `PLATFORM_FEE_PERCENT=2` charges 2% of the donation

```bash
# .env
PLATFORM_FEE_PERCENT=2
```

---

## Security Assumptions

- **Fee immutability:** Stellar base fee (100 stroops) is a protocol constant. Changing it requires a network upgrade.
- **Platform fee immutability:** `PLATFORM_FEE_PERCENT` is read from env at request time. Changing it requires a server restart, preventing silent mid-request mutations.
- **USD rate freshness:** The `rateTimestamp` field shows when the rate was applied. Callers are responsible for providing a fresh rate — the API does not fetch live rates.
- **No state mutation:** This endpoint is read-only and performs no database writes.

---

## Running Tests

```bash
npm test tests/cost-breakdown.test.js
```
