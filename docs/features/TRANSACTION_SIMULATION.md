# Transaction Simulation

Dry-run a Stellar transaction before committing it to the network. Clients receive an estimated fee and expected operation outcome without any funds moving.

## Endpoint

```
POST /donations/simulate
```

### Authentication & Rate Limiting

- Requires a valid API key (`X-API-Key` header) — returns **401** if missing or invalid.
- Subject to the same rate limiter as `POST /donations` — returns **429** when exceeded.

---

## Request

### Headers

| Header | Required | Description |
|---|---|---|
| `X-API-Key` | Yes | Valid API key |
| `Content-Type` | Yes | `application/json` |

### Body

```json
{
  "xdr": "<base64-encoded Stellar transaction envelope XDR>"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `xdr` | string | Yes | Base64-encoded Stellar transaction envelope. Must be non-empty. |

---

## Responses

### 200 — Simulation succeeded

The transaction is structurally valid and the fee estimate was calculated.

```json
{
  "success": true,
  "data": {
    "success": true,
    "estimatedFee": {
      "stroops": 100,
      "xlm": "0.0000100"
    },
    "estimatedResult": {
      "operationType": "payment",
      "sourceAccount": "GABC...XYZ",
      "destinationAccount": "GDEST...XYZ"
    },
    "simulatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

When Horizon fee stats are temporarily unavailable the response also includes a `feeWarning`:

```json
{
  "success": true,
  "data": {
    "success": true,
    "estimatedFee": { "stroops": 100, "xlm": "0.0000100" },
    "feeWarning": "Fee estimate is based on the Stellar network base fee (100 stroops/op); live fee stats were unavailable.",
    "estimatedResult": { ... },
    "simulatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 422 — Simulation failed

The XDR could not be decoded or the transaction is structurally invalid.

```json
{
  "success": false,
  "data": {
    "success": false,
    "errors": [
      "Failed to decode XDR: invalid base64 encoding"
    ],
    "simulatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 400 — Validation error

The `xdr` field is missing or empty.

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "xdr is required" }
}
```

### 401 — Unauthenticated

API key is missing or invalid.

### 429 — Rate limit exceeded

Too many requests from this API key / IP.

### 500 — Unexpected server error

An internal error occurred. No stack trace is exposed.

```json
{
  "success": false,
  "error": "Internal server error"
}
```

---

## Response Schema Reference

### Simulation_Result (success)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | `true` when the transaction is valid |
| `estimatedFee.stroops` | integer | Total estimated fee in stroops (per-op fee × operation count) |
| `estimatedFee.xlm` | string | Fee in XLM, 7 decimal places |
| `estimatedResult.operationType` | string | Type of the first operation (e.g. `"payment"`) |
| `estimatedResult.sourceAccount` | string\|null | Source account of the first operation |
| `estimatedResult.destinationAccount` | string\|null | Destination account of the first operation |
| `feeWarning` | string | Present only when fee stats were unavailable |
| `simulatedAt` | string | ISO 8601 timestamp of when the simulation ran |

### Simulation_Result (failure)

| Field | Type | Description |
|---|---|---|
| `success` | boolean | `false` |
| `errors` | string[] | One or more descriptive, actionable error messages |
| `simulatedAt` | string | ISO 8601 timestamp |

---

## Security Assumptions

### Dry-Run Isolation

`simulateTransaction` is **strictly read-only**. It performs two operations only:

1. **Local XDR decoding** — `StellarSdk.TransactionBuilder.fromXDR()` runs entirely in-process with no network call.
2. **Horizon fee stats query** — a single read-only `GET /fee_stats` request to Horizon. If this call fails, the method falls back to the Stellar base fee (100 stroops/op) and includes a `feeWarning` in the result.

The method **never** calls `server.submitTransaction`, `server.submitAsyncTransaction`, or any equivalent Horizon submission endpoint. No transaction is broadcast to the Stellar network under any circumstances.

### No Side Effects

- No database writes occur during simulation.
- No funds are moved or reserved.
- The simulation result is ephemeral — it is not stored anywhere.

---

## Example Usage

### cURL

```bash
curl -X POST https://api.example.com/donations/simulate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "xdr": "AAAAAgAAAABexSIg06FtXzmFBQQtHZsfa5GiEiy2lGCjzsHCtNh..."
  }'
```

### JavaScript (fetch)

```js
const response = await fetch('/donations/simulate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': process.env.API_KEY,
  },
  body: JSON.stringify({ xdr: transactionEnvelopeXdr }),
});

const { success, data } = await response.json();

if (response.status === 200 && data.success) {
  console.log('Estimated fee:', data.estimatedFee.xlm, 'XLM');
  console.log('Operation type:', data.estimatedResult.operationType);
} else if (response.status === 422) {
  console.error('Simulation failed:', data.errors);
}
```

### Multi-Operation Fee Calculation

For a transaction with N operations the estimated fee scales linearly:

```
estimatedFee.stroops = recommendedFeePerOperation × N
```

For example, a 3-operation transaction at 100 stroops/op yields `estimatedFee.stroops = 300`.
