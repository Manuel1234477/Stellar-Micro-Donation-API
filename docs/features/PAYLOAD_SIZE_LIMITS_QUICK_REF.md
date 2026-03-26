# Payload Size Limits - Quick Reference

## Default Limits

| Type | Limit | Use Case |
|------|-------|----------|
| JSON | 100 KB | API requests |
| URL-encoded | 100 KB | Form data |
| Text | 100 KB | Plain text |
| Raw | 1 MB | Binary data |

## Error Response (413)

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
    "requestId": "abc-123",
    "timestamp": "2024-01-15T10:30:00.000Z"
  }
}
```

## Custom Configuration

```javascript
const { createPayloadSizeLimiter } = require('./middleware/payloadSizeLimit');

app.use(createPayloadSizeLimiter({
  json: 50 * 1024,        // 50 KB
  urlencoded: 50 * 1024,  // 50 KB
  text: 25 * 1024,        // 25 KB
  raw: 500 * 1024         // 500 KB
}));
```

## Testing

```bash
# Run tests
npm test -- tests/payloadSizeLimit.test.js

# Test with curl
curl -X POST http://localhost:3000/donations/send \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-key" \
  -d '{"amount": "10", "senderId": "1", "receiverId": "2"}'
```

## Monitoring

Watch for these log events:

```
WARN PAYLOAD_SIZE_LIMIT: Oversized payload rejected
INFO PAYLOAD_SIZE_LIMIT: Large payload detected (within limits)
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Valid requests rejected | Increase limits or optimize payload |
| Limits not enforced | Check middleware order |
| Missing Content-Length | Ensure clients send header |

## Integration Points

- Works with rate limiting
- Logs include request ID
- Contributes to abuse detection
- Consistent error format

## Files

- Middleware: `src/middleware/payloadSizeLimit.js`
- Tests: `tests/payloadSizeLimit.test.js`
- Docs: `docs/features/PAYLOAD_SIZE_LIMITS.md`
