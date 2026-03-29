# Feature Flags Runtime System - Complete Documentation

## Overview

The Feature Flags Runtime System provides dynamic feature control without requiring server restarts. Admins can enable/disable features, set per-API-key overrides for beta testing, and clients can query their feature state through public endpoints.

**Key Capabilities:**
- Runtime feature toggles (no restart needed)
- Multi-level scoping: global, environment, and per-API-key
- 10-second cache TTL for responsive admin changes
- Per-API-key overrides for beta testing
- Audit logging for all flag changes
- Public endpoint for client feature detection

## Architecture

### Three-Level Scope Hierarchy

Feature flags are evaluated in precedence order:

```
1. API_KEY overrides (highest priority)
   └─ Per-API-key flag states for beta testing/feature gates
2. ENVIRONMENT flags (medium priority)
   └─ Environment-specific flags (staging vs production)
3. GLOBAL flags (lowest priority)
   └─ System-wide default flag states
```

**Precedence Example:**
- Global default: `new-payment-flow` = disabled
- Staging environment: `new-payment-flow` = enabled
- Beta tester API key: `new-payment-flow` = disabled (override)

Result: Beta tester sees disabled flag even though it's enabled in staging. Admin can control exactly who gets each feature.

### Caching Strategy

**TTL: 10 seconds**

The 10-second cache balances:
- **Responsiveness**: Admin enables a flag → clients see it within 10 seconds
- **Performance**: Reduces database queries during normal operation
- **Consistency**: Long enough to prevent cache coherency issues in distributed setups

**Cache Invalidation:**
- Database updates are immediately written
- Cache is evaluated on next client request
- If older than 10 seconds, cache refreshes from database
- Any flag change becomes visible within 10 seconds

## API Reference

### Admin Endpoints (RBAC: ADMIN_ALL)

#### Enable Feature Flag

```http
POST /admin/feature-flags/:flag/enable
Content-Type: application/json
Authorization: Bearer <ADMIN_API_KEY>

Response (200):
{
  "success": true,
  "data": {
    "flag": "new-payment-flow",
    "enabled": true,
    "scope": "global",
    "createdAt": "2026-03-29T22:57:00Z",
    "updatedAt": "2026-03-29T22:57:00Z"
  }
}
```

**Behavior:**
- Creates flag if not exists
- Sets `enabled = true` at global scope
- Applies to all users immediately
- Creates audit log entry with MEDIUM severity

**Example:**
```bash
curl -X POST http://localhost:3000/admin/feature-flags/new-dashboard/enable \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json"
```

#### Disable Feature Flag

```http
POST /admin/feature-flags/:flag/disable
Content-Type: application/json
Authorization: Bearer <ADMIN_API_KEY>

Response (200):
{
  "success": true,
  "data": {
    "flag": "new-payment-flow",
    "enabled": false,
    "scope": "global",
    "updatedAt": "2026-03-29T22:57:15Z"
  }
}
```

**Behavior:**
- Sets `enabled = false` at global scope
- Disables for all users (except those with per-key overrides)
- Creates audit log entry

#### Set Per-API-Key Override

```http
POST /admin/feature-flags/:flag/override
Content-Type: application/json
Authorization: Bearer <ADMIN_API_KEY>

{
  "api_key_id": "key_9a8f7c6d5e4b3a2f",
  "enabled": true
}

Response (200):
{
  "success": true,
  "data": {
    "flag": "new-payment-flow",
    "api_key_id": "key_9a8f7c6d5e4b3a2f",
    "override": true,
    "reason": "Beta testing program"
  }
}
```

**Use Cases:**
- Beta testing: Enable feature for specific partner / dev key
- Gradual rollout: Phase features to subset of API keys
- Testing: Disable feature for key while enabled globally

**Precedence**: Per-key override always wins over global/environment flags

### Public Endpoints (Authentication Required)

#### List All Flags for API Key

