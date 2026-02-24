# Rate Limiting Quick Start Guide

## 🚀 Quick Setup

### 1. Configuration (Optional)
Create or update `.env` file:
```bash
RATE_LIMIT_MAX_REQUESTS=100
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_CLEANUP_INTERVAL_MS=300000
```

### 2. Start Server
```bash
npm start
```

### 3. Make Requests
```bash
curl -X POST http://localhost:3000/donations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: my-api-key" \
  -d '{"amount": 10, "recipient": "GBXYZ..."}'
```

## 📋 Testing

### Manual Test
```bash
node test-rate-limit.js
```

### API Integration Test
```bash
# Terminal 1: Start server
npm start

# Terminal 2: Run test
node test-rate-limit-api.js
```

## 🔑 API Key Usage

### Required Header
All donation endpoints require:
```
X-API-Key: your-api-key-here
```

### Endpoints Protected
- POST /donations
- POST /donations/verify
- GET /donations
- GET /donations/:id

## 📊 Response Headers

Every response includes:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1705315800
```

## ⚠️ Error Codes

### 401 - Missing API Key
```json
{
  "success": false,
  "error": {
    "code": "MISSING_API_KEY",
    "message": "API key is required. Please provide X-API-Key header"
  }
}
```

### 429 - Rate Limit Exceeded
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

## 🎯 Default Limits

- **Requests**: 100 per window
- **Window**: 60 seconds (1 minute)
- **Cleanup**: Every 5 minutes

## 💡 Tips

1. **Monitor Headers**: Check `X-RateLimit-Remaining` before making requests
2. **Handle 429**: Implement retry logic with exponential backoff
3. **Unique Keys**: Use different API keys for different applications
4. **Respect Reset**: Wait until `resetAt` time before retrying

## 📚 Full Documentation

See `RATE_LIMITING.md` for complete documentation.
