# Design Document

## Overview

This design standardizes rate limit header emission across all rate-limiting layers in the system. Currently, the codebase has multiple rate limiter implementations:
- **express-rate-limit based limiters** in `src/middleware/rateLimiter.js` (donation, verification, batch, bulk import, auth token, auth refresh, health check, live history, friendbot, stats)
- **Per-key rate limiter** in `src/middleware/perKeyRateLimit.js`
- **Header builder** in `src/middleware/rateLimitHeaders.js`

The problem is that these limiters have inconsistent header emission patterns:
- `rateLimiter.js` uses express-rate-limit's built-in `standardHeaders: true, legacyHeaders: true` configuration
- `perKeyRateLimit.js` has its own `buildRateLimitHeaders` function that duplicates the logic
- `rateLimitHeaders.js` contains a `buildRateLimitHeaders` function but is not consistently used

This design consolidates header emission logic into a single source of truth and ensures all limiters emit IETF-standard headers consistently on both successful and throttled responses.

## Architecture

### Current State

```
┌─────────────────────────────────────────────────────────────┐
│  Express-rate-limit Limiters (rateLimiter.js)               │
│  - Configure standardHeaders: true, legacyHeaders: true      │
│  - express-rate-limit handles header emission internally     │
│  - Custom handlers set Retry-After manually                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Per-Key Limiter (perKeyRateLimit.js)                       │
│  - Has own buildRateLimitHeaders function                    │
│  - Manually calls res.set() with headers                     │
│  - Sets Retry-After in 429 handler                           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Header Builder (rateLimitHeaders.js)                        │
│  - Standalone buildRateLimitHeaders function                 │
│  - NOT currently used by limiters                            │
└─────────────────────────────────────────────────────────────┘
```

### Target State

```
┌─────────────────────────────────────────────────────────────┐
│  Centralized Header Builder (rateLimitHeaders.js)            │
│  - Single buildRateLimitHeaders(limit, remaining, resetTime) │
│  - Returns both IETF and legacy headers                      │
│  - Used by ALL rate limiters                                 │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
┌───────────┴───────────┐         ┌────────────┴────────────┐
│  Express-rate-limit   │         │  Per-Key Limiter        │
│  Limiters             │         │  (perKeyRateLimit.js)   │
│  (rateLimiter.js)     │         │                         │
│  - Use standardHeaders│         │  - Remove duplicate     │
│  - Use legacyHeaders  │         │    buildRateLimitHeaders│
│  - Retry-After on 429 │         │  - Import from          │
└───────────────────────┘         │    rateLimitHeaders.js  │
                                  │  - Set Retry-After      │
                                  └─────────────────────────┘
```

## Components and Interfaces

### 1. Centralized Header Builder (`src/middleware/rateLimitHeaders.js`)

**Purpose**: Single source of truth for rate limit header generation

**Interface**:
```javascript
/**
 * Builds both IETF-standard and legacy rate limit headers
 * @param {number} limit - Maximum requests allowed in window
 * @param {number} remaining - Remaining requests in current window
 * @param {number|Date} resetTime - Unix timestamp (seconds or ms) or Date when limit resets
 * @returns {Object} Headers object with RateLimit-* and X-RateLimit-* keys
 */
function buildRateLimitHeaders(limit, remaining, resetTime)
```

**Output Format**:
```javascript
{
  'RateLimit-Limit': '100',           // IETF standard
  'RateLimit-Remaining': '42',         // IETF standard
  'RateLimit-Reset': '1705315800',     // IETF standard (Unix seconds)
  'X-RateLimit-Limit': '100',          // Legacy (backward compatibility)
  'X-RateLimit-Remaining': '42',       // Legacy
  'X-RateLimit-Reset': '1705315800'    // Legacy (Unix seconds)
}
```

**Implementation Notes**:
- Already exists in `src/middleware/rateLimitHeaders.js`
- Currently returns 6 headers (IETF + legacy)
- Normalizes `resetTime` to Unix seconds (handles both milliseconds and seconds)
- Clamps `remaining` to 0 (handles negative values gracefully)
- All values are strings (HTTP header requirement)

### 2. Express-rate-limit Limiters (`src/middleware/rateLimiter.js`)

**Current Configuration**:
```javascript
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,   // Enables RateLimit-* headers
  legacyHeaders: true,     // Enables X-RateLimit-* headers
  handler: (req, res) => {
    res.status(429).json({...});
  }
});
```

