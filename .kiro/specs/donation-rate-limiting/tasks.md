# Implementation Plan: Per-API Key Rate Limiting

## Overview

This implementation plan breaks down the rate limiting feature into incremental steps, starting with core data structures, then middleware implementation, configuration management, and comprehensive testing. Each step builds on previous work and includes validation through tests.

## Tasks

- [ ] 1. Set up rate limiting infrastructure and configuration
  - [x] 1.1 Create configuration module for rate limiting
    - Create `src/config/rateLimit.js` with environment variable loading
    - Implement validation for limit, windowMs, and cleanupIntervalMs
    - Provide default values (100 requests, 60000ms window, 300000ms cleanup)
    - Export configuration object and validation function
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
  
  - [ ]* 1.2 Write unit tests for configuration module
    - Test default values when env vars not set
    - Test configuration loading from environment variables
    - Test validation catches invalid values
    - Test fallback to defaults on invalid config
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 2. Implement RequestCounter class
  - [x] 2.1 Create RequestCounter with core functionality
    - Create `src/middleware/RequestCounter.js`
    - Implement constructor accepting windowMs parameter
    - Implement internal Map for storing counter entries (apiKey -> {count, windowStart})
    - Implement `increment(apiKey)` method
    - Implement `getCount(apiKey)` method with window expiration logic
    - Implement `getTimeUntilReset(apiKey)` method
    - Implement `reset()` method for testing
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 7.2_
  
  - [ ]* 2.2 Write property test for request count increment
    - **Property 2: Request Count Increment**
    - **Validates: Requirements 2.1**
    - Generate random API keys and verify each request increments count by one
  
  - [ ]* 2.3 Write property test for timestamp storage
    - **Property 3: Timestamp Storage**
    - **Validates: Requirements 2.2**
    - Verify timestamp information is stored and retrievable for all API keys
  
  - [ ]* 2.4 Write property test for window expiration reset
    - **Property 4: Window Expiration Reset**
    - **Validates: Requirements 2.3**
    - Test that counts reset to zero after window expires for any API key
  
  - [ ]* 2.5 Write property test for API key isolation
    - **Property 5: API Key Isolation**
    - **Validates: Requirements 2.4, 3.3**
    - Generate pairs of distinct API keys and verify independence
  
  - [ ]* 2.6 Write property test for sequential request counting
    - **Property 6: Sequential Request Counting**
    - **Validates: Requirements 2.5**
    - Generate sequences of N requests and verify final count equals N

- [ ] 3. Implement cleanup mechanism
  - [x] 3.1 Add cleanup functionality to RequestCounter
    - Implement `cleanup()` method to remove expired entries
    - Add automatic cleanup scheduling in constructor
    - Store cleanup interval ID for proper shutdown
    - Implement `stopCleanup()` method for testing
    - _Requirements: 8.3, 7.1_
  
  - [ ]* 3.2 Write property test for cleanup
    - **Property 12: Cleanup Removes Expired Entries**
    - **Validates: Requirements 8.3**
    - Verify cleanup reduces stored entries for expired windows

- [ ] 4. Implement error response builders
  - [x] 4.1 Create error response utility functions
    - Create `src/middleware/rateLimitErrors.js`
    - Implement `buildRateLimitError(limit, resetAt)` function
    - Implement `buildMissingApiKeyError()` function
    - Follow existing error format from validation middleware
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  
  - [ ]* 4.2 Write unit tests for error response builders
    - Test MISSING_API_KEY error format
    - Test RATE_LIMIT_EXCEEDED error includes limit and resetAt
    - Verify JSON structure matches specification
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [ ] 5. Implement rate limit headers utility
  - [x] 5.1 Create rate limit headers builder
    - Create `src/middleware/rateLimitHeaders.js`
    - Implement `buildRateLimitHeaders(limit, remaining, resetTime)` function
    - Return object with X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
    - _Requirements: 4.5_
  
  - [ ]* 5.2 Write property test for headers presence
    - **Property 10: Rate Limit Headers Presence**
    - **Validates: Requirements 4.5**
    - Verify all three required headers are present in any response

