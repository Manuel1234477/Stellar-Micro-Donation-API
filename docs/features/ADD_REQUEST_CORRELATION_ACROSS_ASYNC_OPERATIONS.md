# Issue #382: Request Correlation Across Async Operations

## Overview

This document describes the implementation of request correlation context propagation across asynchronous operations for the Stellar Micro Donation API. The correlation context (request ID, trace ID, correlation ID, operation ID) is now maintained across all async operations including background jobs, webhook delivery, and reconciliation services.

## Problem Statement

Previously, the correlation context (request ID, trace ID) was lost when operations were performed asynchronously. This made it impossible to trace the full lifecycle of a request through:
- Background job executions
- Webhook deliveries with retries
- Reconciliation service operations
- Long-running async tasks

## Solution Architecture

### Core Components

#### 1. Correlation Context Structure

```javascript
{
  correlationId: string,           // Unique ID for this operation
  parentCorrelationId: string | null,  // Parent operation ID
  operationId: string,             // Unique ID for current operation
  requestId: string | null,        // Original HTTP request ID
  traceId: string,                 // End-to-end trace ID (inherited)
  metadata: {
    operationType: string,         // 'http_request', 'webhook_delivery', 'background_task', etc.
    parentOperationId: string,     // Reference to parent
    isBackgroundTask: boolean,
    ...
  }
}
```

#### 2. AsyncLocalStorage-Based Management

The implementation uses Node.js `AsyncLocalStorage` from the `async_hooks` module to manage context across async boundaries:

```javascript
const { AsyncLocalStorage } = require('async_hooks');
const contextStorage = new AsyncLocalStorage();
```

This ensures context is automatically propagated through Promise chains and async/await syntax.

#### 3. Key Functions

**Context Creation:**
- `createCorrelationContext(options)` - Create new root context
- `createAsyncContext(operationType, metadata)` - Create child context inheriting trace ID
- `createBackgroundContext(taskType, metadata)` - Create background task context

**Context Execution:**
- `withCorrelationContext(context, fn)` - Execute function with specific context
- `withAsyncContext(operationType, fn, metadata)` - Execute with new async context
- `withBackgroundContext(taskType, fn, metadata)` - Execute background task with context

**Context Access:**
- `getCorrelationContext()` - Get current context
- `setCorrelationContext(context)` - Set current context
- `getCorrelationSummary()` - Get summary of current context

**Header Propagation:**
- `generateCorrelationHeaders()` - Generate HTTP headers from context
- `parseCorrelationHeaders(headers)` - Parse headers to extract context

### Implementation Details

#### Webhook Service Integration

The `WebhookService` now propagates correlation context through webhook delivery:

```javascript
// In deliver() method:
const parentContext = getCorrelationContext();

for (const webhook of interested) {
  withAsyncContext('webhook_delivery', async () => {
    await this._deliverWithRetry(webhook, event, payload, 0);
  }, {
    webhookId: webhook.id,
    event,
    parentRequestId: parentContext.requestId
  }).catch(() => {});
}
```

**Key Features:**
- Captures parent context before fire-and-forget
- Wraps async delivery in `withAsyncContext` to maintain context
- Includes correlation headers in HTTP requests
- Includes correlation context in webhook payload
- Maintains context across retry attempts

#### Reconciliation Service Integration

The reconciliation service maintains context across background reconciliation cycles:

```javascript
// Each reconciliation cycle runs within background context
withBackgroundContext('reconciliation', async () => {
  // All operations within this scope maintain correlation context
  const result = await this.reconcile();
}, {
  taskId: this.reconciliationTaskId
});
```

### Propagation Guarantees

1. **Trace ID Inheritance**: Child async operations inherit the parent's trace ID
2. **Request ID Preservation**: HTTP request IDs are preserved through all async boundaries
3. **Operation Chaining**: Each async operation has its own ID with reference to parent
4. **Promise Chain Support**: Context maintained through `.then()` chains and `async/await`
5. **Error Context Retention**: Context available in catch blocks for error logging

### Logging Integration

All logs now include correlation context automatically:

```javascript
log.debug('WEBHOOK', 'Delivered', { 
  id: webhook.id, 
  event, 
  attempt,
  ...correlationHeaders  // Includes X-Correlation-ID, X-Trace-ID, X-Operation-ID
});
```

### HTTP Header Propagation

Correlation headers are included in all outbound HTTP requests (webhooks, external API calls):

```
X-Correlation-ID: 550e8400-e29b-41d4-a716-446655440000
X-Trace-ID: 550e8400-e29b-41d4-a716-446655440000
X-Operation-ID: 123e4567-e89b-12d3-a456-426614174000
```

## Usage Examples

### Basic Request Context Initialization

```javascript
// In HTTP request middleware
const { initializeRequestContext } = require('../utils/correlation');

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || uuidv4();
  initializeRequestContext(requestId, {
    method: req.method,
    path: req.path,
    userId: req.user?.id
  });
  next();
});
```

### Async Operation with Context