**express-rate-limit Behavior**:
- When `standardHeaders: true`, express-rate-limit automatically sets `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers on ALL responses (2xx and 429)
- When `legacyHeaders: true`, express-rate-limit automatically sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers on ALL responses
- The library handles header emission internally - no manual res.set() needed
- `req.rateLimit` object contains: `{ limit, current, remaining, resetTime }`

**Required Changes**:
1. Verify all limiters have `standardHeaders: true` and `legacyHeaders: true`
2. Ensure all 429 handlers set `Retry-After` header
3. Standardize `Retry-After` calculation across all handlers

**Retry-After Calculation Pattern**:
```javascript
handler: (req, res) => {
  const retryAfter = req.rateLimit?.resetTime
    ? Math.ceil((new Date(req.rateLimit.resetTime) - Date.now()) / 1000)
    : 60;
  
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: '...',
      retryAfter
    }
  });
}
```

### 3. Per-Key Rate Limiter (`src/middleware/perKeyRateLimit.js`)

**Current Implementation**:
- Has its own `buildRateLimitHeaders` function (duplicate logic)
- Manually calls `res.set(buildRateLimitHeaders(...))`
- Sets headers on success path and 429 path

**Required Changes**:
1. Remove duplicate `buildRateLimitHeaders` function
2. Import `buildRateLimitHeaders` from `src/middleware/rateLimitHeaders.js`
3. Update imports to use centralized function
4. Verify `Retry-After` header is set on 429 responses

**Updated Implementation Pattern**:
```javascript
const { buildRateLimitHeaders } = require('./rateLimitHeaders');

