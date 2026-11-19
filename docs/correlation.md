# Correlation ID Propagation

## Overview

Correlation IDs provide end-to-end request tracing across all systems: APIs, webhooks, background jobs, and databases. A single correlation ID ties together all work that belongs to one logical operation, making debugging and incident response tractable.

## Architecture

### Correlation Context

Every request gets a correlation context containing:

```javascript
{
  correlationId: "uuid-v4",         // Primary identifier for the request
  traceId: "uuid-v4",                // End-to-end trace ID (usually same as correlationId)
  operationId: "uuid-v4",            // Unique ID for this operation
  requestId: "uuid-v4",              // Original HTTP request ID
  parentCorrelationId: "uuid-v4"     // If this is async work spawned from a request
}
```

### Propagation Chain

```
HTTP Request
    ↓ (middleware sets correlationId)
    ↓
Logger (automatic inclusion in all logs)
Request Processing
    ├─→ Database queries (context available)
    ├─→ Stellar operations (context available)
    ├─→ Webhook delivery (headers sent)
    └─→ Background jobs (context inherited)
         ↓ (async context carries parentCorrelationId)
         ↓
      Webhook sent with X-Correlation-ID header
      Log lines include correlationId
      Database records audited with correlationId
```

## Implementation Details

### 1. HTTP Requests

Correlation context is automatically initialized in the request middleware:

```javascript
// src/middleware/requestId.js
const correlationUtils = require('../utils/correlation');

// Creates correlation context from inbound headers or generates new IDs
context = correlationUtils.createCorrelationContext({
  requestId,
  correlationId: inboundHeaders.correlationId || undefined,
  traceId: inboundHeaders.traceId || undefined,
  operationType: 'http_request',
  metadata: { method, path, userAgent, ip, initiatedAt }
});

correlationUtils.setCorrelationContext(context);
```

**Inbound Headers:**
- `X-Correlation-ID`: If present, reused; otherwise generated
- `X-Trace-ID`: If present, reused; otherwise set to correlationId
- `X-Operation-ID`: New operation ID always generated

**Outbound Response Headers:**
- `X-Request-ID`: HTTP request ID
- `X-Correlation-ID`: Correlation ID
- `X-Trace-ID`: Trace ID

### 2. Logging

All log lines automatically include correlation fields via `log.setContext()`:

```javascript
// Automatically called in requestId middleware
log.setContext({
  requestId,
  correlationId: context.correlationId,
  traceId: context.traceId,
  route: req.path
});

// Usage: correlation fields are auto-included
log.info('Service', 'Processing donation', { amount: 100 });
// Output: {..., "correlationId": "abc-123", "traceId": "abc-123", ...}
```

### 3. Webhook Deliveries

When sending webhooks, correlation headers are automatically included:

```javascript
// src/services/WebhookService.js
const correlationHeaders = generateCorrelationHeaders();

// Headers added to every webhook POST request
const options = {
  headers: {
    'Content-Type': 'application/json',
    'X-Signature': `sha256=${signature}`,
    ...correlationHeaders  // ← Automatically includes X-Correlation-ID, X-Trace-ID, X-Operation-ID
  }
};

// Payload also includes correlation context for reference
const body = JSON.stringify({
  event,
  data: payload,
  correlationContext: {
    correlationId: correlationHeaders['X-Correlation-ID'],
    traceId: correlationHeaders['X-Trace-ID'],
    operationId: correlationHeaders['X-Operation-ID']
  }
});
```

**Webhook Headers Sent:**
- `X-Correlation-ID`: Correlation ID from originating request
- `X-Trace-ID`: Trace ID from originating request
- `X-Operation-ID`: Operation ID from webhook delivery
- `X-Signature`: Webhook signature
- `X-Signature-Timestamp`: Signature timestamp

### 4. Background Jobs & Async Operations

Background tasks spawned from a request inherit the parent's correlation ID:

