# Requirements Document

## Introduction

This document specifies requirements for proper HTTP method handling on known routes. Currently, when a client requests a known path with an unsupported HTTP method (e.g., DELETE on a read-only resource), the system returns 404 Not Found. This is misleading because the resource exists, but the method is not supported. The correct HTTP response is 405 Method Not Allowed with an Allow header listing the valid methods. This feature ensures compliant HTTP semantics and clearer error messages for API consumers.

## Glossary

- **Known_Route**: A path registered in the router with at least one supported HTTP method
- **Unknown_Route**: A path that is not registered in the router at all
- **Supported_Method**: An HTTP method (GET, POST, PUT, DELETE, etc.) for which a handler is registered on a Known_Route
- **Unsupported_Method**: An HTTP method that is not registered on a Known_Route
- **Allow_Header**: The HTTP Allow header that enumerates the valid HTTP methods for a resource
- **Router**: The HTTP routing component responsible for mapping paths and methods to handlers

## Requirements

### Requirement 1: Return 405 for Unsupported Methods on Known Routes

**User Story:** As an API consumer, I want to receive a 405 Method Not Allowed response when I use an unsupported HTTP method on a known route, so that I understand the resource exists but my method choice is invalid.

#### Acceptance Criteria

1. WHEN a client requests a Known_Route with an Unsupported_Method, THE Router SHALL return HTTP status 405 Method Not Allowed
2. WHEN a client requests a Known_Route with a Supported_Method, THE Router SHALL process the request normally and return the appropriate status code (200, 201, 400, etc.)
3. THE Router SHALL NOT return 404 Not Found for requests to Known_Routes with Unsupported_Methods

### Requirement 2: Include Allow Header with Supported Methods

**User Story:** As an API consumer, I want to receive an Allow header listing all supported methods when I get a 405 response, so that I know which methods I can use without trial and error.

#### Acceptance Criteria

1. WHEN returning a 405 response, THE Router SHALL include an Allow_Header listing all Supported_Methods for that Known_Route
2. THE Router SHALL format the Allow_Header as a comma-separated list of HTTP method names
3. THE Router SHALL include only methods that have registered handlers for the specific Known_Route
4. THE Router SHALL list methods in a consistent order (e.g., GET, POST, PUT, PATCH, DELETE, OPTIONS)

### Requirement 3: Preserve 404 for Unknown Routes

**User Story:** As an API consumer, I want to receive a 404 Not Found response for paths that don't exist in the API, so that I can distinguish between invalid paths and invalid methods.

#### Acceptance Criteria

1. WHEN a client requests an Unknown_Route with any HTTP method, THE Router SHALL return HTTP status 404 Not Found
2. THE Router SHALL NOT include an Allow_Header in 404 responses for Unknown_Routes
3. THE Router SHALL maintain existing 404 behavior for paths that are not registered in the routing table

### Requirement 4: Router-Level Method Handling

**User Story:** As a developer, I want 405 handling to be implemented at the router level, so that it applies consistently across all routes without per-route configuration.

#### Acceptance Criteria

1. THE Router SHALL determine whether a path is a Known_Route before dispatching to route handlers
2. THE Router SHALL check the requested method against the list of Supported_Methods for Known_Routes
3. THE Router SHALL generate 405 responses automatically without requiring per-route handler code
4. WHEN new routes are registered, THE Router SHALL automatically include them in 405 handling without additional configuration

### Requirement 5: OPTIONS Method Support

**User Story:** As an API consumer, I want to use the OPTIONS method to discover supported methods for a route, so that I can programmatically determine API capabilities.

#### Acceptance Criteria

1. WHEN a client sends an OPTIONS request to a Known_Route, THE Router SHALL return HTTP status 200 OK with an Allow_Header
2. THE Router SHALL include all Supported_Methods for that route in the Allow_Header of OPTIONS responses
3. THE Router SHALL include OPTIONS itself in the Allow_Header if it is supported

### Requirement 6: Test Coverage for Method Handling

**User Story:** As a developer, I want comprehensive tests verifying 405 and 404 responses, so that I can be confident method handling works correctly across the API surface.

#### Acceptance Criteria

1. THE Test_Suite SHALL verify that Known_Routes return 405 with an accurate Allow_Header when called with Unsupported_Methods
2. THE Test_Suite SHALL verify that Known_Routes process requests normally when called with Supported_Methods
3. THE Test_Suite SHALL verify that Unknown_Routes return 404 without an Allow_Header
4. THE Test_Suite SHALL verify that OPTIONS requests to Known_Routes return 200 with an accurate Allow_Header
5. THE Test_Suite SHALL include tests for representative routes covering different method combinations (read-only, write-only, mixed)
