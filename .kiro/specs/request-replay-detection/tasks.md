# Implementation Plan: Request Replay Detection

## Overview

This implementation plan breaks down the replay detection feature into discrete coding tasks. The approach is incremental: start with core fingerprinting and tracking, add detection logic, implement observability features, and finally add cleanup and admin endpoints. Each task builds on previous work, with testing integrated throughout to catch errors early.

## Tasks

- [x] 1. Set up configuration module and tracking store
  - [x] 1.1 Create configuration loader with environment variable support
    - Implement `src/config/replayDetection.js` to load REPLAY_THRESHOLD, REPLAY_WINDOW_SECONDS, and REPLAY_CLEANUP_INTERVAL_SECONDS
    - Add validation for minimum values (threshold >= 2, window >= 10)
    - Return default values for invalid or missing config
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  
  - [ ]* 1.2 Write property test for configuration validation
    - **Property 5: Configuration Validation**
    - **Validates: Requirements 2.3, 2.4, 8.4, 8.5**
  
  - [x] 1.3 Implement TrackingStore class
    - Create `src/utils/replayDetector.js` with TrackingStore class
    - Implement Map-based storage: fingerprint → array of timestamps
    - Add methods: record(), getCount(), getTimestamps(), cleanup(), getStats()
    - _Requirements: 2.1, 2.5_
  
  - [ ]* 1.4 Write property test for tracking store recording
    - **Property 3: Recording Preserves Fingerprints**
    - **Validates: Requirements 2.1**

- [x] 2. Implement fingerprint computation
  - [x] 2.1 Create fingerprint generator function
    - Add computeFingerprint() function to `src/utils/replayDetector.js`
    - Use SHA-256 hash of JSON-serialized {method, path, body}
    - Handle empty/missing body gracefully
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  
  - [ ]* 2.2 Write property test for fingerprint determinism and uniqueness
    - **Property 1: Fingerprint Determinism and Uniqueness**
    - **Validates: Requirements 1.1, 1.2, 1.3**
  
  - [ ]* 2.3 Write property test for fingerprint robustness
    - **Property 2: Fingerprint Computation Always Succeeds**
    - **Validates: Requirements 1.1, 1.5**
  
  - [ ]* 2.4 Write unit tests for fingerprint edge cases
    - Test empty body, large body (>1MB), special characters
    - Test null/undefined fields
    - _Requirements: 1.5_

- [x] 3. Implement core replay detection middleware
  - [x] 3.1 Create replay detection middleware function
    - Create `src/middleware/replayDetection.js`
    - Implement middleware that computes fingerprint, records in store, checks threshold
    - Wrap all logic in try-catch to ensure next() is always called
    - _Requirements: 4.1, 4.2, 4.3, 9.2_
  
  - [x] 3.2 Add replay detection logic
    - Check if fingerprint count exceeds threshold within window
    - Determine if current request is a replay event
    - _Requirements: 2.2, 2.5_
  
  - [ ]* 3.3 Write property test for replay detection threshold logic
    - **Property 4: Replay Detection Threshold Logic**
    - **Validates: Requirements 2.2, 2.5**
  
  - [ ]* 3.4 Write property test for non-blocking behavior
    - **Property 7: Non-Blocking Request Processing**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 4. Add logging for replay events
  - [x] 4.1 Implement replay event logging
    - Use existing structured logging utility from `src/utils/log.js`
    - Log with level "warn" when replay detected
    - Include fingerprint, count, method, path, window, timestamps, time elapsed
    - Conditionally include API key if present in request
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.1_
  
  - [ ]* 4.2 Write property test for logging completeness
    - **Property 6: Replay Event Logging Completeness**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**
  
  - [ ]* 4.3 Write property test for cleanup logging
    - **Property 13: Cleanup Logging**
    - **Validates: Requirements 7.5**

- [x] 5. Add response headers for observability
  - [x] 5.1 Implement response header addition
    - When replay detected, add X-Replay-Detected, X-Replay-Count, X-Replay-Window headers
    - Ensure headers are not added when no replay detected
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  
  - [ ]* 5.2 Write property test for response headers
    - **Property 8: Response Headers for Replay Events**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
  
  - [ ]* 5.3 Write unit tests for header edge cases
    - Test headers present when replay detected
    - Test headers absent when no replay
    - Test header values are correct
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. Checkpoint - Ensure core functionality works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement cleanup process
  - [x] 7.1 Add cleanup method to TrackingStore
    - Implement cleanup() to remove timestamps older than window
    - Remove fingerprint entries with no remaining timestamps
    - Return statistics about removed entries
    - _Requirements: 7.1, 7.3, 7.4_
  
  - [x] 7.2 Create cleanup timer process
    - Add startCleanup() function that runs cleanup at configured interval
    - Log cleanup statistics after each run
    - Return timer reference for shutdown
    - _Requirements: 7.2, 7.5_
  
  - [ ]* 7.3 Write property test for cleanup timestamp removal
    - **Property 11: Cleanup Removes Old Timestamps**
    - **Validates: Requirements 7.1, 7.3**
  
  - [ ]* 7.4 Write property test for cleanup fingerprint removal
    - **Property 12: Cleanup Removes Empty Fingerprints**
    - **Validates: Requirements 7.4**
  
  - [ ]* 7.5 Write unit tests for cleanup timing
    - Test cleanup runs at configured interval
    - Test cleanup can be stopped
    - _Requirements: 7.2_

- [x] 8. Implement admin statistics endpoint
  - [x] 8.1 Add getStats() method to TrackingStore
    - Return totalFingerprints, totalTimestamps, topFingerprints (sorted by count)
    - Include oldest/newest timestamps, window, threshold
    - _Requirements: 6.2, 6.3_
  
  - [x] 8.2 Create admin endpoint route
    - Add GET /admin/replay-stats endpoint to `src/routes/admin.js`
    - Require admin authentication (use existing middleware)
    - Return JSON statistics from trackingStore.getStats()
    - _Requirements: 6.1, 6.4, 6.5_
  
  - [ ]* 8.3 Write property test for statistics completeness
    - **Property 9: Statistics Response Completeness**
    - **Validates: Requirements 6.2, 6.5**
  
  - [ ]* 8.4 Write property test for statistics sorting
    - **Property 10: Statistics Sorting**
    - **Validates: Requirements 6.3**
  
  - [ ]* 8.5 Write unit tests for admin endpoint
    - Test endpoint returns 200 with valid auth
    - Test endpoint returns 401 without auth
    - Test response is valid JSON
    - _Requirements: 6.1, 6.4, 6.5_

- [x] 9. Integration and wiring
  - [x] 9.1 Wire middleware into Express app
    - Add replay detection middleware to main app in appropriate position
    - Ensure it runs after logger but before routes
    - Start cleanup timer on app startup
    - _Requirements: 9.2_
  
  - [x] 9.2 Add graceful shutdown handling
    - Stop cleanup timer on app shutdown
    - Clear tracking store if needed
    - _Requirements: 7.2_
  
  - [ ]* 9.3 Write integration tests
    - Test middleware works with existing idempotency middleware
    - Test middleware works with existing abuse detection
    - Test end-to-end request flow with replay detection
    - _Requirements: 9.3, 9.4_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties (minimum 100 iterations each)
- Unit tests validate specific examples and edge cases
- Integration tests verify compatibility with existing middleware
- The implementation uses JavaScript/Node.js with Express framework
- Property-based testing uses fast-check library
