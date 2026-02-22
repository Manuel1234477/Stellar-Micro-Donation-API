# Error Handling Documentation

## Overview

This API uses a unified error handling system that provides consistent error responses across all endpoints. All errors follow the same JSON structure and use standardized error codes.

## Error Response Format

All error responses follow this structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}, // Optional: Additional context
    "timestamp": "2024-02-22T10:30:00.000Z"
  }
}
```

## HTTP Status Codes

| Status Code | Description | When Used |
|------------|-------------|-----------|
| 400 | Bad Request | Validation errors, invalid input |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 422 | Unprocessable Entity | Business logic errors |
| 500 | Internal Server Error | Server-side errors |

## Error Codes

### Validation Errors (400)

| Code | Description | Example |
|------|-------------|---------|
| `VALIDATION_ERROR` | Generic validation failure | Invalid data format |
| `INVALID_REQUEST` | Missing or malformed request | Missing required field |
| `INVALID_LIMIT` | Invalid pagination limit | Limit must be positive |
| `INVALID_OFFSET` | Invalid pagination offset | Offset must be non-negative |
| `INVALID_DATE_FORMAT` | Date format is incorrect | Use ISO 8601 format |
| `INVALID_AMOUNT` | Amount value is invalid | Amount must be positive |
| `INVALID_FREQUENCY` | Frequency value is invalid | Must be daily/weekly/monthly |
| `MISSING_REQUIRED_FIELD` | Required field is missing | Field 'amount' is required |
| `IDEMPOTENCY_KEY_REQUIRED` | Idempotency key header missing | Header 'idempotency-key' required |

### Authentication/Authorization Errors (401, 403)

| Code | Description | Example |
|------|-------------|---------|
| `UNAUTHORIZED` | Not authenticated | No valid session |
| `ACCESS_DENIED` | Insufficient permissions | User lacks required role |
| `INSUFFICIENT_PERMISSIONS` | Missing specific permission | Cannot access this resource |

### Not Found Errors (404)

| Code | Description | Example |
|------|-------------|---------|
| `NOT_FOUND` | Generic resource not found | Resource doesn't exist |
| `WALLET_NOT_FOUND` | Wallet doesn't exist | Invalid wallet address |
| `TRANSACTION_NOT_FOUND` | Transaction doesn't exist | Invalid transaction hash |
| `USER_NOT_FOUND` | User doesn't exist | User ID not found |
| `DONATION_NOT_FOUND` | Donation doesn't exist | Donation ID not found |
| `ENDPOINT_NOT_FOUND` | API endpoint doesn't exist | Invalid route |

### Business Logic Errors (422)

| Code | Description | Example |
|------|-------------|---------|
| `DUPLICATE_TRANSACTION` | Transaction already exists | Idempotency key conflict |
| `INSUFFICIENT_BALANCE` | Not enough funds | Balance too low |
| `TRANSACTION_FAILED` | Transaction couldn't complete | Network error |

### Server Errors (500)

| Code | Description | Example |
|------|-------------|---------|
| `INTERNAL_ERROR` | Unexpected server error | Unhandled exception |
| `DATABASE_ERROR` | Database operation failed | Connection timeout |
| `VERIFICATION_FAILED` | Verification process failed | External service error |
| `SERVICE_UNAVAILABLE` | Service temporarily unavailable | Maintenance mode |

## Example Error Responses

### Validation Error

```json
{
  "success": false,
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Amount must be a positive number",
    "timestamp": "2024-02-22T10:30:00.000Z"
  }
}
```

### Not Found Error

```json
{
  "success": false,
  "error": {
    "code": "WALLET_NOT_FOUND",
    "message": "Wallet not found: GABCD1234...",
    "timestamp": "2024-02-22T10:30:00.000Z"
  }
}
```

### Database Error

```json
{
  "success": false,
  "error": {
    "code": "DATABASE_ERROR",
    "message": "Database query failed",
    "details": {
      "originalError": "SQLITE_BUSY: database is locked"
    },
    "timestamp": "2024-02-22T10:30:00.000Z"
  }
}
```

### Authorization Error

```json
{
  "success": false,
  "error": {
    "code": "ACCESS_DENIED",
    "message": "Insufficient permissions for this action",
    "timestamp": "2024-02-22T10:30:00.000Z"
  }
}
```

## Success Response Format

Successful responses follow this structure:

```json
{
  "success": true,
  "data": {
    // Response data
  }
}
```

## Implementation Guide

### For Developers

#### Using Error Classes in Routes

```javascript
const { ValidationError, NotFoundError, ERROR_CODES } = require('../utils/errors');

