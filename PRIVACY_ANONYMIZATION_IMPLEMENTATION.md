# Privacy Anonymization Implementation for Stats Endpoints

## Overview

This document describes the implementation of privacy protection for anonymous donors in the stats endpoints. The solution ensures that donors who explicitly opt for anonymous donations have their Stellar public keys anonymized in all stats responses for non-admin callers, while admin callers continue to see full public keys for operational purposes.

## Problem Statement

Previously, the GET `/stats/donors`, `/stats/recipients`, `/stats/daily`, `/stats/weekly`, `/stats/dashboard`, and `/stats/wallet/:walletAddress/analytics` endpoints returned raw Stellar public keys for all donors, including those who explicitly opted for anonymous donations. This violated privacy expectations and potentially constituted a GDPR violation, as Stellar public keys are persistent identifiers that can be used to look up complete transaction history on public Stellar explorers.

## Solution Architecture

### Core Components

#### 1. **Anonymization Helper Function** (`StatsService.getDisplayKey()`)

```javascript
static getDisplayKey(publicKey, isAnonymous, isAdmin)
```

**Responsibility**: Determine whether a public key should be displayed as-is or anonymized.

**Logic**:
- **Admin callers**: Always return full public key
- **Non-admin callers with anonymous donation**: Return pseudonymous ID (via `generatePseudonymousId()`)
- **Non-admin callers with non-anonymous donation**: Return full public key
- **Already pseudonymous**: Return as-is (idempotent)

**Properties**:
- Deterministic: Same wallet always produces same pseudonymous ID
- One-way: Wallet address cannot be recovered from pseudonymous ID
- Timing-safe: Uses `crypto.timingSafeEqual()` to prevent side-channel attacks

#### 2. **Updated StatsService Methods**

All aggregation methods now accept an optional `isAdmin` parameter:

- `getDailyStats(startDate, endDate, timezone, isAdmin)`
- `getWeeklyStats(startDate, endDate, isAdmin)`
- `getDonorStats(startDate, endDate, isAdmin)`
- `getRecipientStats(startDate, endDate, isAdmin)`
- `getWalletAnalytics(walletAddress, startDate, endDate, isAdmin)`
- `getDashboardData({ period, granularity, topN, movingAvgWindow, isAdmin })`

**Anonymization Strategy**:
- Donor fields in responses are anonymized based on `tx.anonymous` flag
- Recipient fields are never anonymized (recipients are not privacy-sensitive)
- Dashboard cache keys include admin status to prevent cache poisoning

#### 3. **Stats Route Updates**

All stats endpoints now:
1. Extract admin status from `req.user.role === 'admin'`
2. Pass `isAdmin` flag to StatsService methods
3. Return appropriately anonymized data

**Updated Endpoints**:
- `GET /stats/daily`
- `GET /stats/weekly`
- `GET /stats/donors`
- `GET /stats/recipients`
- `GET /stats/wallet/:walletAddress/analytics`
- `GET /stats/dashboard`

### Data Flow

```
Request → Route Handler
  ↓
Extract isAdmin = (req.user.role === 'admin')
  ↓
Call StatsService.getXxxStats(..., isAdmin)
  ↓
For each transaction:
  - donor = getDisplayKey(tx.donor, tx.anonymous, isAdmin)
  - recipient = getDisplayKey(tx.recipient, false, isAdmin)
  ↓
Return anonymized response
```

## Acceptance Criteria Implementation

### ✅ Criterion 1: Anonymous Donors Represented by Pseudonymous ID

**Implementation**: `StatsService.getDisplayKey()` returns pseudonymous ID for non-admin callers when `isAnonymous === true`.

**Verification**:
```javascript
// Non-admin caller
const key = StatsService.getDisplayKey(DONOR_WALLET, true, false);
expect(isPseudonymousId(key)).toBe(true);

// Admin caller
const key = StatsService.getDisplayKey(DONOR_WALLET, true, true);
expect(key).toBe(DONOR_WALLET);
```

