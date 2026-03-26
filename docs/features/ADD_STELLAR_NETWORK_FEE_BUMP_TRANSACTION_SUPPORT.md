# Stellar Network Fee Bump Transaction Support

## Overview

Stellar transactions can get stuck in the mempool when the network fee is too low during congestion. Fee bump transactions wrap the original transaction with a higher fee, allowing it to be prioritized without resubmission.

This feature provides both automatic detection of stuck transactions and a manual admin endpoint for fee bumps.

## How It Works

### Automatic Detection

The `TransactionReconciliationService` runs every 5 minutes and checks for stuck transactions:

1. Queries all transactions in `SUBMITTED` state
2. Identifies those with `statusUpdatedAt` older than 5 minutes
3. Filters out transactions that have exhausted fee bump attempts (max 3)
4. For each stuck transaction, applies a fee bump using the network-recommended fee

### Fee Calculation

- **Automatic mode**: Queries Horizon fee stats for the recommended fee (p70 percentile)
- **Manual mode**: Admin specifies the fee in stroops
- **Safety**: If the network-recommended fee is lower than the current fee, doubles the current fee
- **Hard cap**: 1,000,000 stroops (0.1 XLM) — prevents runaway fees

### Retry Limits

- Maximum 3 fee bump attempts per transaction
- After 3 failed attempts, the transaction is flagged for manual admin intervention
- Each attempt is logged via the audit system

## Admin Endpoint

### POST /admin/transactions/:id/fee-bump

Manually apply a fee bump to a stuck transaction.

**Authentication:** Requires `ADMIN_ALL` permission.

**Request Body:**

| Field | Type   | Required | Description |
|-------|--------|----------|-------------|
| fee   | number | No       | Fee in stroops. If omitted, uses network-recommended fee. |

**Success Response (200):**

```json
{
  "success": true,
  "data": {
    "transactionId": "tx-123",
    "originalFee": 100,
    "newFee": 200,
    "feeBumpCount": 1,
    "hash": "abc123..."
  }
}
```

**Error Responses:**

| Status | Code | Description |
|--------|------|-------------|
| 404 | TRANSACTION_NOT_FOUND | Transaction does not exist |
| 422 | FEE_BUMP_INVALID_STATE | Transaction not in `submitted` state |
| 422 | FEE_BUMP_NO_ENVELOPE | No stored envelope XDR |
| 422 | FEE_BUMP_MAX_ATTEMPTS | Max 3 attempts reached |
| 422 | FEE_BUMP_EXCEEDS_CAP | Fee exceeds 0.1 XLM cap |
| 422 | FEE_BUMP_FAILED | Stellar network rejected the fee bump |

## Transaction Model Fields

| Field | Type | Description |
|-------|------|-------------|
| envelopeXdr | string | Base64 XDR of the transaction envelope |
| feeBumpCount | number | Number of fee bumps applied (0-3) |
| originalFee | number | Fee in stroops when first submitted |
| currentFee | number | Current fee in stroops (updated after bumps) |
| lastFeeBumpAt | string | ISO timestamp of the last fee bump |

## Configuration

| Constant | Default | Description |
|----------|---------|-------------|
| MAX_FEE_BUMP_ATTEMPTS | 3 | Maximum fee bump attempts per transaction |
| STUCK_THRESHOLD_MS | 300000 (5 min) | Time before a submitted transaction is considered stuck |
| MAX_FEE_CAP_STROOPS | 1000000 (0.1 XLM) | Hard cap on fee bump fee |

## Audit Logging

All fee bump events are logged via `AuditLogService`:

- `FEE_BUMP_APPLIED` — Successful fee bump with original and new fee
- `FEE_BUMP_FAILED` — Failed fee bump attempt with error details
- `FEE_BUMP_AUTO_DETECTED` — Stuck transactions detected during reconciliation

## Testing

Run the fee bump tests:

```bash
npm test tests/add-stellar-network-fee-bump-transaction-support.test.js
```

All tests use `MockStellarService` — no live Stellar network required.
