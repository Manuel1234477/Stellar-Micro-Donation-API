# Structured Logging Guide

## Overview

This API uses structured, JSON-formatted logging for comprehensive observability. All logs follow a consistent schema to enable reliable querying, alerting, and incident response.

## Log Format

### JSON Schema

Every log line contains these standard fields:

```json
{
  "timestamp": "2024-07-24T12:34:56.789Z",
  "level": "INFO|WARN|ERROR|DEBUG",
  "service": "stellar-micro-donation-api",
  "environment": "production|development|test",
  "version": "1.0.0",
  "scope": "ServiceName or feature area",
  "message": "Human-readable description of the event",
  "correlationId": "uuid-v4",
  "traceId": "uuid-v4",
  "operationId": "uuid-v4",
  "requestId": "uuid-v4",
  "route": "/api/donation/create",
  "latency": 42,
  "userId": "optional-user-id",
  "transactionId": "optional-transaction-id",
  "additionalContext": "custom fields as needed"
}
```

### Standard Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | ISO 8601 | Yes | UTC timestamp when the log was created |
| `level` | String | Yes | Log level: `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `service` | String | Yes | Service name (from config) |
| `environment` | String | Yes | Deployment environment |
| `version` | String | Yes | API version |
| `scope` | String | Yes | Feature area or service name (e.g., "DonationService", "WebhookProcessor") |
| `message` | String | Yes | Human-readable event description |
| `correlationId` | UUID | If available | Request correlation ID for tracing across systems |
| `traceId` | UUID | If available | End-to-end trace ID (often same as correlationId) |
| `operationId` | UUID | If available | Unique ID for this specific operation |
| `requestId` | UUID | If available | Original HTTP request ID |
| `route` | String | If applicable | HTTP route or operation path |
| `latency` | Number | If applicable | Operation duration in milliseconds |

### Additional Context Fields

Based on context, logs may include:

- `userId`: User performing the action
- `transactionId`: Stellar transaction ID
- `walletAddress`: (masked) Wallet address
- `error`: Exception message (for ERROR level)
- `errorStack`: Stack trace (debug mode only)
- `statusCode`: HTTP response status
- `duration`: Operation duration (ms)

## Log Levels

### DEBUG
**When to use:** Detailed diagnostic information for development and troubleshooting.

**Examples:**
- Entry/exit of methods with arguments
- Conditional branches taken
- Cached value hits/misses
- State transitions in async operations

**Sampling:** DEBUG logs are sampled based on `config.logging.sampleRate` to avoid overwhelming logs in production.

**Note:** DEBUG logs are filtered unless `LOG_DEBUG=true` is set.

### INFO
**When to use:** Normal, expected events that mark significant application milestones.

**Examples:**
- Request received and processing starting
- Donation processed successfully
- Database migration completed
- Service started/stopped
- Configuration loaded

**Note:** INFO is the default log level. All INFO and higher severity are always logged.

### WARN
**When to use:** Potentially harmful situations that the application can recover from, but warrant attention.

**Examples:**
- Rate limit approaching threshold
- Retry attempt after transient failure
- Deprecated API endpoint used
- Configuration with unusual but valid values
- Correlation ID not found in expected location

**Note:** WARN logs should not indicate a failure, but a situation that might lead to one if not addressed.

### ERROR
**When to use:** Error events that may cause the application to fail or corrupt data.

**Examples:**
- Database query failure
- Stellar network error
- Webhook delivery failure
- Authentication/authorization failure
- Validation error (user input)
- Unrecoverable internal error

**Note:** ERROR logs should always include the error message and relevant context. Include stack trace only in debug mode.

## Usage Examples

### Basic Logging

```javascript
const log = require('./utils/log');

// Simple info log
log.info('DonationService', 'Donation processed', { donationId: '123' });

// Warning with context
log.warn('WebhookProcessor', 'Webhook delivery timeout', { 
  webhookId: 'wh-123',
  retryCount: 3
});

// Error with exception details
log.error('DonationService', 'Failed to process donation', {
  donationId: '123',
  error: err.message,
  errorCode: 'DB_CONNECTION_FAILED'
});

// Debug with detailed state
log.debug('StellarService', 'Building transaction', {
  operations: ['payment', 'memo'],
  fee: 100,
  sequence: 12345
});
```

### With Context

```javascript
const { setContext, child } = require('./utils/log');

// Set request context once per request
setContext({
  requestId: req.id,
  correlationId: correlationId,
  userId: user.id,
  route: req.route.path
});

// Child logger inherits context automatically
const logger = child({ scope: 'DonationService' });
logger.info('PROCESS', 'Starting donation processing', { amount: 100 });
logger.info('VALIDATE', 'Validating donation', { isValid: true });
logger.info('PROCESS', 'Donation complete', { txId: 'abc123' });
```

### Latency Tracking

```javascript
const startTime = Date.now();

