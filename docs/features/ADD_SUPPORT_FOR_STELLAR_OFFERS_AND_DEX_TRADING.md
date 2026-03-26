# Stellar Offers and DEX Trading

Enables the API to create, manage, and query offers on the Stellar Decentralised Exchange (DEX), allowing donation platforms to perform automatic asset conversion at market rates.

## Overview

The Stellar DEX lets accounts post offers to buy or sell any asset pair. This feature exposes that capability through four HTTP endpoints and three new service methods.

## Service Methods

### `StellarService` / `MockStellarService`

#### `createOffer({ sourceSecret, sellingAsset, buyingAsset, amount, price, offerId? })`

Creates (or updates) a sell offer on the Stellar DEX using `manageSellOffer`.

| Param | Type | Description |
|---|---|---|
| `sourceSecret` | string | Seller's Stellar secret key |
| `sellingAsset` | string | Asset to sell: `'XLM'` or `'CODE:ISSUER'` |
| `buyingAsset` | string | Asset to buy: `'XLM'` or `'CODE:ISSUER'` |
| `amount` | string | Amount of selling asset |
| `price` | string | Price as `'n/d'` ratio or decimal string |
| `offerId` | number | `0` to create new; existing ID to update (optional, default `0`) |

Returns `{ offerId, transactionId, ledger }`.

#### `cancelOffer({ sourceSecret, sellingAsset, buyingAsset, offerId })`

Cancels an existing offer by submitting `manageSellOffer` with `amount = '0'`.

Returns `{ transactionId, ledger }`.

#### `getOrderBook(sellingAsset, buyingAsset, limit?)`

Queries the Horizon order book for a trading pair.

| Param | Type | Description |
|---|---|---|
| `sellingAsset` | string | Base asset |
| `buyingAsset` | string | Counter asset |
| `limit` | number | Max bids/asks to return (default `20`) |

Returns `{ bids, asks, base, counter }`.

## HTTP Endpoints

### `POST /offers`

Create a new DEX sell offer.

**Auth:** `x-api-key` header required.

**Request body:**
```json
{
  "sourceSecret": "S...",
  "sellingAsset": "XLM",
  "buyingAsset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "amount": "100",
  "price": "0.25"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": { "offerId": 1711234567890, "transactionId": "abc123...", "ledger": 1234567 }
}
```

---

### `GET /offers`

List all active offers tracked by this API instance.

**Auth:** `x-api-key` header required.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1711234567890,
      "sellingAsset": "XLM",
      "buyingAsset": "USDC:GBBD47...",
      "amount": "100",
      "price": "0.25",
      "status": "active",
      "createdAt": "2026-03-24T20:00:00.000Z"
    }
  ]
}
```

---

### `DELETE /offers/:id`

Cancel an existing offer.

**Auth:** `x-api-key` header required.

**Request body:**
```json
{
  "sourceSecret": "S...",
  "sellingAsset": "XLM",
  "buyingAsset": "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": { "transactionId": "def456...", "ledger": 1234568 }
}
```

---

### `GET /orderbook/:baseAsset/:counterAsset`

Query the DEX order book for a trading pair. Asset parameters must be URL-encoded when they contain a colon (e.g. `USDC%3AGBBD47...`).

**Auth:** `x-api-key` header required.

**Query params:**
- `limit` – max bids/asks per side (default `20`, max `200`)

**Example:**
```
GET /orderbook/XLM/USDC%3AGBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5?limit=10
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "bids": [{ "price": "0.24", "amount": "500.0000000", "price_r": { "n": 6, "d": 25 } }],
    "asks": [{ "price": "0.25", "amount": "100.0000000", "price_r": { "n": 1, "d": 4 } }],
    "base": { "asset_type": "native" },
    "counter": { "asset_type": "credit_alphanum4", "asset_code": "USDC", "asset_issuer": "GBBD47..." }
  }
}
```

## Asset Format

| Value | Meaning |
|---|---|
| `XLM` or `native` | Stellar's native asset (case-insensitive) |
| `CODE:ISSUER` | Custom asset, e.g. `USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |

## Security Notes

- `sourceSecret` is never logged or stored; it is used only to sign the transaction in-process.
- All endpoints require a valid API key.
- The offer store is in-memory; a production deployment should persist offer metadata to the database.

## Testing

```bash
npm test tests/add-support-for-stellar-offers-and-dex-trading.test.js
```

No live Stellar network is required. All tests use `MockStellarService`.
