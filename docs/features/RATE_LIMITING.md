# Rate Limiting Feature

## Overview

Rate limiting has been implemented for donation-related endpoints to prevent abuse and accidental overload. The rate limiter enforces safe request limits while ensuring normal user activity is not impacted.

## Implementation

### Middleware

The rate limiting functionality is implemented in `src/middleware/rateLimiter.js` using the `express-rate-limit` package.

### Protected Endpoints

Rate limiting is applied only to donation operation endpoints:

#### 1. Donation Creation Endpoints
- `POST /donations` - Create a new donation
- `POST /donations/send` - Send XLM and record donation

**Limits:**
- 10 requests per minute per IP address
- Stricter limit due to write operations and blockchain interactions

#### 2. Donation Verification Endpoint
- `POST /donations/verify` - Verify a transaction by hash

**Limits:**
- 30 requests per minute per IP address
- More lenient since verification is primarily a read operation

### Unaffected Endpoints

The following endpoints are NOT rate limited to ensure read operations remain fast:
- `GET /donations` - List all donations
- `GET /donations/:id` - Get specific donation
- `GET /donations/recent` - Get recent donations
- `GET /donations/limits` - Get donation limits
- `PATCH /donations/:id/status` - Update donation status
- All wallet, stats, and stream endpoints

## Rate Limit Response

### HTTP Status Code
When rate limit is exceeded, the API returns:
- **HTTP 429 (Too Many Requests)**

### Response Body
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Too many donation requests from this IP. Please try again later.",
    "retryAfter": "2024-01-15T10:30:00.000Z"
  }
}
```

### Response Headers
The following standard headers are included:
- `RateLimit-Limit` - Maximum requests allowed in the window
- `RateLimit-Remaining` - Requests remaining in current window
- `RateLimit-Reset` - Time when the rate limit resets (Unix timestamp)

## Integration with Existing Features

### Idempotency Integration
The rate limiter is integrated with the idempotency middleware:
- Requests that are served from the idempotency cache do NOT count toward the rate limit
- This prevents legitimate retry attempts from being blocked
- Only new requests consume rate limit quota

### Middleware Order
Rate limiting is applied in the correct order:
1. Rate limiter (first check)
2. API key validation (if required)
3. Idempotency check (if required)
4. Permission check (if required)
5. Business logic

## Configuration

### Adjusting Limits
To modify rate limits, edit `src/middleware/rateLimiter.js`:

```javascript
const donationRateLimiter = rateLimit({
  windowMs: 60 * 1000, // Time window in milliseconds
  max: 10, // Maximum requests per window
  // ... other options
});
```

### Per-Endpoint Customization
Different rate limiters can be applied to different endpoints:
- `donationRateLimiter` - For creation operations (stricter)
- `verificationRateLimiter` - For verification operations (more lenient)

## Testing Rate Limits

### Manual Testing
```bash
# Test donation creation rate limit (should fail after 10 requests)
for i in {1..15}; do
  curl -X POST http://localhost:3000/donations \
    -H "Content-Type: application/json" \
    -H "X-API-Key: your-api-key" \
    -H "Idempotency-Key: test-$i" \
    -d '{"amount": 10, "recipient": "GXXX..."}'
  echo "Request $i"
  sleep 1
done
```

### Expected Behavior
- Requests 1-10: Success (200/201 status)
- Requests 11+: Rate limited (429 status)
- After 60 seconds: Rate limit resets, requests succeed again

## Security Considerations

### IP-Based Limiting
- Rate limits are applied per IP address
- Protects against single-source abuse
- Does not prevent distributed attacks (consider additional DDoS protection)

### Bypass Prevention
- Rate limit is enforced before authentication
- Cannot be bypassed with different API keys from same IP
- Idempotency cache hits don't consume quota (prevents legitimate retries from being blocked)

### Production Recommendations
1. Consider implementing user-based rate limiting in addition to IP-based
2. Monitor rate limit metrics to adjust thresholds
3. Implement alerting for sustained rate limit violations
4. Consider using Redis for distributed rate limiting in multi-server deployments

## Monitoring

### Metrics to Track
- Number of rate-limited requests per endpoint
- IPs frequently hitting rate limits
- Average requests per minute per endpoint
- Rate limit reset frequency

### Logging
Rate limit violations are automatically logged by the middleware. Monitor logs for patterns:
```
[RateLimit] IP 192.168.1.1 exceeded limit on POST /donations
```

## Future Enhancements

Potential improvements for consideration:
1. User/account-based rate limiting (in addition to IP)
2. Dynamic rate limits based on user tier or reputation
3. Redis-backed rate limiting for distributed systems
4. Configurable limits via environment variables
5. Rate limit exemptions for trusted IPs
6. Exponential backoff for repeated violations

## Dependencies

- `express-rate-limit` (^7.x) - Rate limiting middleware for Express

## Related Documentation

- [Idempotency Feature](./IDEMPOTENCY.md)
- [API Flow](../API_FLOW.md)
- [Error Handling](../security/ERROR_HANDLING.md)