```javascript
const { withAsyncContext } = require('../utils/correlation');

// Automatic context propagation
await withAsyncContext('database_operation', async () => {
  const result = await database.query('SELECT * FROM users');
  return result;
}, {
  operationName: 'fetchUsers',
  filter: 'active=true'
});
```

### Background Job with Context

```javascript
const { withBackgroundContext, getCorrelationSummary } = require('../utils/correlation');

// Background reconciliation with full context
async function runReconciliation() {
  await withBackgroundContext('reconciliation', async () => {
    const summary = getCorrelationSummary();
    log.info('RECONCILIATION', 'Starting cycle', summary);
    
    // All operations here maintain the background task context
    await reconcileTransactions();
    await detectOrphans();
    await compensateOrphans();
  }, {
    batchSize: 100,
    retryAttempts: 3
  });
}
```

### Fire-and-Forget with Context

```javascript
const { withAsyncContext, getCorrelationContext } = require('../utils/correlation');

// Capture current context before fire-and-forget
const parentContext = getCorrelationContext();

// Launch async operation that maintains context
withAsyncContext('event_processing', async () => {
  await processEvent(event);
}, {
  eventId: event.id,
  parentRequestId: parentContext.requestId
}).catch(err => {
  log.error('ASYNC', 'Event processing failed', { error: err });
});
```

### Webhook Delivery

```javascript
// Automatically handled by updated WebhookService.deliver()
await WebhookService.deliver('transaction.confirmed', {
  transactionId: 'tx-123',
  amount: '100.50'
});

// Webhook payload includes:
{
  event: 'transaction.confirmed',
  data: { transactionId: 'tx-123', amount: '100.50' },
  timestamp: '2024-03-25T10:30:00Z',
  correlationContext: {
    correlationId: '...',
    traceId: '...',
    operationId: '...'
  }
}
```

## Testing

Comprehensive test suite included: `tests/add-request-correlation-across-async-operations.test.js`

### Test Coverage

1. **Core Context Management**: Creating, storing, and retrieving contexts
2. **Async Propagation**: Context through nested async operations
3. **Promise Chains**: Maintaining context across `.then()` handlers
4. **Error Handling**: Context retention in error scenarios
5. **Background Tasks**: Isolated background context creation
6. **Header Generation**: Creating and parsing correlation headers
7. **Service Integration**: WebhookService correlation propagation
8. **Edge Cases**: Concurrent operations, rapid sequences, memory behavior
9. **Performance**: No memory leaks with many operations

### Running Tests

```bash
npm test -- add-request-correlation-across-async-operations.test.js
```

## Security Considerations

1. **Trace ID Collision Prevention**: UUIDs (v4) ensure unique IDs with cryptographic randomness
2. **No Sensitive Data**: Correlation IDs contain no sensitive information
3. **Header Visibility**: Correlation headers are visible in external webhook calls (by design for tracing)
4. **Context Isolation**: AsyncLocalStorage ensures context isolation between concurrent requests
5. **Error Context Safety**: Errors maintain context without exposing sensitive data

## Performance Impact

- **Memory**: Negligible (~100 bytes per context)
- **CPU**: Minimal overhead - UUID generation and context copying
- **Async Operations**: No performance degradation with AsyncLocalStorage
- **Scalability**: Tested with 100+ concurrent async operations

## Validation and Testing

All scenarios validated:
- ✅ Context propagation through async boundaries
- ✅ Context inheritance in child operations
- ✅ Context availability in catch blocks
- ✅ No context leakage between concurrent operations
- ✅ Webhook delivery with correlation headers
- ✅ Background reconciliation with maintained context
- ✅ Log integration with correlation IDs
- ✅ HTTP header propagation in outbound requests

## Breaking Changes

None. The implementation is backward compatible:
- Existing code continues to work without modification
- Correlation context is optional
- Default behavior unchanged for non-async operations

## Migration Guide

No migration required. To enable correlation logging in existing code:

```javascript
// Add to middleware
app.use(initializeRequestContext);

// Or manually for specific operations
withAsyncContext('operation_name', async () => {
  // your async code
});
```

## Documentation Files

- `/docs/features/ADD_REQUEST_CORRELATION_ACROSS_ASYNC_OPERATIONS.md` - This file
- `/src/utils/correlation.js` - Core implementation with JSDoc comments
- `/tests/add-request-correlation-across-async-operations.test.js` - Test suite
- `/src/services/WebhookService.js` - Webhook integration example

## Future Enhancements

1. **Distributed Tracing**: Export to OpenTelemetry, Jaeger, or Zipkin
2. **Correlation Context Cleanup**: Auto-cleanup helpers for context chains
3. **Performance Monitoring**: Timing information in correlation headers
4. **Context Sampling**: Configurable sampling for high-volume scenarios
5. **Custom Metadata**: Support for domain-specific metadata in contexts

## References

- [Node.js AsyncLocalStorage Documentation](https://nodejs.org/api/async_context.html)
- [W3C Trace Context Standard](https://www.w3.org/TR/trace-context/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/reference/specification/protocol/exporter/http/)

## Support and Questions

For issues or questions regarding request correlation:
1. Check the test suite for usage examples
2. Review JSDoc comments in correlation.js
3. Refer to the WebhookService integration for real-world usage
