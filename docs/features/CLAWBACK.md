# Stellar Clawback Operations

Allows asset issuers to reclaim custom Stellar assets from holders for regulatory compliance or erroneous distributions.

## Endpoint

```
POST /assets/:code/clawback
Authorization: Bearer <admin-key>
```

**Admin access required.**

### Request Body

| Field | Type | Description |
|---|---|---|
| `issuerSecret` | string | **Required.** Secret key of the asset issuer |
| `from` | string | **Required.** Public key of the holder to clawback from |
| `amount` | string | **Required.** Amount to clawback |
| `reason` | string | **Required.** Reason for clawback (stored in audit log) |

### Response

```json
{
  "success": true,
  "message": "Clawback of 5.0000000 MYTOKEN from GXYZ... executed",
  "data": {
    "assetCode": "MYTOKEN",
    "from": "GXYZ...",
    "amount": "5.0000000",
    "reason": "Regulatory compliance",
    "transactionHash": "abc123...",
    "ledger": 12345
  }
}
```

## Prerequisites

The issuer account must have `AUTH_CLAWBACK_ENABLED` flag set (flag 16). Use `PATCH /wallets/:id/options` with `setFlags: 16` to enable it.

## Audit Trail

Every clawback is logged with:
- `action: ASSET_CLAWBACK`
- `severity: HIGH`
- Full details: assetCode, from, amount, reason, transactionHash

## Security Assumptions

- **Admin-only**: Only admin API keys can execute clawbacks
- **Reason required**: The `reason` field is mandatory for compliance audit trail
- **Issuer-only**: Only the asset issuer's secret key can authorize a clawback
- **Reason immutability**: Once logged in the audit trail, the reason cannot be modified
