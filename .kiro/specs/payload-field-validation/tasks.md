# Implementation Plan: Payload Field Validation

## Overview

This implementation plan breaks down the payload field validation feature into discrete coding tasks. The approach is to first create the core field schema registry and detection logic, then integrate it into the existing validation middleware, and finally add comprehensive testing.

## Tasks

- [ ] 1. Create field schema registry and detection utilities
  - [x] 1.1 Create field schema registry module
    - Create `src/config/fieldSchemas.js` with schema definitions for all endpoints
    - Define schemas for: POST /donations/send, POST /donations, POST /donations/verify, PATCH /donations/:id/status, POST /wallets, PATCH /wallets/:id, POST /transactions/sync, POST /api-keys, POST /api-keys/cleanup
    - Export `getFieldSchema(method, path)` function
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11_

  - [x] 1.2 Create unknown field detector utility
    - Create `src/utils/fieldValidator.js` with `detectUnknownFields(payload, allowedFields)` function
    - Implement logic to compare payload keys against allowed fields
    - Return array of unknown field names
    - _Requirements: 2.1, 2.2_

  - [ ]* 1.3 Write property test for unknown field detection
    - **Property 1: Unknown Field Detection Completeness**
    - **Validates: Requirements 2.2, 2.3, 2.4**
    - Generate random payloads with known and unknown fields
    - Verify all unknown fields are detected regardless of position

  - [x]* 1.4 Write unit tests for field schema registry
    - Test that all required endpoints have schemas defined
    - Test that schemas contain correct field names
    - Test getFieldSchema returns correct schema for each endpoint
    - _Requirements: 1.1, 1.3-1.11_

- [ ] 2. Integrate unknown field validation into middleware
  - [x] 2.1 Enhance validation middleware with unknown field checking
    - Modify `src/middleware/validation.js` to call field schema registry
    - Add unknown field detection before existing validation logic
    - Implement request rejection when unknown fields detected
    - Return 400 status with error response containing unknown fields
    - _Requirements: 3.1, 3.2, 3.4, 4.1, 4.2_

  - [x] 2.2 Create error response formatter
    - Add `formatUnknownFieldError(unknownFields)` function to validation helpers
    - Ensure error format matches existing validation error structure
    - Include error, message, and unknownFields in response
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 2.3 Write property test for request rejection
    - **Property 2: Request Rejection on Unknown Fields**
    - **Validates: Requirements 3.1, 3.2**
    - Generate random payloads with unknown fields
    - Verify all are rejected with 400 status and business logic not executed

  - [ ]* 2.4 Write property test for valid request acceptance
    - **Property 3: Valid Request Acceptance**
    - **Validates: Requirements 3.3**
    - Generate random valid payloads (only allowed fields)
    - Verify all are accepted and proceed to business logic

- [ ] 3. Checkpoint - Ensure core validation works
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Add comprehensive error handling and testing
  - [x] 4.1 Add HTTP method filtering
    - Modify validation middleware to only apply unknown field validation to POST, PUT, PATCH
    - Skip validation for GET and DELETE requests
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 4.2 Write property test for error response completeness
    - **Property 4: Error Response Completeness**
    - **Validates: Requirements 4.1, 4.2**
    - Generate random sets of unknown fields
    - Verify all unknown fields appear in error response

  - [ ]* 4.3 Write property test for backward compatibility
    - **Property 5: Backward Compatibility Preservation**
    - **Validates: Requirements 5.1, 5.2**
    - Use known valid payloads from existing tests
    - Verify all previously valid requests still work

  - [x]* 4.4 Write unit tests for error response format
    - Test error response structure matches existing format
    - Test error message is descriptive
    - Test unknownFields array is populated correctly
    - _Requirements: 4.3, 4.4, 4.5_

  - [ ]* 4.5 Write unit tests for HTTP method filtering
    - Test POST endpoints have validation applied
    - Test PATCH endpoints have validation applied
    - Test PUT endpoints have validation applied (if any exist)
    - Test GET endpoints skip validation
    - Test DELETE endpoints skip validation
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 5. Integration testing and validation
  - [x]* 5.1 Write integration tests for each endpoint
    - Test POST /donations/send rejects unknown fields
    - Test POST /donations rejects unknown fields
    - Test POST /donations/verify rejects unknown fields
    - Test PATCH /donations/:id/status rejects unknown fields
    - Test POST /wallets rejects unknown fields
    - Test PATCH /wallets/:id rejects unknown fields
    - Test POST /transactions/sync rejects unknown fields
    - Test POST /api-keys rejects unknown fields
    - Test POST /api-keys/cleanup rejects unknown fields
    - _Requirements: 1.3-1.11, 3.1_

  - [x]* 5.2 Write integration tests for backward compatibility
    - Test existing valid requests for each endpoint still work
    - Test existing validation errors still return correct format
    - Test required field validation still works
    - Test value validation still works
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 6. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties across random inputs
- Unit tests validate specific examples, edge cases, and error formats
- Integration tests verify end-to-end behavior for each endpoint
- The implementation preserves backward compatibility by only rejecting new invalid requests
