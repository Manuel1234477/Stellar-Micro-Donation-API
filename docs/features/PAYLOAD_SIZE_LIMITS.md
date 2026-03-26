# Payload Size Limits Feature

## Overview

The Payload Size Limits feature prevents abuse or accidental overload by enforcing maximum request payload sizes. This security measure protects the API from:

- Denial of Service (DoS) attacks via oversized payloads
- Memory exhaustion from processing large requests
- Network bandwidth abuse
- Accidental client misconfigurations

## Implementation

### Middleware Location
- **File**: `src/middleware/payloadSizeLimit.js`
- **Tests**: `tests/payloadSizeLimit.test.js`
- **Integration**: `src/routes/app.js` (applied globally before body parsers)

### Default Limits

| Content Type | Limit | Use Case |
|--------------|-------|----------|
| JSON (`application/json`) | 100 KB | API requests, structured data |
| URL-encoded (`application/x-www-form-urlencoded`) | 100 KB | Form submissions |
| Text (`text/*`) | 100 KB | Plain text data |
| Raw (`application/octet-stream`) | 1 MB | Binary data, file uploads |

### How It Works

1. **Pre-parsing Check**: Middleware inspects the `Content-Length` header before Express body parsers process the request
2. **Content-Type Detection**: Determines appropriate size limit based on the request's `Content-Type` header
3. **Validation**: Compares payload size against the configured limit
4. **Rejection**: Returns HTTP 413 (Payload Too Large) with detailed error information if limit exceeded
5. **Monitoring**: Logs large payloads (>80% of limit) for capacity planning

## Configuration

### Using Default Limits

```javascript
const { payloadSizeLimiter } = require('./middleware/payloadSizeLimit');

app.use(payloadSizeLimiter);
```

### Custom Limits

```javascript
const { createPayloadSizeLimiter } = require('./middleware/payloadSizeLimit');

app.use(createPayloadSizeLimiter({
  json: 50 * 1024,        // 50 KB for JSON
  urlencoded: 50 * 1024,  // 50 KB for URL-encoded
  text: 25 * 1024,        // 25 KB for text
  raw: 500 * 1024         // 500 KB for raw data
}));
```

### Environment-Based Configuration

```javascript
const { createPayloadSizeLimiter } = require('./middleware/payloadSizeLimit');

const limits = {
  json: parseInt(process.env.MAX_JSON_SIZE || '102400', 10),
  urlencoded: parseInt(process.env.MAX_URLENCODED_SIZE || '102400', 10),
  text: parseInt(process.env.MAX_TEXT_SIZE || '102400', 10),
  raw: parseInt(process.env.MAX_RAW_SIZE || '1048576', 10)
};

app.use(createPayloadSizeLimiter(limits));
```

## Error Response Format

When a payload exceeds the configured limit, the API returns HTTP 413 with this structure:

```json
{
  "success": false,
  "error": {
    "code": "PAYLOAD_TOO_LARGE",
    "message": "Request payload too large. Maximum allowed size is 100.00 KB",
    "details": {
      "receivedSize": "150.00 KB",
      "maxSize": "100.00 KB",
      "payloadType": "JSON"
    },
    "requestId": "abc-123-def-456",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

### Error Response Fields

- **code**: Always `PAYLOAD_TOO_LARGE` for size violations
- **message**: Human-readable error description
- **details.receivedSize**: Actual payload size in human-readable format
- **details.maxSize**: Maximum allowed size for this content type
- **details.payloadType**: Content type category (JSON, URL-encoded, text, raw)
- **requestId**: Unique request identifier for tracing
- **timestamp**: ISO 8601 timestamp of the error

## Integration with Other Features

### Middleware Order

The payload size limiter must be placed before body parsers:

```javascript
// ✅ Correct order
app.use(requestId);
app.use(payloadSizeLimiter);  // Check size first
app.use(express.json());       // Then parse body
app.use(express.urlencoded({ extended: true }));