const perKeyRateLimit = async (req, res, next) => {
  // ... rate limit check logic ...
  
  // Set headers on every response
  res.set(buildRateLimitHeaders(limit, result.remaining, result.resetAt));

  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({...});
  }

  return next();
};
```

### 4. Multiple Limiter Layer Coordination

**Challenge**: Some endpoints may have multiple limiters applied (e.g., per-key limiter + endpoint-specific limiter)

**Current Middleware Stack Example**:
```javascript
app.post('/donations',
  requireApiKey,           // Adds req.apiKey
  perKeyRateLimit,         // Sets headers based on per-key limit
  donationRateLimiter,     // Sets headers based on endpoint limit
  createDonation
);
```

**Header Overwrite Behavior**:
- Later middleware overwrites headers set by earlier middleware
- If both limiters set headers, the last one wins
- This is the desired behavior: the most restrictive limiter should determine the headers

**Correct Ordering**:
- Per-key limiter runs first (more generous limit typically)
- Endpoint-specific limiter runs second (more restrictive)
- If endpoint limiter is more restrictive, its headers overwrite per-key headers
- If request is throttled, the throttling limiter's headers are final

**No Changes Required**: Current ordering already produces correct behavior where the active (most restrictive) limiter's headers are present on the response.

## Data Models

No database schema changes required. This feature only affects HTTP response headers.

**Rate Limit State** (in-memory, managed by express-rate-limit and RateLimitStore):
```javascript
{
  key: string,              // API key ID or IP address
  count: number,            // Current request count in window
  resetAt: Date             // When the window resets
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: All Rate-Limited Responses Include Standard Headers

*For any* HTTP response from a rate-limited endpoint, the response headers SHALL include RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset with string values.

**Validates: Requirements 1.1, 1.2, 1.4**

### Property 2: 429 Responses Include Retry-After

*For any* 429 response from a rate-limited endpoint, the response headers SHALL include a Retry-After header with a string value representing a positive integer number of seconds.

**Validates: Requirements 1.3, 4.1, 4.3**

### Property 3: IETF and Legacy Headers Match

*For any* rate-limited response, the values in RateLimit-Limit SHALL equal X-RateLimit-Limit, RateLimit-Remaining SHALL equal X-RateLimit-Remaining, and RateLimit-Reset SHALL equal X-RateLimit-Reset.

**Validates: Requirements 1.4**

### Property 4: Header Values Reflect Limiter State

*For any* successful rate-limited response, RateLimit-Remaining SHALL equal the limit minus the current request count, and SHALL be a non-negative integer.

**Validates: Requirements 2.3, 3.1**

### Property 5: Retry-After Aligns with Reset Time

*For any* 429 response, the Retry-After value SHALL be within 2 seconds of the difference between RateLimit-Reset and the current time (allowing for clock skew and processing delay).

**Validates: Requirements 4.2**

### Property 6: Header Builder Returns Consistent Format

*For any* valid inputs (limit, remaining, resetTime), buildRateLimitHeaders SHALL return an object with exactly 6 string-valued keys: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset.

**Validates: Requirements 3.1, 3.2**

### Property 7: Negative Remaining Clamped to Zero

*For any* call to buildRateLimitHeaders with a negative remaining value, the returned headers SHALL contain '0' for both RateLimit-Remaining and X-RateLimit-Remaining.

**Validates: Requirements 2.3**

## Error Handling

### No New Error Conditions

This feature does not introduce new error conditions. It standardizes existing rate limit responses.

### Existing Error Handling Preserved

**429 Rate Limit Exceeded**:
- Response format remains unchanged
- Error code: `RATE_LIMIT_EXCEEDED`
- Error message preserved per limiter
- `retryAfter` field in response body matches `Retry-After` header

**Error Response Format** (unchanged):
```javascript
{
  success: false,
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please try again later.',
    retryAfter: 42  // seconds, matches Retry-After header
  }
}
```

### Header Emission Resilience

**Invalid Input Handling**:
- `buildRateLimitHeaders` clamps negative `remaining` to 0
- Converts `resetTime` to Unix seconds (handles milliseconds or seconds)
- Converts all values to strings (HTTP header requirement)

**Fallback Behavior**:
- If `req.rateLimit.resetTime` is undefined, use default window (60 seconds)
- If header builder fails, limiters should still return 429 (fail gracefully)

## Testing Strategy

### Unit Tests

**Target**: `src/middleware/rateLimitHeaders.js`

Test the header builder function directly:
1. Valid inputs produce correct header format
2. Negative remaining values clamped to 0
3. resetTime normalization (milliseconds vs seconds)
4. All values converted to strings
5. IETF headers match legacy headers

**Existing Coverage**: `tests/middleware/rate-limit-headers.test.js` already covers basic cases. Extend to cover edge cases.

### Property-Based Tests

**Test Library**: `fast-check` (JavaScript property-based testing library)

**Configuration**: Minimum 100 iterations per property test

**Property Test 1: Header Builder Format Consistency**
- Generate random limit (1-10000), remaining (-10 to limit), resetTime (current + 1 to 3600 seconds)
- Call buildRateLimitHeaders
- Assert: 6 keys present, all string values, IETF matches legacy, remaining >= 0
- **Feature: emit-standard-rate-limit-headers, Property 6: Header builder returns consistent format**

**Property Test 2: Negative Remaining Clamping**
- Generate random negative remaining values (-1000 to -1)
- Call buildRateLimitHeaders with valid limit and resetTime
- Assert: RateLimit-Remaining = '0', X-RateLimit-Remaining = '0'
- **Feature: emit-standard-rate-limit-headers, Property 7: Negative remaining clamped to zero**

### Integration Tests

**Target**: All rate limiters in `src/middleware/rateLimiter.js` and `src/middleware/perKeyRateLimit.js`

**Test Coverage for Each Limiter**:

1. **Successful Request Headers** (validates Requirements 1.1, Property 1)
   - Make request within rate limit
   - Assert: Response status 2xx
   - Assert: RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset present
   - Assert: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset present
   - Assert: IETF headers match legacy headers

2. **429 Response Headers** (validates Requirements 1.2, 1.3, Properties 1, 2)
   - Exhaust rate limit
   - Make one more request
   - Assert: Response status 429
   - Assert: All 6 rate limit headers present
   - Assert: Retry-After header present
   - Assert: Retry-After is positive integer string

3. **Header Value Accuracy** (validates Requirements 2.3, 4.2, Properties 4, 5)
   - Make request, capture headers
   - Assert: RateLimit-Remaining decrements correctly
   - Assert: Retry-After ≈ (RateLimit-Reset - currentTime) within 2 seconds
   - Assert: RateLimit-Limit matches limiter configuration

**Test Matrix** (each limiter tested with 3 test cases above):
- donationRateLimiter
- verificationRateLimiter
- batchRateLimiter
- bulkImportRateLimiter
- authTokenRateLimiter
- authRefreshRateLimiter
- healthCheckRateLimiter
- liveHistoryRateLimiter
- friendbotRateLimiter
- statsRateLimiter
- perKeyRateLimit

**Existing Test Files to Update**:
- `tests/middleware/rate-limiter.test.js` - extend existing tests
- `tests/middleware/per-key-rate-limit.test.js` - extend existing tests
- `tests/middleware/rate-limit-headers.test.js` - extend unit tests

### Test Isolation

**Rate Limiter State Reset**:
- Use `tests/setup.js` existing cleanup logic
- Call `clearStore()` from perKeyRateLimit between tests
- Express-rate-limit limiters use in-memory stores that reset between test files

**Time-Dependent Tests**:
- Use Jest fake timers for window expiration tests
- Restore real timers in afterEach hooks
