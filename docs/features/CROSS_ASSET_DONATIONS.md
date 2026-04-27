# Cross-Asset Donations

Donors holding non-XLM assets can donate without manually converting to XLM first. The API uses Stellar DEX path payments to automatically find a conversion route.

## Endpoints

### POST /donations/cross-asset

Execute a cross-asset donation via Stellar DEX path payment.

**Strict-send** — provide `sendAmount`: sends exactly that amount, recipient receives at least `sendAmount * (1 - slippageTolerance)` of `destAsset`.

**Strict-receive** — provide `destAmount`: recipient receives exactly that amount, sender spends at most `destAmount / rate * (1 + slippageTolerance)` of `sendAsset`.

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `sourceSecret` | string | yes | Sender's Stellar secret key |
| `sendAsset` | string\|object | yes | `"native"` or `{code, issuer}` |
| `sendAmount` | string | one of | Exact amount to send (strict-send) |
| `destPublicKey` | string | yes | Recipient's Stellar public key |
| `destAsset` | string\|object | yes | `"native"` or `{code, issuer}` |
| `destAmount` | string | one of | Exact amount to receive (strict-receive) |
| `slippageTolerance` | number | no | 0–1, default `0.01` (1%) |
| `memo` | string | no | Optional transaction memo |

Exactly one of `sendAmount` or `destAmount` must be provided.

**Response (201):**
```json
{
  "success": true,
  "data": {
    "transactionId": "abc123...",
    "ledger": 12345,
    "sourceAmount": "50.0000000",
    "destAmount": "60.0000000"
  }
}
```

**Error responses:**

| Status | Code | Cause |
|---|---|---|
| 400 | `NO_PATH_FOUND` | No DEX route exists between the assets |
| 400 | `SLIPPAGE_EXCEEDED` | Best route exceeds the slippage tolerance |
| 400 | `VALIDATION_ERROR` | Invalid input (missing fields, bad asset format, etc.) |
| 401 | — | Missing or invalid API key |

---

### GET /donations/cross-asset/paths

Preview available DEX conversion paths before committing to a payment.

**Query parameters:**

| Param | Required | Description |
|---|---|---|
| `sourcePublicKey` | yes | Sender's public key (used to enumerate held assets) |
| `destPublicKey` | yes | Recipient's public key |
| `destAsset` | yes | `"native"` or JSON-encoded `{code, issuer}` |
| `destAmount` | yes | Desired destination amount |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "paths": [
      {
        "sourceAsset": { "type": "credit_alphanum", "code": "USDC", "issuer": "G..." },
        "sourceAmount": "42.0000000",
        "destAsset": { "type": "native", "code": "XLM", "issuer": null },
        "destAmount": "10.0000000",
        "conversionRate": "0.2380952",
        "path": []
      }
    ]
  }
}
```

Returns `400 NO_PATH_FOUND` when no paths are available.

---

## Slippage Tolerance

- **Strict-send**: `minDestAmount = route.destAmount * (1 - slippageTolerance)`
- **Strict-receive**: `maxSendAmount = route.sourceAmount * (1 + slippageTolerance)`

If the actual execution price falls outside these bounds, the transaction fails with `SLIPPAGE_EXCEEDED`.

## Asset Format

Assets can be specified as:
- `"native"` or `"XLM"` — native XLM
- JSON object: `{"code": "USDC", "issuer": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"}`
- JSON string in query params: `destAsset=%7B%22code%22%3A%22USDC%22%2C...%7D`

## Service Methods

### `pathPaymentStrictSend(sourceSecret, sendAsset, sendAmount, destPublicKey, destAsset, minDestAmount, [options])`

Sends exactly `sendAmount` of `sendAsset`; recipient receives at least `minDestAmount` of `destAsset`.

### `pathPaymentStrictReceive(sourceSecret, sendAsset, maxSendAmount, destPublicKey, destAsset, destAmount, [options])`

Recipient receives exactly `destAmount` of `destAsset`; sender spends at most `maxSendAmount` of `sendAsset`.

### `findPaymentPaths(sourcePublicKey, destPublicKey, destAsset, destAmount)`

Returns all available conversion paths from the source account's held assets to `destAsset`.

## Mock Service

`MockStellarService` simulates path routing deterministically using configurable rates (`config.pathRates`). Default rates:

- non-XLM → XLM: `0.8`
- XLM → non-XLM: `1.2`
- non-XLM → non-XLM: `0.65`

Simulate no-path scenarios:
```js
stellarService.enableFailureSimulation('no_path', 1.0);
```
