# Validation Quick Reference

## Validation Rules Summary

| Field | Rule | Example |
|-------|------|---------|
| **amount** | Must be > 0 | ✅ `10.5` ❌ `0` ❌ `-5` |
| **Stellar Public Key** | Start with 'G', 56 chars | ✅ `GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H` |
| **Transaction Hash** | 64 hex characters | ✅ `a1b2c3...` (64 chars) |
| **Date Range** | Valid ISO dates, start ≤ end | ✅ `2024-01-01` to `2024-12-31` |
| **Wallet ID** | Must exist in database | Checked automatically |

## Error Codes

| Code | Meaning | HTTP Status |
|------|---------|-------------|
| `MISSING_FIELD` | Required field not provided | 400 |
| `MISSING_PARAMETER` | Required URL parameter missing | 400 |
| `MISSING_PARAMETERS` | Required query parameters missing | 400 |
| `INVALID_AMOUNT` | Amount ≤ 0 or not a number | 400 |
| `INVALID_STELLAR_ADDRESS` | Invalid Stellar public key format | 400 |
| `INVALID_TRANSACTION_HASH` | Invalid transaction hash format | 400 |
| `INVALID_DATE_RANGE` | Invalid date format or range | 400 |
| `INVALID_TRANSACTION` | Business logic violation | 400 |
| `WALLET_NOT_FOUND` | Wallet doesn't exist | 404 |
| `DONATION_NOT_FOUND` | Donation doesn't exist | 404 |
| `WALLET_EXISTS` | Duplicate wallet address | 409 |

## Endpoint Validation Matrix

| Endpoint | Validates |
|----------|-----------|
| `POST /donations` | amount (>0), recipient (required), donor (optional), Stellar addresses |
| `POST /donations/verify` | transactionHash (64 hex chars) |
| `GET /donations/:id` | id parameter |
| `GET /stats/*` | startDate, endDate (ISO format, valid range) |
| `POST /wallets` | name, walletAddress (Stellar format), no duplicates |
| `GET /wallets/:id` | id exists |
| `POST /wallets/lookup` | walletAddress (Stellar format) |

## Common Validation Patterns

### Valid Stellar Address
```
GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H
```
- Starts with 'G'
- Exactly 56 characters
- Base32 encoded (A-Z, 2-7)

### Valid Amount
```javascript
10      // Integer
10.5    // Decimal
"10.5"  // String representation
0.01    // Small amount
```

### Invalid Amount
```javascript
0       // Zero
-5      // Negative
"abc"   // Non-numeric
NaN     // Not a number
Infinity // Infinity
```

### Valid Date Range
```javascript
{
  startDate: "2024-01-01",
  endDate: "2024-12-31"
}
```

### Valid Transaction Hash
```
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```
- Exactly 64 characters
- Hexadecimal (0-9, a-f, A-F)

## Testing Validation

```bash
# Run all validation tests
npm test

# Run specific test suite
npm test -- tests/validation.test.js
npm test -- tests/validation-middleware.test.js

# Run with coverage
npm test:coverage
```

## Example Error Responses

### Missing Field
```json
{
  "success": false,
  "error": {
    "code": "MISSING_FIELD",
    "message": "Amount is required",
    "field": "amount"
  }
}
```

### Invalid Amount
```json
{
  "success": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Amount must be a positive number greater than 0",
    "field": "amount"
  }
}
```

### Invalid Stellar Address
```json
{
  "success": false,
  "error": {
    "code": "INVALID_STELLAR_ADDRESS",
    "message": "Invalid Stellar public key format. Must start with G and be 56 characters",
    "field": "walletAddress"
  }
}
```

### Resource Not Found
```json
{
  "success": false,
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet not found",
    "field": "id"
  }
}
```