- [ ] 6. Implement core rate limiter middleware
  - [x] 6.1 Create rateLimiter middleware function
    - Create `src/middleware/rateLimiter.js`
    - Implement middleware factory function accepting options
    - Extract API key from X-API-Key header
    - Handle missing/empty API key with 401 response
    - Integrate RequestCounter for tracking
    - Check if request is within limit
    - Add rate limit headers to all responses
    - Call next() if within limit, send 429 if exceeded
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.1, 3.2, 5.1, 5.2, 5.3, 5.4_
  
  - [ ]* 6.2 Write property test for API key identification
    - **Property 1: API Key Identification and Tracking**
    - **Validates: Requirements 1.1, 1.4**
    - Verify same API key increments same counter across requests
  
  - [ ]* 6.3 Write unit tests for missing/empty API key edge cases
    - Test missing X-API-Key header returns 401
    - Test empty X-API-Key header returns 401
    - Verify error code is MISSING_API_KEY
    - _Requirements: 1.2, 1.3, 4.1_
  
  - [ ]* 6.4 Write property test for rate limit enforcement
    - **Property 7: Rate Limit Enforcement**
    - **Validates: Requirements 3.1, 3.2**
    - Test requests below limit pass, at/above limit return 429
  
  - [ ]* 6.5 Write property test for configuration respect
    - **Property 8: Configuration Respect**
    - **Validates: Requirements 3.4, 3.5**
    - Verify configured limits and windows are enforced exactly
  
  - [ ]* 6.6 Write property test for error response completeness
    - **Property 9: Rate Limit Error Response Completeness**
    - **Validates: Requirements 4.2, 4.3, 4.4**
    - Verify 429 responses include all required fields
  
  - [ ]* 6.7 Write property test for middleware flow control
    - **Property 11: Middleware Flow Control**
    - **Validates: Requirements 5.3, 5.4**
    - Verify next() called when passing, not called when failing

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Integrate rate limiter with donation endpoints
  - [x] 8.1 Apply rate limiter to donation routes
    - Import rateLimiter middleware in `src/routes/donation.js`
    - Apply middleware before existing validation middleware
    - Configure with production-appropriate limits
    - _Requirements: 5.2, 5.5_
  
  - [ ]* 8.2 Write integration tests for middleware ordering
    - Test rate limiter executes before validation middleware
    - Test rate limited requests don't reach route handlers
    - Test successful requests pass through both middleware layers
    - _Requirements: 5.2, 5.5_

- [ ] 9. Add rate limiter to main application
  - [x] 9.1 Configure rate limiter in app.js
    - Import rate limit configuration
    - Initialize rate limiter with configuration
    - Document middleware ordering in comments
    - _Requirements: 5.1, 6.1_
  
  - [ ]* 9.2 Write end-to-end integration tests
    - Test complete request flow with rate limiting
    - Test rate limiting with actual donation endpoints
    - Verify existing functionality unaffected
    - Test multiple API keys work independently
    - _Requirements: 3.3, 5.5_

- [ ] 10. Add testing utilities and documentation
  - [x] 10.1 Create test utilities
    - Add helper functions for creating test requests with API keys
    - Add time mocking utilities for window expiration tests
    - Add counter reset utilities for test isolation
    - Document test configuration in README
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  
  - [x] 10.2 Update API documentation
    - Document X-API-Key header requirement
    - Document rate limit headers in responses
    - Document error codes and responses
    - Add examples of rate limiting behavior
    - _Requirements: 4.1, 4.2, 4.5_

- [x] 11. Final checkpoint - Ensure all tests pass
  - Run full test suite including unit and property tests
  - Verify CI checks pass
  - Verify CLI tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- Integration tests verify compatibility with existing middleware
- The implementation follows the existing patterns in the codebase (Express middleware, error format)
