# Structured Logging Implementation Guide

## Overview
This document describes the structured logging implementation that provides consistent, traceable logs across the Stellar Micro-Donation API.

## Key Features

### 1. Standard Log Fields
Every log entry includes these standard fields:
- `timestamp`: ISO 8601 timestamp
- `level`: Log level (INFO, WARN, ERROR, DEBUG)
- `scope`: Component/module name (e.g., 'DONATION_ROUTE', 'STELLAR_SERVICE')
- `message`: Human-readable log message
- `serviceName`: Application name ('stellar-micro-donation-api')
- `environment`: Environment (development, production, test)
- `version`: Application version

### 2. Request Context Fields
Automatically included when available:
- `requestId`: Unique identifier for each HTTP request
- `method`: HTTP method (GET, POST, etc.)
- `path`: Request path
- `ip`: Client IP address

### 3. Domain-Specific Fields
Include these fields when relevant:
- `transactionId`: Stellar transaction hash
- `walletAddress`: Stellar wallet public key
- `userId`: User identifier
- `sessionId`: Session identifier
- `ledger`: Stellar ledger number

## Usage Examples

### Basic Logging

```javascript
const log = require('../utils/log');

// Info level
log.info('DONATION_ROUTE', 'Processing donation request', {
  requestId: req.id,
  amount: 100,
  recipient: 'GXXX...'
});

// Warning level
log.warn('RATE_LIMITER', 'Rate limit approaching', {
  requestId: req.id,
  remaining: 2,
  limit: 10
});

// Error level
log.error('STELLAR_SERVICE', 'Transaction failed', {
  requestId: req.id,
  transactionId: 'abc123',
  error: error.message,
  stack: error.stack
});

// Debug level (only in DEBUG_MODE=true)
log.debug('WALLET_SERVICE', 'Wallet lookup', {
  requestId: req.id,
  walletAddress: 'GXXX...'
});
```

### Using Child Loggers

Child loggers maintain context across multiple log calls:

```javascript
const log = require('../utils/log');

// Create child logger with preset context
const txLogger = log.child({
  transactionId: 'abc123',
  walletAddress: 'GXXX...'
});

// All logs from this logger include the preset context
txLogger.info('TX_PROCESSOR', 'Starting transaction');
txLogger.debug('TX_PROCESSOR', 'Validating inputs');
txLogger.info('TX_PROCESSOR', 'Transaction completed');
```

### Setting Request Context

The request context is automatically set by the `requestId` middleware:

```javascript
// In middleware/requestId.js
log.setContext({ 
  requestId,
  method: req.method,
  path: req.path,
  ip: req.ip
});
```

You can add additional context in your routes:

```javascript
// Add transaction-specific context
log.setContext({ 
  transactionId: stellarResult.hash,
  walletAddress: sender.publicKey
});
```

## Log Output Format

### Console Output
```
[2024-02-25T10:30:45.123Z] [INFO] [DONATION_ROUTE] [reqId=a1b2c3d4 txId=e5f6g7h8] Processing donation request {"amount":100,"recipient":"GXXX..."}
```

### Structured Fields Breakdown
- `[2024-02-25T10:30:45.123Z]` - Timestamp
- `[INFO]` - Log level
- `[DONATION_ROUTE]` - Scope/component
- `[reqId=a1b2c3d4 txId=e5f6g7h8]` - Context IDs (truncated for readability)
- `Processing donation request` - Message
- `{"amount":100,...}` - Additional metadata (JSON)

## Best Practices

### 1. Always Include requestId
```javascript
// ✅ Good
log.info('ROUTE', 'Processing request', { requestId: req.id });

// ❌ Bad
log.info('ROUTE', 'Processing request');
```

### 2. Include transactionId for Transaction Operations
```javascript
// ✅ Good
log.info('STELLAR_SERVICE', 'Transaction submitted', {
  requestId: req.id,
  transactionId: result.hash,
  amount: 100
});

// ❌ Bad
log.info('STELLAR_SERVICE', 'Transaction submitted');
```

### 3. Include Error Details
```javascript
// ✅ Good
log.error('SERVICE', 'Operation failed', {
  requestId: req.id,
  error: error.message,
  stack: error.stack,
  context: { userId, walletAddress }
});

// ❌ Bad
log.error('SERVICE', 'Operation failed');
```

### 4. Use Appropriate Log Levels
- `DEBUG`: Detailed diagnostic information (only in debug mode)
- `INFO`: General informational messages
- `WARN`: Warning messages for potentially harmful situations
- `ERROR`: Error messages for failures

### 5. Never Log Sensitive Data
The logging system automatically sanitizes sensitive fields, but be cautious:

```javascript
// ✅ Good - Sensitive data is automatically redacted
log.info('AUTH', 'User authenticated', {
  userId: user.id,
  apiKey: user.apiKey // Automatically redacted
});

// ✅ Good - Truncate long identifiers
log.info('WALLET', 'Wallet created', {
  walletAddress: wallet.publicKey.substring(0, 10) + '...'
});

// ❌ Bad - Don't log raw secrets
log.info('WALLET', 'Wallet created', {
  secretKey: wallet.secretKey // NEVER DO THIS
});
```

