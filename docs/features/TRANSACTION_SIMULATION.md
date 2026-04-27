# Transaction Simulation (Dry-Run)

Simulate a Stellar transaction without submitting it to the network.

## Overview

The simulation endpoint lets you validate a transaction envelope before broadcasting it. It checks fee, sequence number, and source account balance — all without ever calling `submitTransaction`. **No secret key is required.**

> Results are estimates based on current network state and do not guarantee success when the transaction is later submitted.

## Endpoint

```
POST /transactions/simulate
```

### Authentication

Requires an API key with the `transactions:simulate` permission (granted to `user` and `admin` roles).

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tx_envelope` | string | Yes | Base64-encoded XDR transaction envelope |

```json
{
  "tx_envelope": "<Base64-encoded XDR>"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "estimated_fee": "0.0001000",
    "sequence_validity": true,
    "source_account_balance_status": "sufficient",
    "operation_validity": true,
    "simulation_note": "Dry-run only. Results are estimates. No transaction was submitted. Secret keys are not required."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `estimated_fee` | string | Fee in XLM parsed from the envelope |
| `sequence_validity` | boolean | Whether the sequence number is the next expected value |
| `source_account_balance_status` | `"sufficient"` \| `"insufficient"` | Whether the source account can cover the fee + minimum reserve |
| `operation_validity` | boolean | Whether the envelope contains at least one operation |
| `simulation_note` | string | Reminder that this is a dry-run estimate |

### Error Responses

| HTTP | Code | Cause |
|------|------|-------|
| 400 | `MISSING_TX_ENVELOPE` | `tx_envelope` field is absent or not a string |
| 400 | `INVALID_XDR` | Envelope cannot be decoded as a valid Stellar transaction |
| 403 | `SIMULATION_DISABLED` | `SIMULATION_ENABLED=false` environment variable is set |
| 404 | `ACCOUNT_NOT_FOUND` | Source account does not exist on the configured network |

## Feature Flag

Set `SIMULATION_ENABLED=false` in your environment to disable the endpoint entirely. All requests will receive a `403 SIMULATION_DISABLED` response.

## Safety Guarantees

- `submitTransaction` is **never** called during simulation.
- No funds are moved.
- No secret keys are needed or accepted.

## Example

```bash
curl -X POST http://localhost:3000/transactions/simulate \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"tx_envelope": "AAAAAgAAAAB..."}'
```
