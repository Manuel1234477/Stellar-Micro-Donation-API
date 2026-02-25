# Abuse Detection System

**Status:** Observability Only (No Blocking)  
**Issue:** #181

## Overview

Lightweight abuse detection system that tracks suspicious patterns and logs signals without blocking legitimate traffic. Designed for observability and future integration with blocking mechanisms.

## Features

### 1. Request Burst Detection
Tracks request volume per IP address within a time window.

**Threshold:** 100 requests per minute  
**Action:** Flag IP and log warning  
**No blocking:** Traffic continues normally

### 2. Repeated Failure Detection
Tracks failed requests (4xx/5xx responses) per IP address.

**Threshold:** 20 failures per 5 minutes  
**Action:** Flag IP and log warning  
**No blocking:** Traffic continues normally

### 3. Automatic Unflagging
Flagged IPs are automatically unflagged after 1 hour cooldown period.

## Architecture

```
Request → Middleware → Track Request → Check Thresholds → Flag if Exceeded
                                                         ↓
                                                    Log Warning
                                                         ↓
                                                  Add Header (X-Abuse-Signal)
                                                         ↓
                                                  Continue Processing
```

## Configuration

Located in `src/utils/abuseDetector.js`:

```javascript
{
  burstThreshold: 100,      // requests per window
  burstWindow: 60000,       // 1 minute
  failureThreshold: 20,     // failures per window
  failureWindow: 300000,    // 5 minutes
  cleanupInterval: 600000   // 10 minutes
}
```

## Usage

### Automatic Tracking

The middleware automatically tracks all requests:

```javascript
// In src/routes/app.js
app.use(abuseDetectionMiddleware);
```

### Observability Endpoint

Admin-only endpoint to view current statistics:

```bash
GET /abuse-signals
Authorization: x-api-key: <admin-key>

Response:
{
  "success": true,
  "data": {
    "suspiciousIPs": 3,
    "trackedIPs": 150,
    "failureTracking": 45
  },
  "timestamp": "2026-02-25T01:00:00.000Z"
}
```

### Response Headers

Flagged IPs receive a header for observability:

```
X-Abuse-Signal: flagged
```

## Signals Logged

### Request Burst Signal
```json
{
  "level": "WARN",
  "scope": "ABUSE_DETECTION",
  "message": "Suspicious activity detected: request_burst",
  "ip": "192.168.1.100",
  "signal": "request_burst",
  "count": 105,
  "threshold": 100,
  "window": 60000,
  "timestamp": "2026-02-25T01:00:00.000Z"
}
```

### Repeated Failures Signal
```json
{
  "level": "WARN",
  "scope": "ABUSE_DETECTION",
  "message": "Suspicious activity detected: repeated_failures",
  "ip": "192.168.1.101",
  "signal": "repeated_failures",
  "count": 25,
  "threshold": 20,
  "window": 300000,
  "reason": "client_error",
  "timestamp": "2026-02-25T01:00:00.000Z"
}
```

## Monitoring

### Log Analysis

Search logs for abuse signals:

```bash
# Find all abuse signals
grep "ABUSE_DETECTION" logs/app.log

# Find specific signal types
grep "request_burst" logs/app.log
grep "repeated_failures" logs/app.log

# Find flagged IPs
grep "Suspicious activity detected" logs/app.log | jq '.ip'
```

### Metrics

Track these metrics in your monitoring system:
- `abuse.suspicious_ips` - Number of flagged IPs
- `abuse.tracked_ips` - Total IPs being tracked
- `abuse.burst_signals` - Count of burst signals
- `abuse.failure_signals` - Count of failure signals

## False Positives

### Prevention Strategies

1. **High Thresholds:** Conservative limits reduce false positives
2. **No Blocking:** Legitimate traffic never interrupted
3. **Auto-Unflagging:** 1-hour cooldown prevents permanent flags
4. **Observability First:** Review logs before implementing blocks

### Tuning

Adjust thresholds based on your traffic patterns:

```javascript
// For high-traffic APIs
burstThreshold: 200
failureThreshold: 50

// For low-traffic APIs
burstThreshold: 50
failureThreshold: 10
```

## Production Considerations

### 1. Persistent Storage

Current implementation uses in-memory storage. For production:

```javascript
// Use Redis for distributed tracking
const redis = require('redis');
const client = redis.createClient();

// Store counts in Redis with TTL
await client.setex(`abuse:req:${ip}`, 60, count);
```

### 2. Distributed Systems

For multi-instance deployments:
- Use shared Redis/Memcached
- Aggregate signals across instances
- Centralized monitoring dashboard

### 3. Integration with WAF

Export signals to Web Application Firewall:

```javascript
// Send to WAF
if (abuseDetector.isSuspicious(ip)) {
  await waf.addToWatchlist(ip, { reason: signal, ttl: 3600 });
}
```

## Testing

Run abuse detection tests:

```bash
npm test tests/abuse-detection.test.js
```

Test coverage:
- Request burst detection
- Failure tracking
- Threshold enforcement
- Cleanup mechanisms
- Edge cases (null IPs, etc.)

## Future Enhancements

1. **Rate Limiting Integration:** Auto-apply stricter limits to flagged IPs
2. **Machine Learning:** Pattern recognition for sophisticated attacks
3. **Geo-blocking:** Track suspicious regions
4. **API Key Correlation:** Link abuse to specific API keys
5. **Automated Blocking:** Optional blocking mode with safeguards

## Compliance

✅ No false blocking - traffic never interrupted  
✅ Signals are observable - logs and endpoint available  
✅ Privacy-friendly - only tracks IPs, no PII  
✅ Configurable - thresholds adjustable per environment  
✅ Automatic cleanup - no indefinite tracking  

## Support

For issues or questions:
- Check logs: `grep ABUSE_DETECTION logs/app.log`
- View stats: `GET /abuse-signals`
- Adjust config: `src/utils/abuseDetector.js`