### ✅ Criterion 2: Deterministic Pseudonymous IDs

**Implementation**: Uses HMAC-SHA256 with server-side secret (`ANONYMOUS_DONATION_SECRET`).

**Properties**:
- Same donor always maps to same pseudonymous ID
- Deterministic across multiple calls
- Consistent within API key context (same secret)

**Verification**:
```javascript
const id1 = generatePseudonymousId(DONOR_WALLET);
const id2 = generatePseudonymousId(DONOR_WALLET);
expect(id1).toBe(id2); // Deterministic
```

### ✅ Criterion 3: Full Keys Only for Admin

**Implementation**: All StatsService methods check `isAdmin` parameter before anonymizing.

**Verification**:
```javascript
// Non-admin sees pseudonymous ID
const stats = StatsService.getDonorStats(start, end, false);
// Pseudonymous IDs in response

// Admin sees full keys
const stats = StatsService.getDonorStats(start, end, true);
// Full public keys in response
```

### ✅ Criterion 4: Consistent Anonymization Across Endpoints

**Implementation**: All stats endpoints use the same `getDisplayKey()` helper.

**Affected Endpoints**:
- `GET /stats/donors` - Donor keys anonymized
- `GET /stats/recipients` - Donor keys in donations array anonymized
- `GET /stats/daily` - Donor keys in transactions anonymized
- `GET /stats/weekly` - Donor keys in transactions anonymized
- `GET /stats/dashboard` - Donor keys in top donors anonymized
- `GET /stats/wallet/:walletAddress/analytics` - Donor keys in received transactions anonymized

## Testing

### Test Coverage

**File**: `tests/stats/stats-anonymization-privacy.test.js`

**Test Suites**:

1. **getDisplayKey Helper Tests**
   - Admin always sees full keys
   - Non-admin sees pseudonymous IDs for anonymous donations
   - Non-admin sees full keys for non-anonymous donations
   - Already-pseudonymous IDs are returned as-is

2. **getDonorStats Anonymization Tests**
   - Non-admin doesn't see anonymous donors in leaderboard
   - Admin sees full donor keys
   - Recipient keys are not anonymized

3. **getRecipientStats Anonymization Tests**
   - Non-admin sees pseudonymous IDs for anonymous donors
   - Admin sees full donor keys
   - Non-anonymous donors show full keys to all callers

4. **getDailyStats Anonymization Tests**
   - Non-admin sees pseudonymous IDs
   - Admin sees full keys

5. **getWeeklyStats Anonymization Tests**
   - Non-admin sees pseudonymous IDs
   - Admin sees full keys

6. **getWalletAnalytics Anonymization Tests**
   - Non-admin sees pseudonymous IDs for anonymous donations
   - Admin sees full keys
   - Non-anonymous donors show full keys

7. **getDashboardData Anonymization Tests**
   - Non-admin doesn't see anonymous donors in top donors
   - Admin sees full keys
   - Cache keys include admin status (prevents cache poisoning)

8. **Deterministic Pseudonymous IDs Tests**
   - Same donor always maps to same ID
   - Different donors map to different IDs
   - Deterministic across multiple calls

9. **Edge Cases Tests**
   - Null/undefined donor handling
   - Empty string donor handling
   - Already-pseudonymous ID handling

### Running Tests

```bash
npm test -- tests/stats/stats-anonymization-privacy.test.js --run
```

## Security Considerations

### 1. **Pseudonymous ID Format**

Format: `anon_<64-hex-chars>` (69 characters total)

- Visually distinguishable from real Stellar public keys (which start with 'G')
- Deterministic but one-way (wallet address not recoverable without secret)
- Timing-safe comparison prevents side-channel attacks

### 2. **Secret Management**

- Uses `ANONYMOUS_DONATION_SECRET` environment variable
- Falls back to test secret in Jest environment for reproducible tests
- Requires strong, random secret (at least 32 bytes) in production

### 3. **Cache Poisoning Prevention**

