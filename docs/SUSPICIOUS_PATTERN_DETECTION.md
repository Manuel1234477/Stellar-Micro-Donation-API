# Suspicious Pattern Detection - Soft Alerts

## Overview

The Suspicious Pattern Detection system provides **observability-only** alerts for suspicious usage patterns without blocking legitimate requests. It logs structured alerts for security monitoring and analysis.

## Key Principles

1. **Non-Blocking**: Never blocks or rejects requests
2. **Observable**: All signals logged with structured data
3. **No False Positives Disruption**: Thresholds tuned to avoid legitimate use cases
4. **Metrics-Driven**: Provides real-time metrics for monitoring

## Suspicious Heuristics

### 1. High Velocity Donations
**Pattern**: Rapid succession of donations from same IP

- **Threshold**: 5 donations within 5 minutes
- **Signal**: `high_velocity_donations`
- **Severity**: Medium
- **Indicates**: Potential automation or bot activity

### 2. Identical Amount Pattern
**Pattern**: Repeated identical donation amounts

- **Threshold**: 3+ identical amounts within 10 minutes
- **Signal**: `identical_amount_pattern`
- **Severity**: Medium
- **Indicates**: Automated donation scripts

### 3. High Recipient Diversity
**Pattern**: Single donor sending to many unique recipients

- **Threshold**: 10+ unique recipients per donor
- **Signal**: `high_recipient_diversity`
- **Severity**: High
- **Indicates**: Potential money laundering or distribution schemes

### 4. Sequential Failures
**Pattern**: Consecutive failed requests without success

- **Threshold**: 5+ sequential failures
- **Signal**: `sequential_failures`
- **Severity**: Low
- **Indicates**: Probing, credential stuffing, or API exploration

### 5. Off-Hours Activity
**Pattern**: Excessive requests during off-hours (2 AM - 6 AM UTC)

- **Threshold**: 20+ requests during off-hours window
- **Signal**: `off_hours_activity`
- **Severity**: Low
- **Indicates**: Automated scripts or unusual timing patterns

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Request Pipeline                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│         Suspicious Pattern Detection Middleware          │
│  (Observability Only - No Blocking)                      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│         SuspiciousPatternDetector (Singleton)            │
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Pattern Tracking Stores                         │   │
│  │  • velocityTracking (IP → donations)             │   │
│  │  • amountPatterns (IP → amounts)                 │   │
│  │  • recipientPatterns (donor → recipients)        │   │
│  │  • sequentialFailures (IP → failure count)       │   │
│  │  • timePatterns (IP → request timestamps)        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Detection Methods                               │   │
│  │  • detectHighVelocity()                          │   │
│  │  • detectIdenticalAmounts()                      │   │
│  │  • detectRecipientDiversity()                    │   │
│  │  • detectSequentialFailures()                    │   │
│  │  • detectOffHoursActivity()                      │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│              Structured Logging (log.warn)               │
│  Signal Type | Identifier | Metadata | Severity          │
└─────────────────────────────────────────────────────────┘
```

## Usage

### Automatic Integration

The middleware is automatically integrated into the request pipeline:

```javascript
// src/routes/app.js
app.use(require('../middleware/suspiciousPatternDetection'));
```

### Manual Detection

You can also use the detector directly:

```javascript
const suspiciousPatternDetector = require('../utils/suspiciousPatternDetector');

// Detect high velocity
suspiciousPatternDetector.detectHighVelocity(ip, {
  amount: 10,
  recipient: 'RECIPIENT_KEY'
});

// Detect identical amounts
suspiciousPatternDetector.detectIdenticalAmounts(ip, 5.5);

// Detect recipient diversity
suspiciousPatternDetector.detectRecipientDiversity(donorKey, recipientKey);

// Detect sequential failures
suspiciousPatternDetector.detectSequentialFailures(ip, 'AUTH_FAILED');