try {
  // ... do work ...
  const latency = Date.now() - startTime;
  log.info('DonationService', 'Donation completed', {
    donationId: '123',
    latency
  });
} catch (err) {
  const latency = Date.now() - startTime;
  log.error('DonationService', 'Donation failed', {
    donationId: '123',
    latency,
    error: err.message
  });
}
```

## Configuration

Logging behavior is controlled via environment variables and `config/index.js`:

```javascript
// config/logging
{
  level: 'INFO',           // Minimum log level (DEBUG|INFO|WARN|ERROR)
  format: 'json',          // Output format (json|text)
  toFile: true,            // Write logs to files
  directory: './logs',     // Log file directory
  debugMode: false,        // Enable debug-level logging
  sampleRate: 1.0          // Fraction of DEBUG logs to keep (0.0-1.0)
}
```

### Environment Variables

- `LOG_LEVEL`: Override minimum level (DEBUG, INFO, WARN, ERROR)
- `LOG_FORMAT`: Override format (json, text)
- `LOG_DEBUG`: Set to 'true' to enable DEBUG logs
- `LOG_SAMPLE_RATE`: Set fraction (0.0-1.0) of DEBUG logs to keep
- `LOG_TO_FILE`: Set to 'true' to write logs to files
- `LOG_DIRECTORY`: Set custom log directory

## Sensitive Data Handling

The logger automatically masks sensitive data:

- Stellar private keys
- API keys and tokens
- Database passwords
- Credit card numbers
- Social security numbers
- Email addresses (context-dependent)

Use the `maskSensitiveData` utility for custom masking in your code:

```javascript
const { maskSensitiveData } = require('./utils/dataMasker');
const sanitized = maskSensitiveData({ secretKey: '...', publicData: '...' });
log.info('Service', 'Event', sanitized);
```

## Correlation & Tracing

Every request gets a unique correlation ID that ties together:
- Request logs
- Database queries
- Stellar operations
- Webhook deliveries
- Background jobs

### For HTTP Requests

Correlation is automatic via middleware. Use the `correlationId` in logs:

```javascript
log.info('Service', 'Processing request', { correlationId: '...' });
```

### For Async Operations

Use `createAsyncContext()` to inherit the parent request's correlation ID:

```javascript
const { createAsyncContext, withCorrelationContext } = require('./utils/correlation');

const asyncCtx = createAsyncContext('webhook_delivery');
withCorrelationContext(asyncCtx, async () => {
  // Logs here automatically include parent correlationId
  await sendWebhook();
});
```

### For Webhooks

The correlation ID is automatically sent as `X-Correlation-ID` header on all outbound webhooks.

## Viewing Logs

### Console Output (Text Format)

```
[2024-07-24T12:34:56.789Z] [INFO] [DonationService] [reqId=abc12345 txId=xyz78901 userId=user-123] Donation processed {"amount": 100, "currency": "USD"}
```

### JSON Output (Production)

Each log line is a single JSON object, easily parsed by log aggregators:

```json
{"timestamp":"2024-07-24T12:34:56.789Z","level":"INFO","service":"stellar-micro-donation-api","environment":"production","version":"1.0.0","scope":"DonationService","message":"Donation processed","correlationId":"abc12345","traceId":"abc12345","operationId":"xyz78901","requestId":"req-123","userId":"user-123","amount":100,"currency":"USD"}
```

### Log Aggregation

Logs are designed for ingestion into log aggregation platforms:
- **Elasticsearch/ELK**: Direct JSON ingestion
- **Datadog**: JSON format with standard fields
- **CloudWatch**: JSON format parsed automatically
- **Splunk**: Automatic JSON field extraction

Query examples (Elasticsearch/Kibana):

```
# Find all errors in a request
correlationId: "abc12345" level: ERROR

# Find slow operations
latency > 1000

# Find donation-related operations
scope: DonationService

# Find errors by type
errorCode: DB_CONNECTION_FAILED

# Timeline of a user's activity
userId: "user-123" | sort by @timestamp
```

## Best Practices

1. **Use consistent scopes**: Keep scope values consistent (e.g., "DonationService", not "donation" or "DONATION").

2. **Include correlation ID**: Always include correlation ID in logs when available; it's set automatically by middleware.

3. **Log at the right level**:
   - DEBUG: Use sparingly, safe to sample
   - INFO: Normal operations and milestones
   - WARN: Recoverable issues that need attention
   - ERROR: Failures and exceptions

4. **Avoid logging secrets**: Never log API keys, tokens, or passwords. The masking utilities handle common cases; manually mask custom secrets.

5. **Include relevant context**: Add fields that help identify the affected entity (userId, transactionId, donationId, etc.).

6. **Add latency for performance tracking**: Include operation duration for operations that matter.

7. **Structure complex data**: Use objects for multi-field context, not concatenated strings.

   ```javascript
   // Good
   log.info('Service', 'Operation complete', { userId, transactionId, latency });
   
   // Bad
   log.info('Service', `Operation complete for user ${userId} tx ${transactionId} in ${latency}ms`);
   ```

8. **Use child loggers in services**: Create a child logger at the service level to avoid repeating scope:

   ```javascript
   class MyService {
     constructor() {
       this.log = log.child({ scope: 'MyService' });
     }
     
     async process() {
       this.log.info('PROCESS', 'Starting...', {});
     }
   }
   ```

## Troubleshooting

### Logs not appearing in files

- Check `config.logging.toFile` is `true`
- Check `config.logging.directory` exists and is writable
- Check `LOG_TO_FILE` environment variable

### Debug logs not appearing

- Set `LOG_DEBUG=true` to enable DEBUG level
- Check `config.logging.debugMode` is `true`
- DEBUG logs are sampled; adjust `LOG_SAMPLE_RATE` if needed

### Sensitive data appearing in logs

- Check the data type in `maskSensitiveData` blacklist
- Add custom masking for new sensitive field patterns
- Never log data without running through `maskSensitiveData` first

## Related Documentation

- [Correlation ID Propagation](./correlation.md)
- [Distributed Tracing](./tracing.md)
- [Error Handling](./security/error-handling.md)
- [Observability SLOs](./slos.md)
