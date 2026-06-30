# Implementation Plan: Emit Standard RateLimit-* Headers

## Overview

This implementation standardizes rate limit header emission across all rate-limiting layers by consolidating header generation logic and ensuring consistent IETF-standard headers appear on all rate-limited responses. The implementation focuses on refactoring existing limiters to use centralized header logic and adding comprehensive test coverage.

## Tasks

- [ ] 1. Audit and document current header emission behavior
  - Review all rate limiters in `src/middleware/rateLimiter.js`
  - Review per-key rate limiter in `src/middleware/perKeyRateLimit.js`
  - Document which limiters currently emit headers and which patterns they use
  - Document current `Retry-After` header handling across limiters
  - _Requirements: 1.1, 1.2, 1.3_

- [ ] 2. Consolidate header builder logic
  - [ ] 2.1 Verify `buildRateLimitHeaders` in `src/middleware/rateLimitHeaders.js` meets requirements
    - Ensure it returns both IETF headers (RateLimit-*) and legacy headers (X-RateLimit-*)
    - Ensure it clamps negative remaining values to 0
    - Ensure it normalizes resetTime to Unix seconds
    - Ensure all values are strings
    - _Requirements: 1.1, 1.2, 1.4, 3.1_
  
  - [ ]* 2.2 Write property test for buildRateLimitHeaders format consistency
    - **Property 6: Header builder returns consistent format**
    - **Validates: Requirements 3.1**
  
  - [ ]* 2.3 Write property test for negative remaining clamping
    - **Property 7: Negative remaining clamped to zero**
    - **Validates: Requirements 2.3**
  
  - [ ] 2.4 Update `perKeyRateLimit.js` to use centralized header builder
    - Remove duplicate `buildRateLimitHeaders` function from `perKeyRateLimit.js`
    - Import `buildRateLimitHeaders` from `src/middleware/rateLimitHeaders.js`
    - Update all calls to use imported function
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 3. Standardize Retry-After header emission
  - [ ] 3.1 Create helper function for Retry-After calculation
    - Add `calculateRetryAfter(resetTime)` function to `rateLimitHeaders.js`
    - Use `Math.ceil((new Date(resetTime) - Date.now()) / 1000)` formula
    - Return string representation of positive integer
    - Handle edge cases (undefined resetTime, negative values)
    - _Requirements: 4.1, 4.3_
  
  - [ ] 3.2 Update all express-rate-limit handlers to use Retry-After helper
    - Update donationRateLimiter handler
    - Update verificationRateLimiter handler
    - Update batchRateLimiter handler
    - Update bulkImportRateLimiter handler
    - Update authTokenRateLimiter handler
    - Update authRefreshRateLimiter handler
    - Update healthCheckRateLimiter handler
    - Update liveHistoryRateLimiter handler
    - Update friendbotRateLimiter handler
    - Update statsRateLimiter handler
    - _Requirements: 1.3, 4.1, 4.2, 4.3_
  
  - [ ] 3.3 Update perKeyRateLimit to use Retry-After helper
    - Import and use `calculateRetryAfter` in 429 handler
    - _Requirements: 1.3, 4.1, 4.2, 4.3_

- [ ] 4. Verify express-rate-limit configuration
  - [ ] 4.1 Audit all limiters for standardHeaders and legacyHeaders config
    - Ensure `standardHeaders: true` on all limiters (enables RateLimit-*)
    - Ensure `legacyHeaders: true` on all limiters (enables X-RateLimit-*)
    - _Requirements: 1.1, 1.2, 1.4_
  
  - [ ] 4.2 Verify express-rate-limit emits headers on successful responses
    - Confirm library behavior: headers set on ALL responses, not just 429
    - Document any limiters that need configuration updates
    - _Requirements: 1.1, 5.1, 5.2, 5.3, 5.4_