router.post('/example', async (req, res, next) => {
  try {
    const { amount } = req.body;
    
    // Validation
    if (!amount) {
      throw new ValidationError(
        'Amount is required',
        null,
        ERROR_CODES.MISSING_REQUIRED_FIELD
      );
    }
    
    // Business logic
    const result = await someService.process(amount);
    
    if (!result) {
      throw new NotFoundError(
        'Resource not found',
        ERROR_CODES.NOT_FOUND
      );
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error); // Pass to error handler
  }
});
```

#### Using Error Classes in Services

```javascript
const { NotFoundError, BusinessLogicError, ERROR_CODES } = require('../utils/errors');

class MyService {
  async getWallet(publicKey) {
    const wallet = await db.findWallet(publicKey);
    
    if (!wallet) {
      throw new NotFoundError(
        `Wallet not found: ${publicKey}`,
        ERROR_CODES.WALLET_NOT_FOUND
      );
    }
    
    return wallet;
  }
  
  async transfer(from, to, amount) {
    if (amount <= 0) {
      throw new BusinessLogicError(
        ERROR_CODES.INVALID_AMOUNT,
        'Transfer amount must be positive'
      );
    }
    
    // ... transfer logic
  }
}
```

### Available Error Classes

- `ValidationError` - For input validation failures (400)
- `UnauthorizedError` - For authentication failures (401)
- `ForbiddenError` - For authorization failures (403)
- `NotFoundError` - For missing resources (404)
- `BusinessLogicError` - For business rule violations (422)
- `InternalError` - For unexpected server errors (500)
- `DatabaseError` - For database operation failures (500)

## Migration Guide

### Before (Inconsistent)

```javascript
// Old inconsistent patterns
res.status(400).json({ error: 'Invalid input' });
res.status(404).json({ error: 'Not found', message: 'User not found' });
res.status(500).json({ success: false, error: { code: 'ERROR', message: 'Failed' } });
```

### After (Unified)

```javascript
// New unified pattern
throw new ValidationError('Invalid input');
throw new NotFoundError('User not found', ERROR_CODES.USER_NOT_FOUND);
throw new InternalError('Operation failed');
```

## Testing Error Responses

### Example Test Cases

```javascript
describe('Error Handling', () => {
  it('should return 400 for invalid amount', async () => {
    const response = await request(app)
      .post('/donations')
      .send({ amount: -10 });
    
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: 'INVALID_AMOUNT',
        message: expect.any(String),
        timestamp: expect.any(String)
      }
    });
  });
  
  it('should return 404 for missing wallet', async () => {
    const response = await request(app)
      .get('/wallets/INVALID');
    
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('WALLET_NOT_FOUND');
  });
});
```

## Best Practices

1. **Always use error classes** - Never manually construct error responses
2. **Use appropriate error codes** - Choose the most specific code available
3. **Provide helpful messages** - Include context to help debugging
4. **Pass errors to middleware** - Use `next(error)` in async routes
5. **Don't expose sensitive data** - Keep error details safe in production
6. **Log errors properly** - All errors are logged with context
7. **Use try-catch blocks** - Wrap async operations properly

## Troubleshooting

### Common Issues

**Issue**: Errors not being caught by middleware
- **Solution**: Ensure you're calling `next(error)` in async routes

**Issue**: Custom error not returning correct status code
- **Solution**: Verify you're using the correct error class

**Issue**: Error details exposing sensitive information
- **Solution**: Check `NODE_ENV` and sanitize error details in production

## Additional Resources

- Error utility: `src/utils/errors.js`
- Error middleware: `src/middleware/errorHandler.js`
- Example implementation: `src/routes/donation.js`