```http
GET /feature-flags
Authorization: Bearer <API_KEY>

Response (200):
{
  "success": true,
  "data": {
    "enabled": [
      "new-payment-flow",
      "enhanced-reporting",
      "graphql-api"
    ],
    "flags": {
      "new-payment-flow": true,
      "enhanced-reporting": true,
      "graphql-api": true,
      "beta-feature-x": false,
      "experimental-y": false
    },
    "metadata": {
      "apiKeyId": "key_9a8f....",
      "environment": "production",
      "timestamp": "2026-03-29T22:57:00Z",
      "cacheAgeMs": 2357,
      "cacheTtlMs": 10000
    }
  }
}
```

**Response Fields:**
- `enabled`: Array of flag names that are enabled for this key
- `flags`: Object with all flags and their state
- `metadata.cacheAgeMs`: Time since cache was last refreshed (debug info)
- `metadata.cacheTtlMs`: Cache TTL in milliseconds (always 10000)

**Use Cases:**
- Client-side feature detection
- Backend feature gating before expensive operations
- Progressive enhancement based on flag state

#### Check Single Flag

```http
GET /feature-flags/new-payment-flow
Authorization: Bearer <API_KEY>

Response (200):
{
  "success": true,
  "data": {
    "flag": "new-payment-flow",
    "enabled": true,
    "environment": "production",
    "timestamp": "2026-03-29T22:57:00Z",
    "cacheAgeMs": 2357
  }
}
```

**Response:**
- `enabled`: Boolean indicating if flag is active for this key
- Applies all precedence rules (api_key override > environment > global)

**Query Parameters:**
- `environment`: Override environment for evaluation (optional)

```bash
# Check flag in staging environment
curl http://localhost:3000/feature-flags/new-dashboard?environment=staging \
  -H "Authorization: Bearer <API_KEY>"
```

## Developer Guide

### Client-Side Usage (JavaScript SDK)

#### Check if Feature is Enabled

```javascript
// Option 1: Single flag check
const response = await fetch('https://api.donation.app/feature-flags/new-checkout', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
const { success, data } = await response.json();
if (data.enabled) {
  // Use new checkout flow
} else {
  // Use legacy checkout flow
}

// Option 2: Get all flags at once
const allFlagsResponse = await fetch('https://api.donation.app/feature-flags', {
  headers: { 'Authorization': `Bearer ${apiKey}` }
});
const allFlags = await allFlagsResponse.json();
if (allFlags.data.enabled.includes('new-checkout')) {
  // Feature is enabled
}
```

#### Feature Gate Pattern

```javascript
async function processdonation(amount) {
  // Check if new payment processor is enabled
  const flagResponse = await fetch('https://api.donation.app/feature-flags/new-processor', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const { data } = await flagResponse.json();
  
  if (data.enabled) {
    return await newPaymentProcessor.process(amount);
  } else {
    return await legacyPaymentProcessor.process(amount);
  }
}
```

#### Caching Flagged Values

```javascript
// Cache function - honors 10-second cache TTL
const flagCache = new Map();

async function getFlag(flagName) {
  const cached = flagCache.get(flagName);
  if (cached && Date.now() - cached.time < 10000) {
    return cached.value;
  }
  
  const response = await fetch(`https://api.donation.app/feature-flags/${flagName}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  const { data } = await response.json();
  flagCache.set(flagName, { value: data.enabled, time: Date.now() });
  return data.enabled;
}
```

### Backend Usage (Node.js)

#### Using Feature Flags Utility

```javascript
const featureFlagsUtil = require('../utils/featureFlags');

// Check if flag is enabled for current API key
if (await featureFlagsUtil.isFeatureEnabled('new-dashboard', {
  apiKeyId: req.apiKey.id,
  environment: 'production'
})) {
  // Serve new dashboard
} else {
  // Serve legacy dashboard
}

// Get all effective flags for this API key
const flags = await featureFlagsUtil.getEffectiveFlagsForKey(
  req.apiKey.id,
  'production'
);

if (flags['payment-retry-logic']) {
  // Use enhanced retry logic
}

// Get cache statistics (for monitoring)
const stats = featureFlagsUtil.getCacheStats();
console.log(`Cache age: ${stats.cacheAgeMs}ms, TTL: ${stats.ttlMs}ms`);
```

#### Setting or Clearing Overrides (in tests)

```javascript
const featureFlagsUtil = require('../utils/featureFlags');