- [ ] 5. Checkpoint - Ensure all tests pass
  - Run existing test suite
  - Verify no rate limiting behavior changes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Add integration tests for header emission
  - [ ] 6.1 Extend `tests/middleware/rate-limiter.test.js`
    - Add test: "should include IETF RateLimit-* headers on successful response"
    - Add test: "should include IETF RateLimit-* headers on 429 response"
    - Add test: "should include Retry-After header on 429 response"
    - Add test: "IETF headers should match legacy X-RateLimit-* headers"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ]* 6.2 Write property test for successful response headers
    - **Property 1: All rate-limited responses include standard headers**
    - **Validates: Requirements 1.1, 1.4**
  
  - [ ]* 6.3 Write property test for 429 response headers
    - **Property 2: 429 responses include Retry-After**
    - **Validates: Requirements 1.3, 4.1, 4.3**
  
  - [ ]* 6.4 Write property test for IETF and legacy header matching
    - **Property 3: IETF and legacy headers match**
    - **Validates: Requirements 1.4**

- [ ] 7. Add per-key rate limiter header tests
  - [ ] 7.1 Extend `tests/middleware/per-key-rate-limit.test.js`
    - Add test: "should emit IETF RateLimit-* headers alongside legacy headers"
    - Add test: "should emit Retry-After on 429 response"
    - Add test: "IETF and legacy header values should match"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ]* 7.2 Write property test for header value accuracy
    - **Property 4: Header values reflect limiter state**
    - **Validates: Requirements 2.3**
  
  - [ ]* 7.3 Write property test for Retry-After alignment
    - **Property 5: Retry-After aligns with reset time**
    - **Validates: Requirements 4.2**

- [ ] 8. Test coverage for all rate limiter types
  - [ ] 8.1 Create test helper for header verification
    - Write `assertRateLimitHeaders(response, expectedLimit)` helper
    - Checks presence of all 6 headers (IETF + legacy)
    - Checks IETF values match legacy values
    - Checks Retry-After on 429 responses
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.2 Add header tests for donation rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.3 Add header tests for verification rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.4 Add header tests for batch rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.5 Add header tests for bulk import rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.6 Add header tests for auth token rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 8.7 Add header tests for stats rate limiter
    - Test successful response headers
    - Test 429 response headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 9. Add regression tests for preserved behavior
  - [ ] 9.1 Test rate limit thresholds unchanged
    - Verify donation limiter still enforces 10 requests per 60s
    - Verify verification limiter still enforces 30 requests per 60s
    - Verify batch limiter still enforces 1 request per 60s
    - _Requirements: 5.1_
  
  - [ ] 9.2 Test window durations unchanged
    - Verify all limiters use correct windowMs values
    - _Requirements: 5.2_
  
  - [ ] 9.3 Test key generation logic unchanged
    - Verify IP-based keying still works
    - Verify API-key-based keying still works
    - _Requirements: 5.3_
  
  - [ ] 9.4 Test skip logic unchanged
    - Verify test environment bypass still works
    - Verify idempotency bypass still works
    - _Requirements: 5.4_

- [ ] 10. Documentation updates
  - [ ] 10.1 Update rate limiter middleware documentation
    - Document standard header emission behavior
    - Document Retry-After header on 429 responses
    - Add examples of header values
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  
  - [ ] 10.2 Update API documentation
    - Document IETF-standard RateLimit-* headers in API responses
    - Document Retry-After header on rate limit errors
    - Add examples to API documentation
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Run full test suite
  - Verify all new tests pass
  - Verify no existing tests broken
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based tests that can be skipped for faster MVP
- The implementation preserves all existing rate limiting behavior (thresholds, windows, key generation)
- express-rate-limit already emits headers automatically when standardHeaders and legacyHeaders are enabled
- Main work is consolidating per-key limiter to use centralized header builder and standardizing Retry-After
- Property tests use fast-check library with minimum 100 iterations
- Each property test references its design document property number