## Scope Naming Conventions

Use consistent scope names across the application:

### Routes
- `DONATION_ROUTE`
- `WALLET_ROUTE`
- `STATS_ROUTE`
- `STREAM_ROUTE`
- `TRANSACTION_ROUTE`

### Services
- `STELLAR_SERVICE`
- `MOCK_STELLAR_SERVICE`
- `IDEMPOTENCY_SERVICE`
- `TRANSACTION_SYNC_SERVICE`
- `RECURRING_SCHEDULER`

### Middleware
- `REQUEST_LOGGER`
- `RATE_LIMITER`
- `AUTH_MIDDLEWARE`
- `VALIDATION_MIDDLEWARE`

### Utilities
- `STELLAR_ERROR_HANDLER`
- `ABUSE_DETECTION`
- `SANITIZER`

## Querying Logs

### Filter by Request ID
```bash
# Find all logs for a specific request
grep "reqId=a1b2c3d4" logs/api-2024-02-25.log
```

### Filter by Transaction ID
```bash
# Find all logs for a specific transaction
grep "txId=e5f6g7h8" logs/api-2024-02-25.log
```

### Filter by Log Level
```bash
# Find all errors
grep "\[ERROR\]" logs/api-2024-02-25.log
```

### Filter by Scope
```bash
# Find all donation route logs
grep "\[DONATION_ROUTE\]" logs/api-2024-02-25.log
```

## Environment Variables

### DEBUG_MODE
Enable debug logging:
```bash
DEBUG_MODE=true npm start
```

### LOG_VERBOSE
Enable verbose request/response logging:
```bash
LOG_VERBOSE=true npm start
```

### LOG_TO_FILE
Enable file logging:
```bash
LOG_TO_FILE=true npm start
```

### LOG_DIR
Set log directory:
```bash
LOG_DIR=/var/log/stellar-api npm start
```

## Migration Guide

### Updating Existing Logs

**Before:**
```javascript
log.info('ROUTE', 'Processing request');
```

**After:**
```javascript
log.info('ROUTE', 'Processing request', {
  requestId: req.id
});
```

**Before:**
```javascript
log.error('SERVICE', 'Failed', { error: error.message });
```

**After:**
```javascript
log.error('SERVICE', 'Failed', {
  requestId: req.id,
  transactionId: txId,
  error: error.message,
  stack: error.stack
});
```

## Testing

### Unit Tests
```javascript
const log = require('../utils/log');

describe('Logging', () => {
  test('should include requestId in logs', () => {
    const spy = jest.spyOn(console, 'log');
    
    log.setContext({ requestId: 'test-123' });
    log.info('TEST', 'Test message');
    
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('reqId=test-123')
    );
  });
});
```

### Integration Tests
```javascript
test('should log with transaction context', async () => {
  const spy = jest.spyOn(console, 'log');
  
  const response = await request(app)
    .post('/donations/send')
    .send({ amount: 100, recipient: 'GXXX...' });
  
  expect(spy).toHaveBeenCalledWith(
    expect.stringContaining('txId=')
  );
});
```

## Troubleshooting

### Logs Not Showing Context
Ensure the `requestId` middleware is registered before routes:
```javascript
app.use(requestId);
app.use('/donations', donationRoutes);
```

### Debug Logs Not Appearing
Enable debug mode:
```bash
DEBUG_MODE=true npm start
```

### Context Not Persisting
The context uses AsyncLocalStorage (Node 12.17+). For older versions, context may not persist across async boundaries.

## Performance Considerations

1. **Structured logging adds minimal overhead** (~1-2ms per log entry)
2. **Debug logs are no-ops when disabled** (no performance impact)
3. **Sanitization is cached** for repeated log entries
4. **File logging is asynchronous** (non-blocking)

## Security

### Automatic Sanitization
The following fields are automatically redacted:
- `password`, `secretKey`, `secret`, `token`
- `authorization`, `apiKey`, `api_key`, `api-key`
- `privateKey`, `private_key`
- `creditCard`, `credit_card`, `ssn`, `social_security`

### Log Injection Prevention
All log messages are sanitized to remove control characters that could be used for log injection attacks.

## Future Enhancements

1. **Centralized Logging**: Integration with ELK stack, Datadog, or CloudWatch
2. **Log Aggregation**: Collect logs from multiple instances
3. **Alerting**: Automated alerts based on error patterns
4. **Metrics**: Extract metrics from structured logs
5. **Distributed Tracing**: Integration with OpenTelemetry

## References

- [Structured Logging Best Practices](https://www.loggly.com/ultimate-guide/node-logging-basics/)
- [Node.js Logging Guide](https://nodejs.org/en/docs/guides/diagnostics/logging/)
- [AsyncLocalStorage Documentation](https://nodejs.org/api/async_context.html#class-asynclocalstorage)
