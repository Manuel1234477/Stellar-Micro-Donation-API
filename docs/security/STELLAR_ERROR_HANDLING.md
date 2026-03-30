# Stellar Error Handling

This document describes the comprehensive error handling implementation for Stellar SDK operations.

## Overview

All Stellar SDK operations are wrapped with error handling that:
- Catches and transforms technical errors into user-friendly messages
- Logs detailed error information internally for debugging
- Returns consistent error response format
- Prevents unhandled promise rejections

## Error Handler

### Location
`src/utils/stellarErrorHandler.js`

### Features

1. **Centralized Error Handling**: All Stellar errors are processed through a single handler
2. **Detailed Internal Logging**: Full error details (message, stack, response) logged with timestamp
3. **User-Friendly Messages**: Technical errors converted to clear, actionable messages
4. **Proper HTTP Status Codes**: Each error type mapped to appropriate status code

### Error Types Handled

| Error Type | Status Code | Error Code | Description |
|------------|-------------|------------|-------------|
| Network failure | 503 | NETWORK_ERROR | Unable to connect to Stellar network |
| Network timeout | 504 | NETWORK_TIMEOUT | Request timed out |
| Insufficient balance | 400 | INSUFFICIENT_BALANCE | Not enough funds for transaction |
| Invalid destination | 400 | INVALID_DESTINATION | Destination account doesn't exist |
| Account not funded | 400 | ACCOUNT_NOT_FUNDED | Destination needs minimum balance |
| Invalid credentials | 400 | INVALID_CREDENTIALS | Invalid secret key |
| Transaction failed | 400 | TRANSACTION_FAILED | Transaction rejected by network |
| Wallet not found | 404 | WALLET_NOT_FOUND | Wallet doesn't exist |
| Invalid transaction | 400 | INVALID_TRANSACTION | Same sender/recipient or other validation error |
| Transaction not found | 404 | TRANSACTION_NOT_FOUND | Transaction hash not found |
| Unknown error | 500 | STELLAR_ERROR | Generic error fallback |

## Usage

### In Services

The error handler is integrated into both `MockStellarService` and `StellarService`:

```javascript
const StellarErrorHandler = require('../utils/stellarErrorHandler');

async getBalance(publicKey) {
  return StellarErrorHandler.wrap(async () => {
    // Your Stellar SDK code here
    const wallet = this.wallets.get(publicKey);
    if (!wallet) {
      throw new Error(`Wallet not found: ${publicKey}`);
    }
    return { balance: wallet.balance, asset: 'XLM' };
  }, 'getBalance');
}
```

### In Routes

Routes handle errors with proper status codes:

```javascript
router.post('/verify', async (req, res) => {
  try {
    const result = await stellarService.verifyTransaction(transactionHash);
    res.json({ success: true, data: result });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || 'VERIFICATION_FAILED';
    const message = error.message || 'Failed to verify transaction';
    
    res.status(status).json({
      success: false,
      error: { code, message }
    });
  }
});
```

## Global Error Handler

### Location
`src/middleware/errorHandler.js`

Catches any unhandled errors in the Express application:

```javascript
const errorHandler = (err, req, res, next) => {
  // Logs detailed error internally
  console.error('[ErrorHandler]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Returns user-friendly response
  res.status(err.status || 500).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'An unexpected error occurred'
    }
  });
};
```

## Unhandled Promise Rejections

The application monitors for unhandled promise rejections:

```javascript
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UnhandledRejection]', {
    reason,
    promise,
    timestamp: new Date().toISOString()
  });
});
```

## Error Response Format

All errors follow a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "User-friendly error message"
  }
}
```

## Testing

Run the error handling test suite:

```bash
# Test with mock service
MOCK_STELLAR=true node test-error-handling.js

# Test with real service (will show not implemented errors)
node test-error-handling.js
```

### Test Coverage

The test suite verifies:
1. ✅ Wallet not found errors
2. ✅ Insufficient balance errors
3. ✅ Destination not funded errors
4. ✅ Same sender/recipient errors
5. ✅ Transaction not found errors
6. ✅ Successful transaction flow

## Examples

### Network Error
```json
{
  "success": false,
  "error": {
    "code": "NETWORK_ERROR",
    "message": "Unable to connect to Stellar network. Please try again later."
  }
}
```

### Insufficient Balance
```json
{
  "success": false,
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Insufficient balance to complete this transaction."
  }
}
```

### Invalid Destination
```json
{
  "success": false,
  "error": {
    "code": "INVALID_DESTINATION",
    "message": "Destination account does not exist or is invalid."
  }
}
```

## Logging

All errors are logged with full details for debugging:

```
[StellarError:sendDonation] {
  message: 'Insufficient balance to complete this transaction',
  stack: '...',
  response: {...},
  timestamp: '2026-02-20T15:59:51.218Z'
}
```

## Best Practices

1. **Always use error handler wrapper** for Stellar operations
2. **Never expose sensitive data** in error messages (secret keys, internal IDs)
3. **Log detailed errors internally** for debugging
4. **Return user-friendly messages** to clients
5. **Use appropriate HTTP status codes** for each error type
6. **Test error scenarios** thoroughly

## Acceptance Criteria Met

✅ **No unhandled promise rejections**: Global handler catches all rejections  
✅ **User-friendly error responses**: Clear, actionable messages for all error types  
✅ **Logs detailed errors internally**: Full error details logged with context and timestamp
