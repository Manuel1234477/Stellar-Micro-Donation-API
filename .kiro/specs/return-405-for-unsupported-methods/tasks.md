# Implementation Plan: Return 405 for Unsupported Methods on Known Routes

## Overview

This plan implements router-level HTTP method handling that returns 405 Method Not Allowed with an Allow header for unsupported methods on known routes, while preserving 404 Not Found for truly unknown paths. The implementation uses a method registry populated during route registration and middleware to intercept requests before the 404 handler.

## Tasks

- [ ] 1. Add METHOD_NOT_ALLOWED error code
  - Add METHOD_NOT_ALLOWED error code to ERROR_CODES in src/utils/errors.js with numeric code 3006
  - _Requirements: 1.1, 2.1_

- [ ] 2. Create method registry and utilities
  - [ ] 2.1 Create method registry module
    - Create src/middleware/methodRegistry.js
    - Implement Map-based registry to track HTTP methods per route path
    - Implement normalizePath function to handle trailing slashes and ensure leading slash
    - Implement matchesRoutePattern function to convert Express route patterns to regex for parameterized routes
    - Implement findMatchingRoute function to find registered route matching request path
    - Export methodRegistry, registerMethod, getSupportedMethods, findMatchingRoute functions
    - _Requirements: 4.1, 4.2_
  
  - [ ]* 2.2 Write property test for path normalization
    - **Property: Path normalization consistency**
    - **Validates: Requirements 4.1**
  
  - [ ]* 2.3 Write property test for route pattern matching
    - **Property: Route pattern matching with parameters**
    - **Validates: Requirements 4.2**

- [ ] 3. Implement method checking middleware
  - [ ] 3.1 Create methodNotAllowedHandler middleware
    - Create src/middleware/methodNotAllowedHandler.js
    - Check if request path matches any registered route using findMatchingRoute
    - If no match, call next() to proceed to 404 handler
    - If match found, check if method is in supported methods
    - If method supported, call next() to proceed to route handler
    - If method not supported, return 405 with Allow header and error response
    - Format Allow header as comma-separated, sorted list of methods
    - Include requestId and timestamp in error response
    - _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4_
  
  - [ ]* 3.2 Write property test for 405 responses
    - **Property 1: Known routes with unsupported methods return 405 with accurate Allow header**
    - **Validates: Requirements 1.1, 2.1, 2.2, 2.3, 2.4**
  
  - [ ]* 3.3 Write unit tests for method checking middleware
    - Test specific examples: GET /wallets (supported), DELETE /wallets (unsupported)
    - Test trailing slash handling: /wallets vs /wallets/
    - Test parameterized routes: /wallets/:id with different IDs
    - Test case sensitivity: GET vs get
    - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [ ] 4. Implement OPTIONS handler
  - [ ] 4.1 Create OPTIONS handler middleware
    - Create src/middleware/optionsHandler.js or add to methodNotAllowedHandler.js
    - Intercept OPTIONS requests to known routes
    - Return 200 OK with Allow header listing all supported methods
    - If route not found, call next() to proceed to 404
    - _Requirements: 5.1, 5.2, 5.3_
  
  - [ ]* 4.2 Write property test for OPTIONS support
    - **Property 4: OPTIONS returns 200 with accurate Allow header**
    - **Validates: Requirements 5.1, 5.2, 5.3**
  
  - [ ]* 4.3 Write unit tests for OPTIONS handler
    - Test OPTIONS on known routes returns 200 with Allow header
    - Test OPTIONS on unknown routes returns 404
    - Verify OPTIONS includes itself in Allow header
    - _Requirements: 5.1, 5.2, 5.3_

- [ ] 5. Integrate registry with route registration
  - [ ] 5.1 Wrap route registration in bootstrap
    - Modify src/bootstrap/routes.js to populate method registry during route mounting
    - For each route in V1_ROUTES and ADMIN_ROUTES, extract and register HTTP methods
    - Handle Express Router objects that may have multiple methods per path
    - Automatically add OPTIONS to all registered routes
    - _Requirements: 4.1, 4.2, 4.4_
  
  - [ ]* 5.2 Write integration tests for route registration
    - Test that mounting routes populates method registry
    - Test that registry contains correct methods for sample routes
    - Test that new routes are automatically included
    - _Requirements: 4.1, 4.2, 4.4_

- [ ] 6. Wire middleware into request pipeline
  - [ ] 6.1 Add middleware to bootstrap
    - Import methodNotAllowedHandler and optionsHandler in src/bootstrap/routes.js
    - Insert optionsHandler before methodNotAllowedHandler
    - Insert methodNotAllowedHandler after all route registrations but before notFoundHandler
    - Ensure order: routes → optionsHandler → methodNotAllowedHandler → notFoundHandler → errorHandler
    - _Requirements: 1.1, 3.1, 5.1_
  
  - [ ]* 6.2 Write integration tests for middleware ordering
    - Test that 405 middleware runs before 404 handler
    - Test that OPTIONS handler runs before 405 middleware
    - Test that route handlers run before 405 middleware for supported methods
    - _Requirements: 1.1, 1.2_

- [ ] 7. Add comprehensive test coverage
  - [ ]* 7.1 Write property test for unknown routes
    - **Property 2: Unknown routes return 404 without Allow header**
    - **Validates: Requirements 3.1, 3.2**
  
  - [ ]* 7.2 Write property test for supported methods
    - **Property 3: Supported methods are processed normally**
    - **Validates: Requirements 1.2**
  
  - [ ]* 7.3 Write end-to-end tests for representative routes
    - Test read-only route (GET /api/v1/docs/validation-errors)
    - Test write route (POST /api/v1/wallets)
    - Test mixed route (GET, PATCH /api/v1/wallets/:id)
    - Verify each returns correct 405 for unsupported methods
    - Verify each returns correct Allow header
    - _Requirements: 6.1, 6.4, 6.5_

- [ ] 8. Final checkpoint
  - Ensure all tests pass
  - Verify 405 responses include correct Allow headers
  - Verify 404 responses do not include Allow headers
  - Verify OPTIONS support works on all known routes
  - Ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each property test should run minimum 100 iterations
- Use fast-check for property-based testing
- Property tests must include tag comment: `Feature: return-405-for-unsupported-methods, Property N`
- The method registry approach ensures consistency across all routes without per-route configuration
- Middleware ordering is critical: OPTIONS → 405 → 404 → error handler
