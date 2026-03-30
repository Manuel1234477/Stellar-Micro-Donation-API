# Idempotency for Donation Requests

## Overview

Idempotency ensures that donation requests are processed only once, even if the same request is submitted multiple times due to network issues, retries, or client errors. This prevents duplicate transactions and ensures data consistency.

## Table of Contents

- [What is Idempotency?](#what-is-idempotency)
- [How It Works](#how-it-works)
- [Implementation](#implementation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Best Practices](#best-practices)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## What is Idempotency?

**Idempotency** is a property of operations where performing the same operation multiple times has the same effect as performing it once. In the context of donation requests:

- **Problem**: Network failures, timeouts, or client retries can cause the same donation request to be sent multiple times
- **Risk**: Without idempotency, this could result in duplicate donations and financial losses
- **Solution**: Use idempotency keys to identify and deduplicate requests

### Example Scenario

```
Client sends: POST /donations with amount=100
Network timeout occurs
Client retries: POST /donations with amount=100 (same request)

Without idempotency: Two donations of 100 are created ❌
With idempotency: Only one donation of 100 is created ✅
```

---

## How It Works

### 1. Idempotency Key

Clients provide a unique **Idempotency-Key** header with each request:

```http
POST /donations
Idempotency-Key: donation_1234567890_abc123
Content-Type: application/json

{
  "amount": 100,
  "recipient": "GTEST123"
}
```

### 2. Request Processing

```
┌─────────────────────────────────────────────────────────────┐
│                    Request Flow                              │
└─────────────────────────────────────────────────────────────┘

1. Client sends request with Idempotency-Key
                    ↓
2. Server checks if key exists in database
                    ↓
        ┌───────────┴───────────┐
        │                       │
    Key exists            Key doesn't exist
        │                       │
        ↓                       ↓
3. Return cached         Process request
   response (200)               ↓
                         Store response
                         with key
                                ↓
                         Return response (201)
```

### 3. Request Hash

In addition to the idempotency key, the system generates a hash of the request body to detect duplicate requests with different keys:

```javascript
Request 1: Key=key1, Hash=abc123 → Processed
Request 2: Key=key2, Hash=abc123 → Warning: duplicate detected
```

### 4. TTL (Time To Live)

Idempotency records expire after 24 hours to prevent database bloat:

```
Created: 2024-01-01 10:00:00
Expires: 2024-01-02 10:00:00
After expiry: Key can be reused
```

---

## Implementation

### Database Schema

```sql
CREATE TABLE idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotencyKey VARCHAR(255) NOT NULL UNIQUE,
  requestHash VARCHAR(64) NOT NULL,
  response TEXT NOT NULL,
  userId INTEGER,
  createdAt DATETIME NOT NULL,
  expiresAt DATETIME NOT NULL,
  INDEX idx_idempotency_key (idempotencyKey),
  INDEX idx_request_hash (requestHash),
  INDEX idx_expires_at (expiresAt)
);
```

### Components

1. **IdempotencyService** (`src/services/IdempotencyService.js`)
   - Core logic for storing and retrieving idempotency records
   - Request hash generation
   - Key validation
   - Cleanup of expired records

2. **Idempotency Middleware** (`src/middleware/idempotencyMiddleware.js`)
   - Validates idempotency keys
   - Checks for existing records
   - Stores responses after successful processing
   - Detects duplicate requests

3. **Database Migration** (`src/scripts/addIdempotencyTable.js`)
   - Creates idempotency_keys table
   - Sets up indexes for performance

---

## Usage

### For API Clients

#### 1. Generate Idempotency Key

```javascript
// Option 1: UUID
const idempotencyKey = crypto.randomUUID();
// Example: "550e8400-e29b-41d4-a716-446655440000"

// Option 2: Timestamp + Random
const idempotencyKey = `donation_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
// Example: "donation_1234567890_a1b2c3d4e5f6g7h8"

// Option 3: Hash of request data
const idempotencyKey = crypto.createHash('sha256')
  .update(JSON.stringify(requestData))
  .digest('hex');
// Example: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
```

#### 2. Make Request with Idempotency Key

```javascript
const axios = require('axios');

async function createDonation(amount, recipient) {
  const idempotencyKey = `donation_${Date.now()}_${Math.random().toString(36)}`;
  
  try {
    const response = await axios.post('https://api.example.com/donations', {
      amount,
      recipient
    }, {
      headers: {
        'X-API-Key': 'your-api-key',
        'Idempotency-Key': idempotencyKey
      }
    });
    
    return response.data;
  } catch (error) {
    // Safe to retry with same idempotency key
    console.error('Request failed, retrying...');
    return retryRequest(idempotencyKey, amount, recipient);
  }
}
```

#### 3. Handle Responses

```javascript
// First request (201 Created)
{
  "success": true,
  "data": {
    "id": "123",
    "amount": 100,
    "recipient": "GTEST123"
  }
}

// Duplicate request (200 OK)
{
  "success": true,
  "data": {
    "id": "123",  // Same ID
    "amount": 100,
    "recipient": "GTEST123"
  },
  "_idempotent": true,
  "_originalTimestamp": "2024-01-01T10:00:00Z"
}
```

### For Server Implementation

#### 1. Apply Middleware to Routes

```javascript
const { requireIdempotency, storeIdempotencyResponse } = require('../middleware/idempotencyMiddleware');

// Require idempotency for donation endpoints
router.post('/donations', 
  requireApiKey,
  requireIdempotency,  // Add this middleware
  async (req, res) => {
    // Your handler logic
    const result = await processDonation(req.body);
    
    const response = {
      success: true,
      data: result
    };
    
    // Store response for future duplicate requests
    await storeIdempotencyResponse(req, response);
    
    res.status(201).json(response);
  }
);
```

#### 2. Optional Idempotency

For endpoints where idempotency is optional:

```javascript
const { optionalIdempotency } = require('../middleware/idempotencyMiddleware');

router.get('/donations', 
  optionalIdempotency,  // Idempotency if key provided
  async (req, res) => {
    // Handler logic
  }
);
```

#### 3. Cleanup Expired Keys

```javascript
const { cleanupExpiredKeys } = require('../middleware/idempotencyMiddleware');

// Run daily cleanup
setInterval(async () => {
  const deleted = await cleanupExpiredKeys();
  console.log(`Cleaned up ${deleted} expired idempotency keys`);
}, 24 * 60 * 60 * 1000); // Every 24 hours
```

---

## API Reference

### Idempotency-Key Header

**Format**: String (16-255 characters)  
**Allowed characters**: Alphanumeric, hyphens, underscores  
**Required**: Yes (for POST /donations and POST /donations/send)

```http
Idempotency-Key: donation_1234567890_abc123
```

### Response Fields

When a duplicate request is detected:

```json
{
  "success": true,
  "data": { /* original response data */ },
  "_idempotent": true,
  "_originalTimestamp": "2024-01-01T10:00:00Z"
}
```

### Warning Field

When duplicate request with different key is detected:

```json
{
  "success": true,
  "data": { /* response data */ },
  "warning": {
    "message": "Similar request detected with different idempotency key",
    "originalKey": "key1",
    "originalTimestamp": "2024-01-01T10:00:00Z"
  }
}
```

### Error Responses

#### Missing Idempotency Key

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "IDEMPOTENCY_KEY_REQUIRED",
    "message": "Idempotency-Key header is required for this operation"
  }
}
```

#### Invalid Idempotency Key

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "success": false,
  "error": {
    "code": "INVALID_IDEMPOTENCY_KEY",
    "message": "Idempotency key must be at least 16 characters long"
  }
}
```

---

## Best Practices

### 1. Key Generation

✅ **DO**:
- Use UUIDs or cryptographically random strings
- Include timestamp for debugging
- Make keys unique per request
- Store keys on client side for retries

❌ **DON'T**:
- Use sequential numbers (predictable)
- Reuse keys across different requests
- Use sensitive data in keys
- Make keys too short (< 16 characters)

### 2. Key Storage

✅ **DO**:
- Store keys in client-side database/cache
- Associate keys with request metadata
- Clean up old keys periodically
- Log key usage for debugging

❌ **DON'T**:
- Store keys in URLs (security risk)
- Share keys between users
- Expose keys in logs
- Keep keys indefinitely

### 3. Retry Logic

```javascript
async function makeRequestWithRetry(url, data, maxRetries = 3) {
  const idempotencyKey = generateIdempotencyKey();
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(url, data, {
        headers: {
          'Idempotency-Key': idempotencyKey  // Same key for all retries
        }
      });
      
      return response.data;
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
}
```

### 4. Error Handling

```javascript
try {
  const response = await createDonation(amount, recipient);
  
  if (response._idempotent) {
    console.log('Request was already processed');
    // Handle idempotent response
  } else {
    console.log('New request processed');
    // Handle new response
  }
  
  if (response.warning) {
    console.warn('Duplicate detected:', response.warning);
    // Alert user or log for investigation
  }
} catch (error) {
  if (error.code === 'IDEMPOTENCY_KEY_REQUIRED') {
    // Generate key and retry
  } else if (error.code === 'INVALID_IDEMPOTENCY_KEY') {
    // Fix key format and retry
  } else {
    // Handle other errors
  }
}
```

---

## Testing

### Unit Tests

```bash
npm test tests/idempotency.test.js
```

Tests cover:
- Key validation
- Request hash generation
- Store and retrieve operations
- Duplicate detection
- Cleanup functionality
- Statistics

### Integration Tests

```bash
npm test tests/idempotency-integration.test.js
```

Tests cover:
- End-to-end idempotency flow
- Concurrent requests
- Different key formats
- Error scenarios
- Duplicate detection

### Manual Testing

```bash
# Test idempotency
curl -X POST http://localhost:3000/donations \
  -H "X-API-Key: test-key" \
  -H "Idempotency-Key: test-123456789012345" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "GTEST123"}'

# Retry with same key (should return cached response)
curl -X POST http://localhost:3000/donations \
  -H "X-API-Key: test-key" \
  -H "Idempotency-Key: test-123456789012345" \
  -H "Content-Type: application/json" \
  -d '{"amount": 10, "recipient": "GTEST123"}'
```

---

## Troubleshooting

### Issue: "Idempotency key required" error

**Cause**: Missing Idempotency-Key header  
**Solution**: Add header to request

```javascript
headers: {
  'Idempotency-Key': 'your-unique-key'
}
```

### Issue: "Invalid idempotency key" error

**Cause**: Key doesn't meet format requirements  
**Solution**: Ensure key is 16-255 characters, alphanumeric with hyphens/underscores

```javascript
// ❌ Too short
'key123'

// ✅ Valid
'donation_1234567890_abc123'
```

### Issue: Different response for same key

**Cause**: Key expired (24 hour TTL)  
**Solution**: Generate new key for new requests

### Issue: Duplicate warning but different data

**Cause**: Same request data with different keys  
**Solution**: Review client logic to ensure unique keys per unique request

### Issue: Performance degradation

**Cause**: Too many expired records  
**Solution**: Run cleanup job

```javascript
const { cleanupExpiredKeys } = require('./middleware/idempotencyMiddleware');
await cleanupExpiredKeys();
```

---

## Monitoring

### Metrics to Track

1. **Idempotency Hit Rate**: Percentage of requests that are duplicates
2. **Key Reuse**: How often same keys are used
3. **Cleanup Efficiency**: Number of expired keys removed
4. **Storage Growth**: Size of idempotency_keys table

### Logging

```javascript
// Log idempotent requests
console.log('[Idempotency] Returning cached response', {
  key: idempotencyKey,
  originalTimestamp: record.createdAt,
  userId: req.user?.id
});

// Log duplicate detection
console.warn('[Idempotency] Duplicate request detected', {
  newKey: idempotencyKey,
  originalKey: duplicate.idempotencyKey,
  requestHash: requestHash
});
```

---

## Security Considerations

1. **Key Uniqueness**: Ensure keys are cryptographically random
2. **Key Length**: Minimum 16 characters to prevent brute force
3. **TTL**: 24-hour expiry prevents indefinite storage
4. **User Isolation**: Keys are scoped to user ID
5. **Rate Limiting**: Combine with rate limiting for additional protection

---

## Performance

### Database Indexes

```sql
CREATE INDEX idx_idempotency_key ON idempotency_keys(idempotencyKey);
CREATE INDEX idx_request_hash ON idempotency_keys(requestHash);
CREATE INDEX idx_expires_at ON idempotency_keys(expiresAt);
```

### Optimization Tips

1. **Regular Cleanup**: Run cleanup job daily
2. **Index Maintenance**: Rebuild indexes periodically
3. **Cache Layer**: Consider Redis for high-traffic scenarios
4. **Partitioning**: Partition table by date for large datasets

---

## Future Enhancements

1. **Redis Integration**: Use Redis for faster lookups
2. **Configurable TTL**: Allow custom expiry per endpoint
3. **Batch Operations**: Support idempotency for batch requests
4. **Analytics Dashboard**: Visualize idempotency metrics
5. **Automatic Cleanup**: Background job for expired keys

---

## References

- [RFC 7231 - HTTP Idempotency](https://tools.ietf.org/html/rfc7231#section-4.2.2)
- [Stripe API Idempotency](https://stripe.com/docs/api/idempotent_requests)
- [AWS API Gateway Idempotency](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-idempotency.html)

---

**Last Updated**: February 22, 2026  
**Version**: 1.0.0  
**Status**: Production Ready
