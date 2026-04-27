# Stellar Account Set Options

Allows setting Stellar account options (home domain, thresholds, flags, signers) for custodial wallets via the API.

## Endpoint

```
PATCH /wallets/:id/options
Authorization: Bearer <user-or-admin-key>
```

### Request Body

| Field | Type | Description |
|---|---|---|
| `secret` | string | **Required.** Account secret key |
| `homeDomain` | string | Home domain (max 32 chars) for federation/SEP-0010 |
| `inflationDest` | string | Inflation destination public key |
| `masterWeight` | integer (0–255) | Master key weight |
| `lowThreshold` | integer (0–255) | Low security threshold |
| `medThreshold` | integer (0–255) | Medium security threshold |
| `highThreshold` | integer (0–255) | High security threshold |
| `setFlags` | integer | Flags to set (bitmask) |
| `clearFlags` | integer | Flags to clear (bitmask) |

### Response

```json
{
  "success": true,
  "data": {
    "walletId": 1,
    "transactionHash": "abc123...",
    "ledger": 12345
  }
}
```

## Flag Values

| Flag | Value | Notes |
|---|---|---|
| `AUTH_REQUIRED` | 1 | Trustlines require issuer authorization |
| `AUTH_REVOCABLE` | 2 | Issuer can revoke trustlines |
| `AUTH_IMMUTABLE` | 8 | **Cannot be cleared once set** |
| `AUTH_CLAWBACK_ENABLED` | 16 | Enables clawback on issued assets |

## Security Assumptions

- `AUTH_IMMUTABLE` (flag 8) **cannot be cleared** once set — this is enforced both on-chain and at the API layer with a 400 error
- Setting `masterWeight: 0` locks the account — use with caution
- All option changes are logged in the audit trail with `WALLET_OPTIONS_SET` action