// Reset failures on success
suspiciousPatternDetector.resetFailures(ip);
```

### Metrics Endpoint

Admin-only endpoint to view current metrics:

```bash
GET /suspicious-patterns
Authorization: Bearer <admin-api-key>
```

Response:
```json
{
  "success": true,
  "data": {
    "velocityTracking": 5,
    "amountPatterns": 3,
    "recipientPatterns": 2,
    "sequentialFailures": 1,
    "timePatterns": 4
  },
  "timestamp": "2026-02-26T12:00:00.000Z"
}
```

## Log Format

All alerts are logged with structured data:

```json
{
  "level": "warn",
  "scope": "SUSPICIOUS_PATTERN",
  "message": "Suspicious pattern detected: high_velocity_donations",
  "signal": "high_velocity_donations",
  "identifier": "192.168.1.100",
  "count": 6,
  "threshold": 5,
  "window": 300000,
  "pattern": "rapid_succession",
  "severity": "medium",
  "timestamp": "2026-02-26T12:00:00.000Z"
}
```

## Configuration

Thresholds can be adjusted in `src/utils/suspiciousPatternDetector.js`:

```javascript
this.thresholds = {
  velocityWindow: 300000,           // 5 minutes
  velocityLimit: 5,                 // donations per window
  identicalAmountCount: 3,          // same amount repeated
  identicalAmountWindow: 600000,    // 10 minutes
  recipientDiversityLimit: 10,      // unique recipients
  sequentialFailureLimit: 5,        // consecutive failures
  offHoursStart: 2,                 // 2 AM UTC
  offHoursEnd: 6,                   // 6 AM UTC
  offHoursRequestLimit: 20,         // requests during off-hours
  cleanupInterval: 900000           // 15 minutes
};
```

## Monitoring & Alerting

### Log Aggregation

Integrate with log aggregation systems (ELK, Splunk, Datadog):

```bash
# Search for suspicious patterns
grep "SUSPICIOUS_PATTERN" logs/app.log | jq .

# Filter by severity
grep "SUSPICIOUS_PATTERN" logs/app.log | jq 'select(.severity == "high")'

# Count by signal type
grep "SUSPICIOUS_PATTERN" logs/app.log | jq -r .signal | sort | uniq -c
```

### Alerting Rules

Example alerting rules for production:

1. **High Severity Alerts**: Immediate notification
   - `high_recipient_diversity` with severity=high

2. **Medium Severity Alerts**: Aggregate and review
   - `high_velocity_donations` > 10 occurrences/hour
   - `identical_amount_pattern` > 5 occurrences/hour

3. **Low Severity Alerts**: Daily digest
   - `sequential_failures` patterns
   - `off_hours_activity` patterns

## Testing

### Unit Tests

```bash
npm test tests/suspicious-pattern-detection.test.js
```

Coverage:
- ✅ All 5 heuristics
- ✅ Threshold validation
- ✅ Window expiration
- ✅ Cleanup logic
- ✅ No false positives
- ✅ Non-blocking behavior

### Integration Tests

```bash
npm test tests/suspicious-pattern-middleware.test.js
```

Coverage:
- ✅ Middleware integration
- ✅ Request processing
- ✅ Error handling
- ✅ Non-blocking guarantee
- ✅ Extreme load scenarios

## Performance

### Memory Usage

- In-memory tracking with automatic cleanup
- Cleanup runs every 15 minutes
- Old entries removed after 2x window expiration
- Typical memory: < 10 MB for 1000 tracked IPs

### CPU Impact

- Minimal overhead: < 1ms per request
- No blocking operations
- Async-safe (no race conditions)

### Scalability

For production at scale:

1. **Redis Backend**: Replace in-memory Maps with Redis
2. **Distributed Tracking**: Share state across instances
3. **Rate Limiting**: Add rate limits to metrics endpoint

## Security Considerations

### Privacy

- IP addresses are logged (consider hashing for GDPR)
- No PII stored in pattern tracking
- Automatic cleanup prevents long-term storage

### False Positives

Thresholds tuned to minimize false positives:

- ✅ Legitimate high-volume users not flagged
- ✅ Varied donation amounts not flagged
- ✅ Normal recipient diversity not flagged
- ✅ Isolated failures not flagged

### Response Actions

This system is **observability-only**. For active response:

1. Review logs and metrics
2. Identify genuine threats
3. Manually block IPs via firewall/WAF
4. Adjust thresholds if needed

## Troubleshooting

### No Alerts Generated

Check:
1. Middleware is registered in `app.js`
2. Logger is configured correctly
3. Thresholds are not too high
4. Patterns actually match heuristics

### Too Many Alerts

Adjust thresholds:
1. Increase limits (e.g., `velocityLimit: 10`)
2. Extend windows (e.g., `velocityWindow: 600000`)
3. Review legitimate use cases

### Memory Growth

Check cleanup:
1. Verify cleanup timer is running
2. Check `NODE_ENV !== 'test'`
3. Monitor metrics endpoint
4. Manually trigger `cleanup()`

## Future Enhancements

1. **Machine Learning**: Anomaly detection with ML models
2. **Geolocation**: Track suspicious geographic patterns
3. **Device Fingerprinting**: Detect device-based patterns
4. **Behavioral Analysis**: User behavior profiling
5. **Integration**: Connect to SIEM systems

## References

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Rate Limiting Best Practices](https://cloud.google.com/architecture/rate-limiting-strategies-techniques)
- [Fraud Detection Patterns](https://stripe.com/docs/radar/rules)
