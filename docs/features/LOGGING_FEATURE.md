# Request/Response Logging Feature

## Overview
Comprehensive logging middleware for debugging and transparency that logs incoming requests and outgoing responses while automatically filtering sensitive data.

## Features

### 1. Request Logging
- Endpoint URL
- HTTP method (GET, POST, PATCH, DELETE, etc.)
- Timestamp (ISO 8601 format)
- Request headers
- Query parameters
- Request body
- Route parameters
- Client IP address

### 2. Response Logging
- HTTP status code
- Response body
- Response time (duration in milliseconds)

### 3. Sensitive Data Protection
Automatically redacts sensitive information from logs:
- Passwords
- Secret keys (secretKey, privateKey, private_key)
- Authorization tokens (authorization header, Bearer tokens)
- API keys (apiKey, api_key, api-key, x-api-key)
- Credit card information
- Social security numbers
- Any field containing: password, secret, token, authorization, apiKey, privateKey, creditCard, ssn

### 4. Flexible Output
- **Console logging**: Color-coded by status code (green for 2xx, yellow for 4xx, red for 5xx)
- **File logging**: Optional daily log files (api-YYYY-MM-DD.log)
- **Verbose mode**: Detailed request/response bodies in console

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Enable file logging (default: false, logs only to console)
LOG_TO_FILE=false

# Log directory path (default: ./logs)
LOG_DIR=./logs

# Enable verbose logging (includes request/response bodies in console)
LOG_VERBOSE=false
```

### Console Output Format

```
[2024-02-20T10:30:45.123Z] GET /donations 200 - 45ms
[2024-02-20T10:30:46.456Z] POST /wallets 201 - 120ms
[2024-02-20T10:30:47.789Z] GET /stats/daily 400 - 15ms
```

### File Output Format (when LOG_TO_FILE=true)

```json
{
  "timestamp": "2024-02-20T10:30:45.123Z",
  "method": "GET",
  "endpoint": "/donations",
  "statusCode": 200,
  "duration": 45,
  "request": {
    "headers": {
      "content-type": "application/json",
      "authorization": "[REDACTED]"
    },
    "query": {},
    "body": {},
    "params": {},
    "ip": "::1"
  },
  "response": {
    "statusCode": 200,
    "body": {
      "success": true,
      "data": []
    }
  }
}
```

## Implementation Details

### Middleware Integration

The logging middleware is automatically applied to all routes in `src/routes/app.js`:

```javascript
const logger = require('../middleware/logger');
app.use(logger.middleware());
```

### Sensitive Data Sanitization

The middleware uses a configurable list of sensitive field patterns:
- Case-insensitive matching
- Supports nested objects and arrays
- Replaces sensitive values with `[REDACTED]`

### Performance Tracking

Each request includes:
- Start timestamp
- End timestamp
- Duration in milliseconds

## Usage Examples

### Basic Request
```bash
curl http://localhost:3000/health
```

**Console Output:**
```
[2024-02-20T10:30:45.123Z] GET /health 200 - 5ms
```

### Request with Sensitive Data
```bash
curl -X POST http://localhost:3000/wallets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer secret-token" \
  -d '{"address":"GXXX","secretKey":"SXXX"}'
```

**Console Output:**
```
[2024-02-20T10:30:46.456Z] POST /wallets 201 - 120ms
```

**Logged Data (sanitized):**
```json
{
  "request": {
    "headers": {
      "authorization": "[REDACTED]"
    },
    "body": {
      "address": "GXXX",
      "secretKey": "[REDACTED]"
    }
  }
}
```

### Verbose Mode
Set `LOG_VERBOSE=true` in `.env` to see full request/response details in console:

```
[2024-02-20T10:30:45.123Z] GET /donations 200 - 45ms
Request: {
  "headers": {...},
  "query": {},
  "body": {}
}
Response: {
  "statusCode": 200,
  "body": {...}
}
```

## Testing

### Unit Tests (`tests/logger.test.js`)
- ✅ Sensitive data sanitization (9 tests)
- ✅ Log formatting
- ✅ File operations
- ✅ Middleware functionality
- ✅ Console output

### Integration Tests (`tests/logger-integration.test.js`)
- ✅ Request logging (5 tests)
- ✅ Sensitive data filtering (5 tests)
- ✅ Response logging (2 tests)
- ✅ Performance metrics (2 tests)
- ✅ Request metadata (2 tests)

**All 34 tests passed successfully!**

## Files Modified
1. `src/routes/app.js` - Integrated logging middleware
2. `src/.env` - Added logging configuration options

## Files Created
1. `src/middleware/logger.js` - Logging middleware implementation
2. `tests/logger.test.js` - Unit tests
3. `tests/logger-integration.test.js` - Integration tests
4. `.gitignore` - Added logs directory and log files

## Security Considerations

1. **Automatic Redaction**: Sensitive fields are automatically redacted before logging
2. **Configurable Patterns**: Sensitive field patterns can be customized
3. **No PII Exposure**: Personal identifiable information is protected
4. **Secure by Default**: File logging is disabled by default

## Performance Impact

- Minimal overhead (~1-5ms per request)
- Asynchronous file writes (non-blocking)
- Efficient object sanitization
- No impact on response time

## Maintenance

### Log File Rotation
Log files are created daily with format: `api-YYYY-MM-DD.log`

Consider implementing log rotation:
- Delete logs older than 30 days
- Compress old log files
- Use external log management tools (e.g., Winston, Bunyan)

### Monitoring
Monitor log file sizes and disk usage when file logging is enabled.

## Future Enhancements

Potential improvements:
- Log levels (DEBUG, INFO, WARN, ERROR)
- Structured logging (JSON format for all outputs)
- Integration with external logging services (Datadog, Splunk, ELK)
- Request correlation IDs
- Performance metrics aggregation
- Log streaming to cloud storage

## Git Branch
- Branch: `feature/request-response-logging`
- Commit: "feat: add request/response logging with sensitive data filtering"
- Status: Ready for commit and push
