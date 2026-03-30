# Multi-Currency Donations

Donors can submit donations in USD, EUR, BTC, or XLM. The API converts non-XLM amounts to XLM at submission time using live rates from CoinGecko, and stores both the original and converted amounts for reporting.

## Supported Currencies

| Code | Type   |
|------|--------|
| XLM  | Native |
| USD  | Fiat   |
| EUR  | Fiat   |
| BTC  | Crypto |

## How It Works

1. Donor submits `POST /donations` with an `amount` and optional `currency` (default: `XLM`).
2. If `currency` is not `XLM`, `PriceOracleService` fetches the live XLM rate from CoinGecko.
3. The XLM equivalent is calculated and used for the on-chain transaction.
4. The transaction record stores `originalAmount`, `originalCurrency`, and `conversionRate`.

## Rate Caching

Conversion rates are cached in-memory for **60 seconds** to avoid excessive CoinGecko calls. If the oracle is unavailable, the last cached rates are served. If no cache exists and the oracle fails, the request returns a `400` error.

## API

### POST /donations

```json
{
  "amount": "10",
  "currency": "USD",
  "recipient": "GXXX...",
  "memo": "optional"
}
```

**Response (201)**

```json
{
  "success": true,
  "data": {
    "id": "abc-123",
    "amount": 100,
    "originalAmount": 10,
    "originalCurrency": "USD",
    "conversionRate": 0.10,
    "recipient": "GXXX...",
    "status": "pending"
  }
}
```

`amount` is always in XLM. `originalAmount` and `originalCurrency` are only present for non-XLM donations.

### GET /donations/:id

Returns the same fields as above, including `originalAmount`, `originalCurrency`, and `conversionRate` when the donation was submitted in a non-XLM currency.

### GET /stats/currency-breakdown

Returns donation totals grouped by original currency.

**Response (200)**

```json
{
  "success": true,
  "data": [
    {
      "currency": "USD",
      "count": 42,
      "totalOriginalAmount": 420.00,
      "totalXlmAmount": 4200.0000000
    },
    {
      "currency": "XLM",
      "count": 10,
      "totalOriginalAmount": 500.0000000,
      "totalXlmAmount": 500.0000000
    }
  ],
  "metadata": { "generatedAt": "2026-03-30T12:00:00.000Z" }
}
```

## Error Handling

| Scenario | HTTP Status | Error Code |
|---|---|---|
| Unsupported currency | 400 | `UNSUPPORTED_CURRENCY` |
| Oracle unavailable, no cache | 400 | `VALIDATION_ERROR` (currency conversion failed) |
| Invalid amount | 400 | `INVALID_AMOUNT` |

## Database

The `transactions` table (JSON store) persists:

- `originalAmount` — the amount as submitted by the donor
- `originalCurrency` — the currency code (e.g. `USD`)
- `conversionRate` — the XLM price in the original currency at submission time (e.g. `0.10` means 1 XLM = $0.10)
- `amount` — always the XLM equivalent used on-chain

For XLM donations, `originalAmount`, `originalCurrency`, and `conversionRate` are omitted.