// ❌ Incorrect order
app.use(express.json());       // Body already parsed
app.use(payloadSizeLimiter);  // Too late to check size
```

### Rate Limiting

Works seamlessly with rate limiting middleware:

```javascript
app.use(payloadSizeLimiter);  // Check size
app.use(rateLimiter);          // Check rate
```

### Abuse Detection

Payload size violations are logged and contribute to abuse detection patterns:

```javascript
log.warn('PAYLOAD_SIZE_LIMIT', 'Oversized payload rejected', {
  requestId: req.id,
  contentLength,
  maxSize,
  payloadType,
  ip: req.ip
});
```

### Idempotency

Oversized payloads are rejected before idempotency checks, preventing cache pollution.

## Monitoring and Logging

### Rejection Logs

```
WARN PAYLOAD_SIZE_LIMIT: Oversized payload rejected
{
  requestId: "abc-123",
  contentLength: 153600,
  maxSize: 102400,
  payloadType: "JSON",
  contentType: "application/json",
  path: "/donations/send",
  method: "POST",
  ip: "192.168.1.100"
}
```

### Large Payload Warnings

Payloads exceeding 80% of the limit trigger informational logs:

```
INFO PAYLOAD_SIZE_LIMIT: Large payload detected (within limits)
{
  requestId: "def-456",
  contentLength: "85.00 KB",
  maxSize: "100.00 KB",
  utilizationPercent: "85.00",
  path: "/donations/send"
}
```

## Testing

### Running Tests

```bash
# Run all payload size limit tests
npm test -- tests/payloadSizeLimit.test.js

# Run with coverage
npm test -- tests/payloadSizeLimit.test.js --coverage
```

### Test Coverage

The test suite validates:

- ✅ Payloads within limits are accepted
- ✅ Oversized payloads are rejected with HTTP 413
- ✅ Error responses include all required fields
- ✅ Different content types use appropriate limits
- ✅ Request ID is included in error responses
- ✅ Edge cases (empty payloads, exact limit, missing headers)
- ✅ Default limits are correctly configured
- ✅ Custom limits can be applied
- ✅ Human-readable size formatting

### Manual Testing with curl

```bash
# Test normal request (should succeed)
curl -X POST http://localhost:3000/donations/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -H "Idempotency-Key: test-123" \
  -d '{"senderId": "1", "receiverId": "2", "amount": "10"}'

# Test oversized payload (should fail with 413)
curl -X POST http://localhost:3000/donations/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -H "Idempotency-Key: test-456" \
  -d "$(printf '{"data":"%0.s'x'{1..150000}"}' {1..1})"
```

## Security Considerations

### DoS Protection

Payload size limits are the first line of defense against:

- **Memory exhaustion**: Prevents loading massive payloads into memory
- **CPU exhaustion**: Avoids parsing extremely large JSON/XML structures
- **Network saturation**: Limits bandwidth consumption per request

### Recommended Limits

| API Type | Recommended JSON Limit | Rationale |
|----------|------------------------|-----------|
| Microservices | 10-50 KB | Small, focused payloads |
| Standard REST API | 100 KB | Balance between flexibility and security |
| File upload API | 1-10 MB | Depends on use case |
| Public API | 50 KB | Stricter limits for untrusted clients |

### Defense in Depth

Payload size limits work alongside:

- **Rate limiting**: Prevents request flooding
- **Authentication**: Ensures only authorized clients
- **Input validation**: Validates payload structure and content
- **Idempotency**: Prevents duplicate processing

## Performance Impact

### Overhead

- **Minimal**: Only reads `Content-Length` header (no body parsing)
- **Fast rejection**: Oversized requests rejected immediately
- **No memory allocation**: Check happens before body buffering

### Benchmarks

| Scenario | Processing Time | Memory Usage |
|----------|----------------|--------------|
| Normal request (10 KB) | < 1ms | Negligible |
| Large request (90 KB) | < 1ms | Negligible |
| Oversized request (200 KB) | < 1ms | None (rejected) |

## Troubleshooting

### Common Issues

#### Issue: Valid requests are rejected

**Symptoms**: Legitimate requests return HTTP 413

**Solutions**:
1. Check actual payload size: `console.log(JSON.stringify(payload).length)`
2. Increase limits if justified: `createPayloadSizeLimiter({ json: 200 * 1024 })`
3. Optimize payload: Remove unnecessary data, compress, or paginate

#### Issue: Limits not enforced

**Symptoms**: Oversized requests are accepted

**Solutions**:
1. Verify middleware order (must be before body parsers)
2. Check if middleware is applied: `app._router.stack`
3. Ensure `Content-Length` header is sent by client

#### Issue: Wrong limit applied

**Symptoms**: Request uses incorrect size limit

**Solutions**:
1. Verify `Content-Type` header is set correctly
2. Check content type detection logic
3. Use explicit content type: `Content-Type: application/json; charset=utf-8`

### Debugging

Enable detailed logging:

```javascript
const log = require('./utils/log');
log.setLevel('debug');

// Logs will show:
// - Content-Length header value
// - Detected content type
// - Applied size limit
// - Rejection reason
```

## Best Practices

### 1. Set Appropriate Limits

```javascript
// ✅ Good: Tailored to actual needs
app.use(createPayloadSizeLimiter({
  json: 50 * 1024  // 50 KB for typical API requests
}));