```javascript
const { createAsyncContext, withAsyncContext } = require('./utils/correlation');

// In request handler:
async function handleDonation(req, res) {
  // ... process donation ...
  
  // Fire-and-forget webhook delivery with inherited correlation
  withAsyncContext('webhook_delivery', async () => {
    await sendWebhook(webhookData);
  }, {
    parentRequestId: req.correlationContext.requestId
  }).catch(() => {});
}
```

**Context Inheritance:**
- Parent `correlationId` → Child `parentCorrelationId`
- Parent `traceId` → Child `traceId` (inherited)
- Parent `requestId` → Child `requestId` (inherited)
- New `operationId` generated for this async operation

**Log Output:**
```json
{
  "correlationId": "parent-123",  // Same as parent
  "traceId": "parent-123",
  "parentCorrelationId": "parent-123",
  "operationId": "op-456"  // New operation in async context
}
```

### 5. Database Operations

Correlation IDs are available to database services for audit logging:

```javascript
const { getCorrelationContext } = require('./utils/correlation');

async function recordDonation(amount) {
  const { correlationId } = getCorrelationContext();
  
  await Database.run(
    `INSERT INTO donations (amount, correlation_id) VALUES (?, ?)`,
    [amount, correlationId]
  );
}
```

### 6. Stellar Operations

When interacting with Stellar network:

```javascript
const { getCorrelationContext } = require('./utils/correlation');

class StellarService {
  async submitTransaction(xdr) {
    const { correlationId, operationId } = getCorrelationContext();
    
    log.info('STELLAR', 'Submitting transaction', {
      correlationId,
      operationId,
      txSize: xdr.length
    });
    
    // Include correlation ID in request if possible
    const result = await this.horizon.submitTransaction(xdr);
    
    log.info('STELLAR', 'Transaction submitted', {
      correlationId,
      operationId,
      txHash: result.hash
    });
  }
}
```

## Usage Guide

### In HTTP Request Handlers

```javascript
const { getCorrelationContext } = require('../utils/correlation');

async function createDonation(req, res) {
  const { correlationId } = getCorrelationContext();
  
  log.info('DONATION', 'Creating donation', {
    donationId: req.body.id,
    correlationId  // Auto-included but shown for clarity
  });
  
  // Process donation...
}
```

### In Services

```javascript
class DonationService {
  async process(donation) {
    const { correlationId, operationId } = getCorrelationContext();
    
    log.info('DONATION_SERVICE', 'Processing', {
      donationId: donation.id,
      correlationId,
      operationId
    });
    
    // Service logic...
  }
}
```

### In Background Jobs

```javascript
const { withBackgroundContext } = require('./utils/correlation');

// Create background task with isolated context
withBackgroundContext('webhook_processor', async () => {
  const { correlationId, parentCorrelationId } = getCorrelationContext();
  
  log.info('WEBHOOK_PROCESSOR', 'Processing', {
    correlationId,
    parentCorrelationId  // Links back to originating request
  });
  
  // Process webhooks...
}, {
  taskType: 'webhook_processor'
}).catch(err => {
  log.error('WEBHOOK_PROCESSOR', 'Failed', { error: err.message });
});
```

### Receiving Webhooks

```javascript
// Parse incoming correlation headers to link to originating system
const { parseCorrelationHeaders, setCorrelationContext } = require('./utils/correlation');

app.post('/webhooks/stripe', (req, res) => {
  const inboundCorrelation = parseCorrelationHeaders(req.headers);
  
  // Set correlation context for all subsequent logs
  setCorrelationContext({
    correlationId: inboundCorrelation.correlationId || generateUUID(),
    traceId: inboundCorrelation.traceId,
    operationId: inboundCorrelation.operationId
  });
  
  log.info('WEBHOOK_RECEIVER', 'Received webhook', {
    event: req.body.type
  });
  
  // Process webhook...
  res.json({ received: true });
});
```

## Header Reference

