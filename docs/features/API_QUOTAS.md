# API Usage Quotas

## Overview

API usage quotas allow you to limit the number of API requests per month for each API key. This is essential for SaaS deployments where billing is tied to API usage. When a quota is exceeded, requests are rejected with HTTP 429, and webhook events are fired for billing integration.

## Features

- **Monthly Request Quotas**: Set a maximum number of requests per API key per month
- **Automatic Reset**: Quotas automatically reset on the first day of each month at midnight UTC
- **Real-time Tracking**: Usage is tracked in real-time with every successful request
- **Quota Headers**: Response headers show remaining quota and reset date
- **Webhook Integration**: Events fired when quotas are exceeded or reset
- **Timezone Safe**: All resets happen at UTC midnight to avoid timezone edge cases

## Configuration

### Creating an API Key with Quota

```javascript
const { createApiKey } = require('./src/models/apiKeys');

const key = await createApiKey({
  name: 'Production API Key',
  role: 'user',
  monthlyQuota: 10000, // 10,000 requests per month
  createdBy: 'admin',
});

console.log(`API Key: ${key.key}`);
console.log(`Monthly Quota: ${key.monthlyQuota}`);
console.log(`Quota Resets: ${key.quotaResetAt}`);
```

### API Key Properties

- `monthlyQuota` (integer, optional): Maximum requests per month. If null, no quota is enforced.
- `quotaUsed` (integer): Current usage count for the month
- `quotaResetAt` (timestamp): When the quota will reset (first of next month, UTC midnight)

## Usage

### Response Headers

Every authenticated request with a quota includes these headers:

```http
X-Quota-Limit: 10000
X-Quota-Remaining: 9847
X-Quota-Reset: 2024-02-01T00:00:00.000Z
```

- **X-Quota-Limit**: Total monthly quota
- **X-Quota-Remaining**: Requests remaining in current period
- **X-Quota-Reset**: ISO 8601 timestamp when quota resets

### Quota Exceeded Response

When quota is exceeded, the API returns HTTP 429:

```json
{
  "success": false,
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Monthly API quota exceeded",
    "requestId": "req_abc123",
    "timestamp": "2024-01-15T14:30:00.000Z",
    "quotaResetAt": "2024-02-01T00:00:00.000Z"
  }
}
```

## Webhook Events

### quota.exceeded

Fired when an API key exceeds its monthly quota.

**Payload:**
```json
{
  "event": "quota.exceeded",
  "data": {
    "keyId": 42,
    "keyName": "Production API Key",
    "quotaUsed": 10000,
    "monthlyQuota": 10000,
    "quotaResetAt": "2024-02-01T00:00:00.000Z"
  },
  "timestamp": "2024-01-15T14:30:00.000Z"
}
```

### quota.reset

Fired when quotas are reset on the first of the month.

**Payload:**
```json
{
  "event": "quota.reset",
  "data": {
    "keysReset": 15,
    "resetAt": "2024-02-01T00:01:00.000Z"
  },
  "timestamp": "2024-02-01T00:01:00.000Z"
}
```

## Implementation Details

### Quota Tracking

Quotas are incremented after each successful request (HTTP 2xx or 3xx). Failed requests (4xx, 5xx) do not count against the quota.

The `quotaTracker` middleware runs after the response is sent:

```javascript
// In src/routes/app.js
app.use(requireApiKey);
app.use(trackQuotaUsage); // Tracks quota after response
```

### Monthly Reset

The `quotaResetJob` runs hourly to check for expired quotas:

```javascript
const { startQuotaResetJob } = require('./src/jobs/quotaResetJob');

// Start the background job
const stopJob = startQuotaResetJob();

// Stop on shutdown
process.on('SIGTERM', stopJob);
```

### Timezone Handling

All quota resets occur at **UTC midnight** on the first of the month. This prevents timezone-related edge cases where users in different timezones might experience resets at different local times.

```javascript
// Reset date is always UTC midnight
const resetDate = new Date('2024-02-01T00:00:00.000Z');
```

## Security Considerations

### Quota Bypass Prevention

- Quotas are checked **before** request processing
- Quota state is stored in the database, not in memory
- Atomic increment operations prevent race conditions
- Failed authentication attempts do not consume quota

### Reset Atomicity

Quota resets are atomic database operations:

```sql
UPDATE api_keys 
SET quota_used = 0, quota_reset_at = ?
WHERE monthly_quota IS NOT NULL 
  AND quota_reset_at <= ?
```