// ❌ Bad: Unnecessarily large
app.use(createPayloadSizeLimiter({
  json: 10 * 1024 * 1024  // 10 MB is excessive for most APIs
}));
```

### 2. Document Limits

Include payload limits in API documentation:

```markdown
## Request Limits

- Maximum JSON payload: 100 KB
- Maximum form data: 100 KB
- Maximum file upload: 1 MB
```

### 3. Provide Clear Error Messages

The middleware automatically provides detailed errors. Ensure clients handle them:

```javascript
// Client-side error handling
try {
  const response = await fetch('/api/endpoint', {
    method: 'POST',
    body: JSON.stringify(largePayload)
  });
  
  if (response.status === 413) {
    const error = await response.json();
    console.error('Payload too large:', error.error.details);
    // Implement retry with smaller payload or chunking
  }
} catch (error) {
  console.error('Request failed:', error);
}
```

### 4. Monitor Usage Patterns

Track payload size metrics:

```javascript
// Add custom monitoring
app.use((req, res, next) => {
  const size = parseInt(req.get('Content-Length') || '0', 10);
  metrics.histogram('request.payload.size', size, {
    path: req.path,
    method: req.method
  });
  next();
});
```

### 5. Consider Chunking for Large Data

For legitimate large payloads, implement chunking:

```javascript
// Client-side chunking
async function uploadLargeData(data) {
  const chunkSize = 50 * 1024; // 50 KB chunks
  const chunks = Math.ceil(data.length / chunkSize);
  
  for (let i = 0; i < chunks; i++) {
    const chunk = data.slice(i * chunkSize, (i + 1) * chunkSize);
    await fetch('/api/upload/chunk', {
      method: 'POST',
      body: JSON.stringify({ chunk, index: i, total: chunks })
    });
  }
}
```

## Acceptance Criteria

✅ **Oversized payloads are rejected**
- Payloads exceeding configured limits return HTTP 413
- Error response includes detailed information
- Rejection happens before body parsing

✅ **Normal requests unaffected**
- Requests within limits process normally
- No performance degradation
- No false positives

✅ **Meaningful errors on violation**
- Error code: `PAYLOAD_TOO_LARGE`
- Human-readable size information
- Request ID for tracing
- Timestamp for auditing

## Related Documentation

- [Rate Limiting](./RATE_LIMITING.md) - Request frequency limits
- [Idempotency](./IDEMPOTENCY.md) - Duplicate request prevention
- [Error Handling](../security/ERROR_HANDLING.md) - Error response format
- [Abuse Detection](../../docs/ABUSE_DETECTION.md) - Pattern-based abuse detection

## API Reference

### `createPayloadSizeLimiter(options)`

Creates a configured payload size limit middleware.

**Parameters:**
- `options` (Object, optional): Configuration object
  - `options.json` (Number): Max size for JSON payloads in bytes (default: 102400)
  - `options.urlencoded` (Number): Max size for URL-encoded payloads in bytes (default: 102400)
  - `options.text` (Number): Max size for text payloads in bytes (default: 102400)
  - `options.raw` (Number): Max size for raw payloads in bytes (default: 1048576)

**Returns:** Express middleware function

**Example:**
```javascript
const limiter = createPayloadSizeLimiter({
  json: 50 * 1024,
  urlencoded: 50 * 1024
});
app.use(limiter);
```

### `formatBytes(bytes)`

Converts bytes to human-readable format.

**Parameters:**
- `bytes` (Number): Size in bytes

**Returns:** String (e.g., "1.50 KB", "2.00 MB")

**Example:**
```javascript
formatBytes(1536);  // "1.50 KB"
formatBytes(1048576);  // "1.00 MB"
```

### `DEFAULT_LIMITS`

Object containing default size limits in bytes.

**Properties:**
- `json`: 102400 (100 KB)
- `urlencoded`: 102400 (100 KB)
- `text`: 102400 (100 KB)
- `raw`: 1048576 (1 MB)

## Changelog

### Version 1.0.0 (Initial Implementation)

- ✅ Content-Length header validation
- ✅ Content-Type aware limits
- ✅ HTTP 413 error responses
- ✅ Detailed error information
- ✅ Request ID integration
- ✅ Comprehensive logging
- ✅ Full test coverage
- ✅ Documentation

## Future Enhancements

Potential improvements for future versions:

1. **Dynamic Limits**: Adjust limits based on user tier or API key
2. **Streaming Validation**: Support for chunked transfer encoding
3. **Compression Support**: Handle compressed payloads (gzip, deflate)
4. **Metrics Dashboard**: Real-time payload size analytics
5. **Auto-tuning**: ML-based limit recommendations based on usage patterns
