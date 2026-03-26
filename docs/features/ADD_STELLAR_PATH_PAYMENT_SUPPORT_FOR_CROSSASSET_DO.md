# Add Stellar Path Payment Support For Cross-Asset Donations

## Summary

This feature adds Stellar path payment support so a donor can fund a donation with a source asset that differs from the destination asset received by the recipient. The current implementation keeps the recipient-side asset defaulted to native XLM and adds server-side path discovery, execution, fallback handling, offline mocks, and test coverage.

## Why This Matters

Cross-asset donations let a donor spend an issued asset they already hold while the recipient still receives XLM. This reduces client-side conversion work and keeps conversion logic under server control instead of trusting a client-supplied route.

## Request Changes

`POST /donations` now accepts these optional fields:

- `sourceAsset`: `"native"` or an object with `type`, `code`, and `issuer`
- `sourceAmount`: positive Stellar amount string

When `sourceAsset` and `sourceAmount` are omitted, the route continues to use the existing direct XLM donation flow.

Example body:

```json
{
  "donor": "GDONORPUBLICKEY...",
  "recipient": "GRECIPIENTPUBLICKEY...",
  "amount": "40",
  "sourceAsset": {
    "type": "credit_alphanum",
    "code": "USD",
    "issuer": "GISSUERPUBLICKEY..."
  },
  "sourceAmount": "50",
  "memo": "Cross asset donation"
}
```

## Path Estimate Endpoint

New endpoint:

- `GET /donations/path-estimate`

Supported query params:

- `sourceAsset`: `"native"` or JSON-encoded asset object
- `sourceAmount`: positive amount string
- `destAsset`: optional JSON-encoded asset object, defaults to native XLM
- `destAmount`: optional positive amount string

At least one of `sourceAmount` or `destAmount` must be provided.

Example:

```http
GET /donations/path-estimate?sourceAsset=%7B%22type%22%3A%22credit_alphanum%22%2C%22code%22%3A%22USD%22%2C%22issuer%22%3A%22GISSUER...%22%7D&sourceAmount=50
```

Example success shape:

```json
{
  "success": true,
  "data": {
    "sourceAsset": { "type": "credit_alphanum", "code": "USD", "issuer": "GISSUER..." },
    "sourceAmount": "50",
    "destAsset": { "type": "native", "code": "XLM", "issuer": null },
    "destAmount": "40.0000000",
    "conversionRate": "0.8000000",
    "path": []
  }
}
```

## Asset Format Rules

- Native XLM may be sent as `"native"` or `"XLM"`
- Issued assets must provide:
  - uppercase alphanumeric `code` with length `1-12`
  - valid Stellar public key `issuer`
- Malformed assets are rejected before any Stellar operation is attempted

## Path Discovery Behavior

- The server discovers the route using Stellar Horizon pathfinding
- The backend does not trust a client-supplied path for execution
- The selected route is deterministic:
  - same-asset requests return an empty path with a `1.0000000` conversion rate
  - Stellar DEX results use the best destination amount returned by Horizon

## Fallback Behavior

- If the client explicitly requests the extended source-asset flow, the backend attempts path-payment execution first
- If that execution fails and the source and destination assets are actually the same asset, the backend falls back to a direct payment
- Cross-asset failures do not silently degrade into a different economic transaction

## Validation Rules

- `amount` must remain a valid positive Stellar amount
- `sourceAsset` and `sourceAmount` must be supplied together
- `sourceAmount` must be positive when present
- `GET /donations/path-estimate` requires `sourceAsset` and at least one of `sourceAmount` or `destAmount`
- Invalid asset definitions, malformed JSON query values, and zero or negative amounts are rejected with a validation error

## Testing Notes

- Offline testing is handled through `MockStellarService`
- The mock now supports:
  - deterministic path estimates
  - path payment execution
  - no-path scenarios
  - forced path payment failures
  - same-asset fallback to direct payment
- No live Stellar network or Horizon access is required for the new tests

## Security Notes

- Asset input is normalized and validated before service execution
- The server discovers and validates the route instead of trusting caller-provided paths
- Fallback is narrowly scoped so a failed cross-asset request cannot be misreported as a different successful payment
- Error responses avoid leaking internal Horizon details beyond actionable validation or transaction failure messages
