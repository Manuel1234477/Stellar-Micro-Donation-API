# Rate Limiting Quick Reference

## At a Glance

| Endpoint | Method | Rate Limit | Window |
|----------|--------|------------|--------|
| `/donations` | POST | 10 req/min | 60s |
| `/donations/send` | POST | 10 req/min | 60s |
| `/donations/verify` | POST | 30 req/min | 60s |
| All other endpoints | * | No limit | - |

## Response Codes

- **200/201**: Success (within rate limit)
- **429**: Too Many Requests (rate limit exceeded)

## Rate Limit Headers

Every response includes:
```
RateLimit-Limit: 10
RateLimit-Remaining: 7
RateLimit-Reset: 1705320600
```

## Error Response

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

## Client Implementation

### JavaScript/Node.js
```javascript
async function createDonation(data) {
  try {
    const response = await fetch('http://localhost:3000/donations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'your-api-key',
        'Idempotency-Key': generateUniqueKey()
      },
      body: JSON.stringify(data)
    });

    if (response.status === 429) {
      const error = await response.json();
      const retryAfter = new Date(error.error.retryAfter);
      console.log(`Rate limited. Retry after: ${retryAfter}`);
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, 60000));
      return createDonation(data);
    }

    return await response.json();
  } catch (error) {
    console.error('Request failed:', error);
    throw error;
  }
}
```

### Python
```python
import requests
import time
from datetime import datetime

def create_donation(data):
    url = 'http://localhost:3000/donations'
    headers = {
        'Content-Type': 'application/json',
        'X-API-Key': 'your-api-key',
        'Idempotency-Key': generate_unique_key()
    }
    
    response = requests.post(url, json=data, headers=headers)
    
    if response.status_code == 429:
        error = response.json()
        retry_after = datetime.fromisoformat(error['error']['retryAfter'].replace('Z', '+00:00'))
        print(f"Rate limited. Retry after: {retry_after}")
        time.sleep(60)
        return create_donation(data)
    
    return response.json()
```

### cURL
```bash
# Make request
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -H "Idempotency-Key: unique-key-123" \
  -d '{"amount": 10, "recipient": "GXXX..."}'

# Check rate limit headers
curl -i -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -H "Idempotency-Key: unique-key-456" \
  -d '{"amount": 10, "recipient": "GXXX..."}'
```

## Best Practices

### 1. Check Headers
Always check `RateLimit-Remaining` header to know how many requests you have left.

### 2. Implement Exponential Backoff
```javascript
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 429 && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
}
```

### 3. Use Idempotency Keys
Idempotent requests that hit the cache don't count toward rate limit:
```javascript
const idempotencyKey = `${userId}-${timestamp}-${randomId}`;
```

### 4. Batch Operations
If you need to create multiple donations, space them out:
```javascript
for (const donation of donations) {
  await createDonation(donation);
  await new Promise(resolve => setTimeout(resolve, 6000)); // 6s between requests
}
```

### 5. Monitor Your Usage
Track your rate limit usage:
```javascript
function logRateLimit(response) {
  const limit = response.headers.get('RateLimit-Limit');
  const remaining = response.headers.get('RateLimit-Remaining');
  const reset = response.headers.get('RateLimit-Reset');
  
  console.log(`Rate Limit: ${remaining}/${limit} (resets at ${new Date(reset * 1000)})`);
}
```

## Testing Rate Limits

### Quick Test
```bash
# Run the test script
npm run test:rate-limit
```

### Manual Test
```bash
# Send 12 requests rapidly
for i in {1..12}; do
  curl -X POST http://localhost:3000/donations \
    -H "Content-Type: application/json" \
    -H "X-API-Key: test-key" \
    -H "Idempotency-Key: test-$i" \
    -d '{"amount": 10, "recipient": "GXXX..."}' &
done
wait
```

## Troubleshooting

### Getting 429 Too Quickly?
- Check if you're reusing idempotency keys (they should be unique)
- Verify you're not sharing an IP with other developers
- Consider implementing request queuing

### Rate Limit Not Working?
- Ensure `express-rate-limit` is installed: `npm install express-rate-limit`
- Check middleware order in routes
- Verify server restart after changes

### Need Higher Limits?
Edit `src/middleware/rateLimiter.js`:
```javascript
const donationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // Increase from 10 to 20
  // ...
});
```

## Configuration

### Current Limits
- **Donation Creation**: 10 requests/minute
- **Verification**: 30 requests/minute
- **Window**: 60 seconds
- **Scope**: Per IP address

### Adjusting Limits
See [Rate Limiting Documentation](./RATE_LIMITING.md#configuration) for details on modifying limits.

## Related Documentation

- [Full Rate Limiting Documentation](./RATE_LIMITING.md)
- [Idempotency Feature](./IDEMPOTENCY.md)
- [API Flow](../API_FLOW.md)
