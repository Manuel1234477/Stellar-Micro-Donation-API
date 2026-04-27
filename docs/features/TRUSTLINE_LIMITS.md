# Trustline Limits — Stellar Change Trust with Limit

**Issue #421** — Fine-grained risk management via custom trust limits on Stellar asset trustlines.

## Overview

A Stellar trustline declares that an account is willing to hold a custom asset. The `changeTrust` operation accepts an optional `limit` — the maximum amount of the asset the account is willing to hold. This feature exposes that limit through the API.

## Stellar Constraints

- Limits are **strings** to preserve decimal precision (Stellar uses 7 decimal places).
- The network maximum is **`922337203685.4775807`** (int64 max ÷ 10^7).
- Setting `limit` to `null` / omitting it uses the network maximum (effectively unlimited).
- Setting `limit` to `"0"` removes the trustline (not supported by these endpoints — use a dedicated remove endpoint).

## New / Modified Files

| File | Change |
|------|--------|
| `src/services/StellarService.js` | Added `addTrustline(accountSecret, assetCode, issuerPublic, limit)` |
| `src/services/MockStellarService.js` | Added `addTrustline(...)` + `getTrustline(...)` test helper |
| `src/routes/wallet.js` | Added `POST /wallets/:id/trustlines` and `PATCH /wallets/:id/trustlines/:asset` |
| `tests/trustline-limit.test.js` | 29 tests, all passing |
| `docs/features/TRUSTLINE_LIMITS.md` | This document |

## API

### `POST /wallets/:id/trustlines`

Create a trustline for a custom asset. Optionally set a trust limit.

**Request body:**
```json
{
  "secretKey":    "S...",
  "assetCode":    "USDC",
  "issuerPublic": "G...",
  "limit":        "1000"
}
```

- `limit` is optional. Omit or set to `null` for unlimited (network max).
- `limit` must be a positive numeric string ≤ `"922337203685.4775807"`.

**Response `201 Created`:**
```json
{
  "success": true,
  "data": {
    "hash":        "abc123...",
    "ledger":      12345678,
    "assetCode":   "USDC",
    "issuerPublic": "G...",
    "limit":       "1000"
  }
}
```

**Response `400 Bad Request`** (invalid limit):
```json
{
  "success": false,
  "error": { "code": "INVALID_LIMIT", "message": "limit must be a positive numeric string" }
}
```

---

### `PATCH /wallets/:id/trustlines/:asset`

Update the trust limit for an existing trustline without removing it.

**URL params:** `:asset` — the asset code (e.g. `USDC`)

**Request body:**
```json
{
  "secretKey":    "S...",
  "issuerPublic": "G...",
  "limit":        "2000"
}
```

- `limit` is **required** for this endpoint.

**Response `200 OK`:**
```json
{
  "success": true,
  "data": {
    "hash":        "def456...",
    "ledger":      12345679,
    "assetCode":   "USDC",
    "issuerPublic": "G...",
    "limit":       "2000"
  }
}
```

## JSDoc Reference

### `StellarService.addTrustline`

```js
/**
 * Create or update a trustline for a custom Stellar asset.
 *
 * Uses the Stellar SDK `changeTrust` operation. Omitting `limit` (or passing
 * `null`) sets the trustline to the network maximum (unlimited).
 *
 * @param {string}      accountSecret - Secret key of the account establishing the trustline
 * @param {string}      assetCode     - Asset code (1-12 alphanumeric characters)
 * @param {string}      issuerPublic  - Public key of the asset issuer
 * @param {string|null} [limit]       - Maximum amount to trust as a string. Must be a
 *   positive numeric string ≤ "922337203685.4775807". Omit or pass null for unlimited.
 * @returns {Promise<{hash: string, ledger: number, assetCode: string, issuerPublic: string, limit: string}>}
 * @throws {ValidationError}    If inputs are invalid or limit exceeds Stellar maximum
 * @throws {BusinessLogicError} If the Stellar operation fails
 */
```

### `MockStellarService.addTrustline`

Same signature as `StellarService.addTrustline`. Stores trustline state in `this.trustlines` (a `Map`) for test assertions.

### `MockStellarService.getTrustline` (test helper)

```js
/**
 * Retrieve a stored trustline from mock state.
 * @param {string} accountPublic - Public key of the trusting account
 * @param {string} assetCode     - Asset code
 * @param {string} issuerPublic  - Issuer public key
 * @returns {{ assetCode, issuerPublic, limit, accountPublic } | undefined}
 */
```

## Testing

```bash
npm test tests/trustline-limit.test.js
```

Test cases covered:
1. Trustline creation with a custom limit
2. Limit update via PATCH (stored state changes)
3. Error handling: negative, zero, non-numeric, exceeding max
4. No limit provided → defaults to network maximum