### Audit Trail

All quota-related events are logged:
- Quota exceeded attempts
- Successful quota resets
- Webhook delivery failures

## Testing

Run the quota test suite:

```bash
npm test tests/api-quotas.test.js
```

### Test Coverage

- ✅ Requests exceeding quota return 429
- ✅ X-Quota-Remaining header accuracy
- ✅ Monthly reset on first of month
- ✅ Webhook events fire on exceeded and reset
- ✅ Timezone edge case handling
- ✅ Quota bypass prevention

## Monitoring

### Key Metrics

Monitor these metrics for quota health:

- **Quota Utilization**: `quota_used / monthly_quota`
- **Keys Near Limit**: Keys with >90% quota used
- **Exceeded Events**: Count of `quota.exceeded` webhooks
- **Reset Success Rate**: Successful monthly resets

### Example Query

```sql
SELECT 
  id,
  name,
  quota_used,
  monthly_quota,
  ROUND(100.0 * quota_used / monthly_quota, 2) as utilization_pct
FROM api_keys
WHERE monthly_quota IS NOT NULL
  AND quota_used > (monthly_quota * 0.9)
ORDER BY utilization_pct DESC;
```

## Billing Integration

### Webhook Handler Example

```javascript
// Your billing system webhook handler
app.post('/webhooks/stellar-api', (req, res) => {
  const { event, data } = req.body;
  
  if (event === 'quota.exceeded') {
    // Notify customer
    sendEmail(data.keyName, {
      subject: 'API Quota Exceeded',
      message: `Your API key has exceeded its monthly quota of ${data.monthlyQuota} requests.`,
    });
    
    // Trigger billing upgrade flow
    triggerUpgradePrompt(data.keyId);
  }
  
  if (event === 'quota.reset') {
    // Log for billing cycle
    logBillingCycle(data.resetAt, data.keysReset);
  }
  
  res.status(200).send('OK');
});
```

## API Reference

### Functions

#### `createApiKey({ monthlyQuota, ... })`

Create a new API key with optional quota.

**Parameters:**
- `monthlyQuota` (integer, optional): Monthly request limit

**Returns:** API key object with quota fields

#### `incrementQuota(keyId)`

Increment quota usage for an API key.

**Parameters:**
- `keyId` (integer): API key ID

**Returns:** `{ quotaUsed, quotaRemaining }`

#### `resetQuota(keyId)`

Manually reset quota for a specific key.

**Parameters:**
- `keyId` (integer): API key ID

**Returns:** `true` if successful

#### `resetExpiredQuotas()`

Reset all quotas that have passed their reset date.

**Returns:** Number of keys reset

## Troubleshooting

### Quota Not Resetting

Check the quota reset job is running:

```javascript
const { checkAndResetQuotas } = require('./src/jobs/quotaResetJob');
await checkAndResetQuotas();
```

### Incorrect Quota Count

Verify database state:

```sql
SELECT id, name, quota_used, monthly_quota, quota_reset_at 
FROM api_keys 
WHERE id = ?;
```

### Webhook Not Firing

Check webhook configuration and logs:

```javascript
const WebhookService = require('./src/services/WebhookService');
// Webhooks are fire-and-forget; check logs for delivery errors
```

## Migration

To add quotas to existing API keys:

```sql
-- Add quota columns (already in schema)
ALTER TABLE api_keys ADD COLUMN monthly_quota INTEGER;
ALTER TABLE api_keys ADD COLUMN quota_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_keys ADD COLUMN quota_reset_at INTEGER;

-- Set quota for specific keys
UPDATE api_keys 
SET monthly_quota = 10000,
    quota_reset_at = strftime('%s', 'now', 'start of month', '+1 month') * 1000
WHERE name = 'Production Key';
```

## Best Practices

1. **Set Reasonable Quotas**: Start with generous quotas and adjust based on usage patterns
2. **Monitor Utilization**: Alert when keys reach 80% of quota
3. **Communicate Limits**: Document quota limits in your API documentation
4. **Provide Upgrade Path**: Make it easy for users to increase quotas
5. **Test Reset Logic**: Verify monthly resets work correctly in your timezone
6. **Handle 429 Gracefully**: Implement exponential backoff in client SDKs

## Related Documentation

- [API Key Management](./API_KEY_ROTATION.md)
- [Webhook Configuration](./WEBHOOK_IDEMPOTENCY.md)
- [Rate Limiting](../RATE_LIMITING.md)
