# API Request Validation

This document describes the comprehensive validation implemented across all API endpoints.

## Overview

All API endpoints now include robust input validation to ensure data integrity and security. Validation is implemented through:

1. **Validation Utilities** (`src/utils/validators.js`) - Core validation functions
2. **Validation Middleware** (`src/middleware/validation.js`) - Express middleware for route protection
3. **Consistent Error Responses** - Standardized error format across all endpoints

## Validation Rules

### Amount Validation

- Must be a positive number
- Must be greater than 0
- Cannot be NaN, Infinity, or negative
- Accepts both numeric and string representations

```javascript
// Valid
amount: 10
amount: "10.5"
amount: 0.01

// Invalid
amount: 0
amount: -5
amount: "abc"
```

### Stellar Address Validation

Public keys must:
- Start with 'G'
- Be exactly 56 characters long
- Contain only valid base32 characters (A-Z, 2-7)

```javascript
// Valid
"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"

// Invalid
"SBRPYHIL..." // Starts with S (secret key)
"GBRPYHIL" // Too short
"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2!" // Invalid char
```

### Transaction Hash Validation

- Must be exactly 64 characters
- Must contain only hexadecimal characters (0-9, a-f, A-F)

```javascript
// Valid
"a1b2c3d4e5f6..." // 64 hex chars

// Invalid
"abc123" // Too short
"xyz..." // Non-hex characters
```

### Date Range Validation

- Both startDate and endDate required
- Must be valid ISO date format
- startDate must be before or equal to endDate

```javascript
// Valid
startDate: "2024-01-01"
endDate: "2024-12-31"

// Invalid
startDate: "invalid"
startDate: "2024-12-31", endDate: "2024-01-01" // Reversed
```

### Wallet ID Validation

- Must exist in the database
- Returns 404 if wallet not found

## Endpoint Validation

### POST /donations

Validates:
- `amount` - Required, must be > 0
- `recipient` - Required, validated as Stellar address if starts with 'G'
- `donor` - Optional, validated as Stellar address if starts with 'G'
- Ensures donor and recipient are different

Error Codes:
- `MISSING_FIELD` - Required field missing
- `INVALID_AMOUNT` - Amount validation failed
- `INVALID_STELLAR_ADDRESS` - Invalid Stellar public key format
- `INVALID_TRANSACTION` - Donor and recipient are the same

### POST /donations/verify

Validates:
- `transactionHash` - Required, must be 64-char hex string

Error Codes:
- `MISSING_FIELD` - Transaction hash missing
- `INVALID_TRANSACTION_HASH` - Invalid hash format

### GET /stats/* (all stats endpoints)

Validates:
- `startDate` - Required query parameter
- `endDate` - Required query parameter
- Date range validity

Error Codes:
- `MISSING_PARAMETERS` - Missing date parameters
- `INVALID_DATE_RANGE` - Invalid date format or range

### POST /wallets

Validates:
- `name` - Required
- `walletAddress` - Required, must be valid Stellar public key
- Checks for duplicate wallet addresses

Error Codes:
- `MISSING_FIELD` - Required field missing
- `INVALID_STELLAR_ADDRESS` - Invalid Stellar address format
- `WALLET_EXISTS` - Wallet address already registered (409 status)

### GET /wallets/:id

Validates:
- `id` - Must exist in database

Error Codes:
- `MISSING_PARAMETER` - ID parameter missing
- `WALLET_NOT_FOUND` - Wallet doesn't exist (404 status)

### POST /wallets/lookup

Validates:
- `walletAddress` - Required, must be valid Stellar public key

Error Codes:
- `MISSING_FIELD` - Wallet address missing
- `INVALID_STELLAR_ADDRESS` - Invalid address format
- `WALLET_NOT_FOUND` - No wallet with this address (404 status)

## Error Response Format

All validation errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "field": "fieldName"
  }
}
```

HTTP Status Codes:
- `400` - Bad Request (validation failed)
- `404` - Not Found (resource doesn't exist)
- `409` - Conflict (duplicate resource)
- `500` - Internal Server Error

## Testing

Comprehensive test suites are provided:

1. **Unit Tests** (`tests/validation.test.js`)
   - Tests all validation utility functions
   - Covers edge cases and boundary conditions

2. **Integration Tests** (`tests/validation-middleware.test.js`)
   - Tests validation middleware on actual routes
   - Verifies error responses and status codes

Run tests:
```bash
npm test
npm test -- tests/validation.test.js
npm test -- tests/validation-middleware.test.js
```

## Usage Examples

### Creating a Donation

```javascript
// Valid request
POST /donations
{
  "amount": 10.5,
  "donor": "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
  "recipient": "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37"
}

// Response: 201 Created
{
  "success": true,
  "data": {
    "id": "1234567890",
    "amount": 10.5,
    "donor": "GBRP...",
    "recipient": "GDQP...",
    "timestamp": "2024-01-01T00:00:00.000Z",
    "status": "completed"
  }
}
```

### Invalid Amount

```javascript
POST /donations
{
  "amount": -5,
  "recipient": "test-recipient"
}

// Response: 400 Bad Request
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

```javascript
POST /wallets
{
  "name": "Test User",
  "walletAddress": "INVALID123"
}

// Response: 400 Bad Request
{
  "success": false,
  "error": {
    "code": "INVALID_STELLAR_ADDRESS",
    "message": "Invalid Stellar public key format. Must start with G and be 56 characters",
    "field": "walletAddress"
  }
}
```

## Implementation Details

### Middleware Chain

Validation middleware is applied before route handlers:

```javascript
router.post('/', validateDonationCreate, (req, res) => {
  // Only executes if validation passes
});
```

### Reusable Validators

Common validation logic is extracted into reusable functions:

```javascript
const { isValidStellarPublicKey, isValidAmount } = require('../utils/validators');

if (!isValidAmount(amount)) {
  // Handle error
}
```

### Custom Validators

Create custom validators for specific needs:

```javascript
const validatePublicKey = (fieldName = 'publicKey') => {
  return (req, res, next) => {
    // Validation logic
  };
};
```

## Security Considerations

1. **Input Sanitization** - All string inputs are trimmed
2. **Type Checking** - Strict type validation prevents type coercion attacks
3. **Format Validation** - Regex patterns ensure correct format
4. **Existence Checks** - Database lookups verify resource existence
5. **Duplicate Prevention** - Checks prevent duplicate wallet registrations

## Future Enhancements

Potential improvements:
- Rate limiting per wallet address
- Advanced amount validation (min/max limits)
- Memo field validation for transactions
- Multi-signature validation
- Asset type validation (beyond XLM)