### Standard Correlation Headers

| Header | Meaning | Example |
|--------|---------|---------|
| `X-Correlation-ID` | Primary request identifier | `550e8400-e29b-41d4-a716-446655440000` |
| `X-Trace-ID` | End-to-end trace identifier | `550e8400-e29b-41d4-a716-446655440000` |
| `X-Operation-ID` | Unique operation identifier | `f47ac10b-58cc-4372-a567-0e02b2c3d479` |
| `X-Request-ID` | HTTP request identifier | `req-abc123def456` |

### Webhook-Specific Headers

| Header | Meaning | Example |
|--------|---------|---------|
| `X-Signature` | HMAC-SHA256 signature | `sha256=abcd1234...` |
| `X-Signature-Timestamp` | Signature timestamp | `2024-07-24T12:34:56.789Z` |
| `X-Webhook-Signature` | Alternative signature header | `sha256=abcd1234...` |
| `X-Webhook-Timestamp` | Alternative timestamp header | `2024-07-24T12:34:56.789Z` |

## Troubleshooting

### Correlation ID Not Appearing in Logs

1. Check middleware is installed and runs before your route:
   ```javascript
   app.use(requestIdMiddleware);
   ```

2. Verify `log.setContext()` is being called:
   ```javascript
   // Should be in requestId middleware
   if (log.setContext) {
     log.setContext({
       requestId,
       correlationId: context.correlationId,
       traceId: context.traceId
     });
   }
   ```

3. Ensure you're using the unified logger, not `console.log`:
   ```javascript
   const log = require('./utils/log');
   log.info('Service', 'Message'); // ✓ Includes correlationId
   console.log('Message');          // ✗ No correlationId
   ```

### Webhook Correlation Headers Missing

1. Verify `generateCorrelationHeaders()` is called in webhook sender:
   ```javascript
   const correlationHeaders = generateCorrelationHeaders();
   ```

2. Ensure headers are merged into request options:
   ```javascript
   const options = {
     headers: {
       'Content-Type': 'application/json',
       ...correlationHeaders  // ← Must be spread here
     }
   };
   ```

### Correlation Lost in Async Operations

1. Use `withAsyncContext()` when spawning async work:
   ```javascript
   // ✓ Correct: Correlation inherited
   withAsyncContext('webhook_delivery', async () => {
     log.info('WEBHOOK', 'Sending'); // correlationId included
   });

   // ✗ Wrong: Correlation lost
   setTimeout(() => {
     log.info('WEBHOOK', 'Sending'); // correlationId NOT included
   }, 1000);
   ```

2. For promises, ensure context is preserved:
   ```javascript
   // ✓ Correct: Context preserved
   const { withCorrelationContext, getCorrelationContext } = require('./utils/correlation');
   const ctx = getCorrelationContext();
   
   promise.then(() => {
     withCorrelationContext(ctx, () => {
       log.info('Service', 'After promise');
     });
   });
   ```

## Testing

### Unit Test with Correlation

```javascript
const { setCorrelationContext, getCorrelationContext } = require('../utils/correlation');

describe('DonationService', () => {
  it('should log with correlation ID', () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    
    setCorrelationContext({ correlationId });
    
    // ... call service ...
    
    const ctx = getCorrelationContext();
    expect(ctx.correlationId).toBe(correlationId);
  });
});
```

### Integration Test with Headers

```javascript
const request = require('supertest');
const app = require('../src/app');

describe('Correlation headers', () => {
  it('should return correlation ID in response', async () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    
    const res = await request(app)
      .post('/api/donation/create')
      .set('X-Correlation-ID', correlationId)
      .send({ amount: 100 });
    
    expect(res.headers['x-correlation-id']).toBe(correlationId);
  });
});
```

## Related Documentation

- [Structured Logging Guide](./logging.md)
- [Distributed Tracing](./tracing.md)
- [Error Handling](./security/error-handling.md)
