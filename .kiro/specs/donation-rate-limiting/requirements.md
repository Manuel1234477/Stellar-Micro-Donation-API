# Requirements Document

## Introduction

This document specifies the requirements for implementing per-API key rate limiting in the Stellar Micro-Donation API. The system must prevent abuse by individual API consumers while ensuring legitimate traffic remains unaffected. Rate limiting will be enforced at the API key level, allowing fine-grained control over request rates for different consumers.

## Glossary

- **API_Key**: A unique identifier string passed in the `X-API-Key` HTTP header that identifies an API consumer
- **Rate_Limiter**: The middleware component that tracks and enforces request limits per API key
- **Request_Counter**: A data structure that tracks the number of requests made by each API key within a time window
- **Time_Window**: The duration (in seconds) over which request counts are tracked and limits are enforced
- **Rate_Limit**: The maximum number of requests allowed per API key within a time window
- **Donation_Endpoint**: Any API endpoint under the `/donations` route that processes donation-related requests

## Requirements

### Requirement 1: API Key Identification

**User Story:** As an API consumer, I want to include my API key in requests, so that the system can identify and track my usage.

#### Acceptance Criteria

1. WHEN a request is received, THE Rate_Limiter SHALL extract the API key from the `X-API-Key` HTTP header
2. WHEN the `X-API-Key` header is missing, THE Rate_Limiter SHALL reject the request with a 401 status code
3. WHEN the `X-API-Key` header is empty, THE Rate_Limiter SHALL reject the request with a 401 status code
4. THE Rate_Limiter SHALL use the API key value as the identifier for tracking request counts

### Requirement 2: Request Tracking

**User Story:** As a system administrator, I want to track request counts per API key, so that I can enforce rate limits accurately.

#### Acceptance Criteria

1. WHEN a valid request is received, THE Request_Counter SHALL increment the count for that API key
2. THE Request_Counter SHALL store counts with timestamp information for time window calculations
3. WHEN the Time_Window expires, THE Request_Counter SHALL reset the count for that API key
4. THE Request_Counter SHALL maintain separate counts for each unique API key
5. THE Request_Counter SHALL handle concurrent requests from the same API key without race conditions

### Requirement 3: Rate Limit Enforcement

**User Story:** As a system administrator, I want to enforce configurable rate limits, so that I can prevent abuse while accommodating legitimate usage patterns.

#### Acceptance Criteria

1. WHEN a request count exceeds the Rate_Limit, THE Rate_Limiter SHALL reject the request with a 429 status code
2. WHEN a request count is within the Rate_Limit, THE Rate_Limiter SHALL allow the request to proceed
3. THE Rate_Limiter SHALL apply limits independently to each API key
4. THE Rate_Limiter SHALL read the Rate_Limit value from configuration
5. THE Rate_Limiter SHALL read the Time_Window value from configuration

### Requirement 4: Error Response Format

**User Story:** As an API consumer, I want to receive clear error messages when rate limited, so that I can adjust my request patterns accordingly.

#### Acceptance Criteria

1. WHEN a request is rejected due to missing API key, THE Rate_Limiter SHALL return a JSON response with error code `MISSING_API_KEY`
2. WHEN a request is rejected due to rate limit exceeded, THE Rate_Limiter SHALL return a JSON response with error code `RATE_LIMIT_EXCEEDED`
3. WHEN returning a rate limit error, THE Rate_Limiter SHALL include the time remaining until the limit resets
4. WHEN returning a rate limit error, THE Rate_Limiter SHALL include the current rate limit value
5. THE Rate_Limiter SHALL include standard HTTP headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` in all responses

### Requirement 5: Middleware Integration

**User Story:** As a developer, I want the rate limiter to integrate seamlessly with existing middleware, so that it can be easily applied to protected endpoints.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL be implemented as Express middleware
2. THE Rate_Limiter SHALL be applied before route handlers execute
3. WHEN rate limiting passes, THE Rate_Limiter SHALL call the next middleware in the chain
4. WHEN rate limiting fails, THE Rate_Limiter SHALL not call the next middleware
5. THE Rate_Limiter SHALL be compatible with existing validation middleware

### Requirement 6: Configuration Management

**User Story:** As a system administrator, I want to configure rate limits without code changes, so that I can adjust limits based on operational needs.

#### Acceptance Criteria

1. THE System SHALL read rate limit configuration from environment variables
2. THE System SHALL provide default values when environment variables are not set
3. THE System SHALL validate configuration values at startup
4. WHEN configuration values are invalid, THE System SHALL log an error and use default values
5. THE System SHALL support configuration of both Rate_Limit and Time_Window values

### Requirement 7: Testing Support

**User Story:** As a developer, I want to test rate limiting behavior, so that I can verify correctness before deployment.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL support in-memory storage for testing environments
2. THE Rate_Limiter SHALL provide a method to reset all counters for testing
3. THE Rate_Limiter SHALL allow configuration overrides in test environments
4. WHEN running tests, THE System SHALL use shorter time windows for faster test execution
5. THE Rate_Limiter SHALL be testable without external dependencies

### Requirement 8: Performance and Scalability

**User Story:** As a system administrator, I want rate limiting to have minimal performance impact, so that legitimate requests are not slowed down.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL complete request validation within 10 milliseconds for 95% of requests
2. THE Request_Counter SHALL use efficient data structures for O(1) lookup time
3. THE Rate_Limiter SHALL clean up expired entries to prevent memory growth
4. WHEN memory usage exceeds a threshold, THE Rate_Limiter SHALL remove oldest expired entries
5. THE Rate_Limiter SHALL handle at least 1000 requests per second without degradation