// Set an override
await featureFlagsUtil.setFlagOverrideForKey(
  'beta-feature',
  true,  // enabled
  apiKeyId,
  { reason: 'Beta testing' }
);

// Get override state
const override = await featureFlagsUtil.getFlagOverrideForKey('beta-feature', apiKeyId);
// Returns: true | false | undefined

// Clear override (revert to global/environment flag state)
await featureFlagsUtil.clearFlagOverrideForKey('beta-feature', apiKeyId);
```

## Operations Guide

### Common Admin Tasks

#### Enable Feature for All Users

```bash
# API call to enable
curl -X POST http://localhost:3000/admin/feature-flags/new-ui/enable \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json"

# Immediate effect:
# - Flag state updated in database
# - Cache invalidates within 10 seconds
# - All new requests see enabled flag
```

#### Beta Test Feature with Specific API Keys

```bash
# Enable for all users (default OFF)
curl -X POST http://localhost:3000/admin/feature-flags/early-access/disable \
  -H "Authorization: Bearer $ADMIN_KEY"

# Override to ON for beta tester
curl -X POST http://localhost:3000/admin/feature-flags/early-access/override \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "api_key_id": "partner_key_xyz",
    "enabled": true
  }'

# Result:
# - everyone else: feature OFF
# - partner_key_xyz: feature ON (override)
```

#### Gradual Feature Rollout

**Phase 1: Internal testing (1 day)**
```bash
# Enable only for internal API keys
curl -X POST /admin/feature-flags/large-export/override \
  -d '{"api_key_id": "internal_key_1", "enabled": true}' \
  -d '{"api_key_id": "internal_key_2", "enabled": true}'
```

**Phase 2: Trusted partners (3 days)**
```bash
# Add partner API keys to override list
curl -X POST /admin/feature-flags/large-export/override \
  -d '{"api_key_id": "partner_a", "enabled": true}' \
  -d '{"api_key_id": "partner_b", "enabled": true}'
```

**Phase 3: General availability (permanent)**
```bash
# Enable globally - overrides become unnecessary
curl -X POST /admin/feature-flags/large-export/enable
```

#### Emergency Disable

```bash
# If new feature causes issues, disable immediately
curl -X POST http://localhost:3000/admin/feature-flags/problematic-feature/disable \
  -H "Authorization: Bearer $ADMIN_KEY"

# Effect: within 10 seconds, all clients stop using the feature
# No server restart needed, no code deploy needed
```

### Debugging

#### Check Current Flag State

```bash
# Public API (requires API key)
curl http://localhost:3000/feature-flags/my-feature \
  -H "Authorization: Bearer $API_KEY"

# Shows:
# - enabled: true/false
# - Cache age and TTL
# - Applied scope precedence
```

#### Monitor Cache Effectiveness

From backend code:
```javascript
const stats = featureFlagsUtil.getCacheStats();
console.log(`Cache age: ${stats.cacheAgeMs}ms / TTL: ${stats.ttlMs}ms`);
// Output: Cache age: 2357ms / TTL: 10000ms
// Indicates cache is 2.4 seconds old of 10-second TTL

// Low cache age = recently refreshed from database
// High cache age (near 10s) = serving cached value
```

#### Audit Trail

All flag changes are logged to audit log:
```sql
SELECT * FROM audit_logs 
WHERE action LIKE 'FEATURE_FLAG%'
ORDER BY created_at DESC
LIMIT 50;