Dashboard cache keys include admin status:
```javascript
const cacheKey = `dashboard:${period}:${granularityOverride}:${topN}:${movingAvgWindow}:${isAdmin ? 'admin' : 'user'}`;
```

This ensures admin and non-admin responses are cached separately.

### 4. **Admin Role Detection**

```javascript
const isAdmin = req.user && req.user.role === 'admin';
```

- Relies on existing RBAC middleware
- Consistent with other admin-only endpoints
- Fails safely (defaults to non-admin if role not present)

## Backward Compatibility

### API Response Changes

**Before**:
```json
{
  "success": true,
  "data": [
    {
      "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJVNHX3XCRSZ3ZBOJXLUBXVQ",
      "totalDonated": 100
    }
  ]
}
```

**After (Non-Admin)**:
```json
{
  "success": true,
  "data": [
    {
      "donor": "anon_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2",
      "totalDonated": 100
    }
  ]
}
```

**After (Admin)**:
```json
{
  "success": true,
  "data": [
    {
      "donor": "GBRPYHIL2CI3WHZDTOOQFC6EB4KJJGUJJVNHX3XCRSZ3ZBOJXLUBXVQ",
      "totalDonated": 100
    }
  ]
}
```

### Client Impact

- **Non-admin clients**: Will see pseudonymous IDs instead of public keys for anonymous donors
- **Admin clients**: No change (continue to see full keys)
- **Leaderboards**: Anonymous donations still excluded from donor leaderboards (existing behavior)

## Deployment Checklist

- [ ] Set `ANONYMOUS_DONATION_SECRET` environment variable (strong, random, 32+ bytes)
- [ ] Deploy updated `StatsService.js`
- [ ] Deploy updated `stats.js` routes
- [ ] Deploy test suite
- [ ] Verify cache invalidation works correctly
- [ ] Monitor stats endpoint performance (anonymization adds minimal overhead)
- [ ] Update API documentation to reflect anonymization behavior
- [ ] Notify clients of response format changes for anonymous donors

## Monitoring & Observability

### Metrics to Track

1. **Cache Hit Rate**: Monitor dashboard cache effectiveness with admin status separation
2. **Anonymization Overhead**: Track response time impact (should be minimal)
3. **Admin vs Non-Admin Requests**: Audit log access patterns

### Logging

All stats access is logged via `AuditLogService`:
```javascript
AuditLogService.log({
  category: AuditLogService.CATEGORY.DATA_ACCESS,
  action: 'STATS_ACCESSED',
  severity: AuditLogService.SEVERITY.LOW,
  result: 'SUCCESS',
  userId: req.user && req.user.id,
  requestId: req.id,
  ipAddress: req.ip,
  resource: req.path,
  details: { query: req.query, params: req.params }
});
```

## Future Enhancements

1. **Configurable Anonymization**: Allow per-endpoint anonymization policies
2. **Audit Trail**: Track which admin users accessed full keys
3. **Pseudonym Verification**: Implement donor verification endpoint (already exists: `verifyAnonymousDonation()`)
4. **Anonymization Metrics**: Track anonymization effectiveness and coverage

## References

- **Anonymization Module**: `src/utils/anonymization.js`
- **StatsService**: `src/services/StatsService.js`
- **Stats Routes**: `src/routes/stats.js`
- **Tests**: `tests/stats/stats-anonymization-privacy.test.js`
- **GDPR Compliance**: Pseudonymous identifiers are GDPR-compliant when properly implemented
- **Stellar Public Keys**: Format and validation in `src/utils/validators.js`

## Conclusion

This implementation provides robust privacy protection for anonymous donors while maintaining operational visibility for administrators. The solution is:

- **Secure**: Uses HMAC-SHA256 with timing-safe comparison
- **Deterministic**: Same donor always maps to same pseudonymous ID
- **Consistent**: Applied uniformly across all stats endpoints
- **Backward Compatible**: Existing admin workflows unchanged
- **Well-Tested**: Comprehensive test coverage for all scenarios
- **Observable**: Audit logging for compliance and monitoring
