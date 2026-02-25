# Rate Limiting Documentation

## Overview

The Stellar Micro-Donation API implements per-API key rate limiting to prevent abuse while ensuring legitimate traffic remains unaffected. Rate limits are enforced at the API key level, allowing fine-grained control over request rates for different consumers.

## API Key Requirement

All requests to donation endpoints must include an API key in the `X-API-Key` HTTP header.

### Example Request

```bash
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "amount": 10,
    "donor": "Alice",
    "recipient": "GBXYZ..."
  }'
```

## Rate Limit Configuration

Rate limits are configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `RATE_LIMIT_MAX_REQUESTS` | Maximum requests per time window | 100 |
| `RATE_LIMIT_WINDOW_MS` | Time window in milliseconds | 60000 (1 minute) |
| `RATE_LIMIT_CLEANUP_INTERVAL_MS` | Memory cleanup interval | 300000 (5 minutes) |

### Example Configuration

```bash
# .env file
RATE_LIMIT_MAX_REQUESTS=200
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_CLEANUP_INTERVAL_MS=300000
```

## Rate Limit Headers

All responses include standard rate limit headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the time window |
| `X-RateLimit-Remaining` | Number of requests remaining in current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the rate limit resets |

### Example Response Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705315800
```

## Error Responses

### Missing API Key (401)

When the `X-API-Key` header is missing or empty:

```json
{
  "success": false,
  "error": {
    "code": "MISSING_API_KEY",
    "message": "API key is required. Please provide X-API-Key header"
  }
}
```

### Rate Limit Exceeded (429)

When the rate limit is exceeded:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later",
    "limit": 100,
    "resetAt": "2024-01-15T10:30:00.000Z"
  }
}
```

Response headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1705315800
```

## Rate Limiting Behavior

### Per-API Key Tracking

- Each API key has its own independent rate limit counter
- One API key reaching its limit does not affect other API keys
- Counters reset automatically after the time window expires

### Sliding Window

The rate limiter uses a sliding window counter algorithm:
- Requests are counted within a fixed time window
- When the window expires, the counter resets to zero
- New requests start a new time window

### Example Scenario

With a limit of 100 requests per minute:

1. **Request 1-100**: All succeed (status 200)
   - Headers show decreasing `X-RateLimit-Remaining`
2. **Request 101**: Rate limited (status 429)
   - Error response includes `resetAt` timestamp
3. **After 1 minute**: Counter resets
   - Next request succeeds

## Best Practices

### For API Consumers

1. **Monitor Headers**: Check `X-RateLimit-Remaining` to avoid hitting limits
2. **Handle 429 Errors**: Implement exponential backoff when rate limited
3. **Use Unique Keys**: Each application should use its own API key
4. **Respect Reset Time**: Wait until `resetAt` before retrying

### Example: Handling Rate Limits

```javascript
async function makeRequest(apiKey) {
  const response = await fetch('http://localhost:3000/donations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ amount: 10, recipient: 'GBXYZ...' })
  });

  if (response.status === 429) {
    const data = await response.json();
    const resetAt = new Date(data.error.resetAt);
    const waitTime = resetAt - Date.now();
    
    console.log(`Rate limited. Retry after ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Retry request
    return makeRequest(apiKey);
  }

  return response.json();
}
```

## Testing

### Running Tests

```bash
npm test tests/rateLimiter.test.js
```

### Test Configuration

Tests use shorter time windows for faster execution:

```javascript
const rateLimiter = require('./middleware/rateLimiter');

// Test with 1-second window
app.use(rateLimiter({ limit: 10, windowMs: 1000 }));
```

## Architecture

### Components

1. **RateLimiter Middleware** (`src/middleware/rateLimiter.js`)
   - Express middleware that enforces rate limits
   - Extracts API key from headers
   - Checks and increments request counters

2. **RequestCounter** (`src/middleware/RequestCounter.js`)
   - Tracks request counts per API key
   - Manages time windows and expiration
   - Automatic memory cleanup

3. **Configuration** (`src/config/rateLimit.js`)
   - Loads settings from environment variables
   - Validates configuration values
   - Provides defaults

### Data Flow

```
Client Request
    ↓
Rate Limiter Middleware
    ↓
Extract API Key
    ↓
Check Counter
    ↓
Within Limit? → Yes → Increment → Add Headers → Next Middleware
    ↓
    No → Return 429 Error
```

## Performance

- **Lookup Time**: O(1) using JavaScript Map
- **Memory**: Automatic cleanup of expired entries
- **Overhead**: <10ms for 95% of requests
- **Throughput**: Handles 1000+ requests/second

## Security Considerations

1. **API Key Storage**: Store API keys securely (environment variables, secrets manager)
2. **Key Rotation**: Implement periodic key rotation for enhanced security
3. **Monitoring**: Log rate limit violations for abuse detection
4. **DDoS Protection**: Rate limiting provides basic DDoS protection per API key

## Troubleshooting

### Issue: All requests return 401

**Cause**: Missing or empty `X-API-Key` header

**Solution**: Ensure all requests include a valid API key:
```bash
curl -H "X-API-Key: your-key" http://localhost:3000/donations
```

### Issue: Unexpected 429 errors

**Cause**: Rate limit exceeded

**Solutions**:
1. Check `X-RateLimit-Remaining` header before making requests
2. Increase `RATE_LIMIT_MAX_REQUESTS` if legitimate traffic is affected
3. Implement request queuing or throttling in your application

### Issue: Rate limits not resetting

**Cause**: Time window not expired

**Solution**: Wait for the time specified in `X-RateLimit-Reset` header

## Future Enhancements

Potential improvements for production deployments:

1. **Distributed Storage**: Use Redis for multi-instance deployments
2. **Dynamic Limits**: Different limits per API key tier
3. **Burst Allowance**: Allow short bursts above the limit
4. **Rate Limit Analytics**: Dashboard for monitoring usage patterns