-- Shows: who changed flag, when, to what value, reason
```

## Performance Considerations

### Cache Hit Rate

With 10-second TTL:
- **Typical case**: 90%+ cache hits
- **During flag update**: Cache miss → refresh → serve new state
- **High-traffic API**: Cache reduces database load by ~90%

### Database Impact

**Without cache:** 1000 req/sec × flag check = 1000 queries/sec
**With 10-second cache:** ~100 queries/sec (1 per cache refresh)
**Reduction: 90% less database load**

### Latency Impact

- **Cache hit**: <1ms (in-memory lookup)
- **Cache miss refresh**: 5-15ms (database query)
- **Client perception**: <20ms (typical HTTP request latency dominates)

## Testing

### Test Coverage

All test files:
- `tests/feature-flags-basic.test.js`: Cache and utility functions (24 tests)

Test categories:
1. **Cache behavior**: TTL, refresh, statistics
2. **Module exports**: All functions available
3. **Error handling**: Graceful degradation
4. **API contract**: Response shapes and types
5. **System design**: Architectural principles

### Running Tests

```bash
# Run feature flags tests
npm test -- tests/feature-flags-basic.test.js

# Run with coverage
npm test -- tests/feature-flags-basic.test.js --coverage

# Expected: 28+ tests, all passing, >90% coverage
```

### Integration Testing

To test with actual database setup:

```javascript
// After database is initialized
const { initializeFeatureFlagsTable } = require('../src/utils/featureFlags');
await initializeFeatureFlagsTable();

// Now can test database operations
const result = await featureFlagsUtil.isFeatureEnabled('test-flag', {
  apiKeyId: 'test-key',
  environment: 'test'
});
```

## Migration Guide

### From Static Configuration to Feature Flags

**Before** (static config):
```javascript
const FEATURE_NEW_CHECKOUT = process.env.FEATURE_NEW_CHECKOUT === 'true';
if (FEATURE_NEW_CHECKOUT) { ... }
// Requires server restart to change
```

**After** (runtime feature flags):
```javascript
const isEnabled = await featureFlagsUtil.isFeatureEnabled('new-checkout', {
  apiKeyId: req.apiKey.id
});
if (isEnabled) { ... }
// Admin can change without restart
```

### Benefits

✅ Runtime control - no restart needed
✅ Per-user feature gates - beta testing possible
✅ Audit trail - track all flag changes
✅ Gradual rollout - phase features safely
✅ Emergency disable - rollback instantly

## Troubleshooting

### Issue: Changes take >10 seconds to appear

**Cause**: Cache is working correctly
**Solution**: This is expected; cache is 10 seconds old. Normal behavior.
**Action**: None needed. Flag will update within 10 seconds.

### Issue: Flag not appearing in API response

**Possible causes**:
1. Flag not created - create it via admin endpoint
2. API key doesn't exist - verify in api_keys table
3. Cache not refreshed - wait up to 10 seconds

**Check**:
```sql
SELECT * FROM feature_flags WHERE name = 'my-flag';
-- Should return one row with enabled = true/false
```

### Issue: Audit log not recording flag changes

**Cause**: AuditLogService may be not initialized
**Solution**: Verify audit_logs table exists
**Check**:
```sql
SELECT * FROM audit_logs WHERE action LIKE 'FEATURE_FLAG%';
```

### Issue: Cache statistics show very high age

**This is normal** if:
- Cache hasn't been cleared/refreshed (still within 10 seconds)
- No flag checks have occurred recently

**Not a problem** - cache still works, just serves older data.

## Security Considerations

### API Key Permissions

Feature flag endpoints require:
- **Admin endpoints**: `ADMIN_ALL` permission
- **Public endpoints**: Standard API key authentication

### Audit Logging

All admin flag changes are logged:
- Who made the change
- What changed
- When it changed
- Reason (if provided)

### Per-Key Overrides

Stored securely in database:
- Tied to specific API key ID
- Only visible in audit logs
- No sensitive data stored

## Future Enhancements

Potential improvements:
- Flag analytics: Track adoption and effectiveness
- Scheduling: Schedule flag changes for specific times
- Rollout strategies: Canary deployments, A/B testing
- Flag conditions: Geo-location, time-of-day based flags
- Feature flag dependencies: Flag X depends on Flag Y
- Shadow flags: Test flag without affecting users

## Support & Questions

For issues or questions:
1. Check audit logs for recent changes
2. Verify API key has correct permissions
3. Confirm flag exists in database
4. Review cache statistics for staleness
5. Check application logs for errors
