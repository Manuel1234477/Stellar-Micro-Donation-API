# Requirements Document

## Introduction

This document specifies requirements for standardizing rate limit header emission across all rate-limiting layers in the system. Currently, rate limit headers may be applied inconsistently across different limiter implementations (global rate limiters using express-rate-limit and per-key limiters), leading to unreliable quota information for API consumers. This feature ensures all rate-limited responses emit IETF-standard headers consistently, enabling machine-consumable rate limiting.

## Glossary

- **Rate_Limiter**: Any middleware component that enforces request rate limits, including express-rate-limit based limiters and custom per-key limiters
- **IETF_Headers**: The standard RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers defined in the IETF draft standard
- **Legacy_Headers**: The X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers (prefixed with X-)
- **Rate_Limited_Response**: Any HTTP response from an endpoint protected by rate limiting, whether successful (2xx) or throttled (429)
- **Retry_After_Header**: The HTTP Retry-After header indicating seconds until the client may retry after receiving a 429 response
- **Limiter_Layer**: A specific rate-limiting mechanism in the stack (e.g., donation limiter, verification limiter, per-key limiter)
- **Active_Limiter**: The limiter that would or did throttle a request based on the most restrictive applicable limit

## Requirements

### Requirement 1: Emit Standard Headers on All Rate-Limited Responses

**User Story:** As an API consumer, I want to receive standard IETF rate limit headers on every response from rate-limited endpoints, so that I can programmatically track my quota and plan my requests without getting surprised by 429 responses.

#### Acceptance Criteria

1. THE System SHALL emit RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers on all successful responses from rate-limited endpoints
2. THE System SHALL emit RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers on all 429 throttled responses
3. THE System SHALL emit the Retry-After header on all 429 responses with the number of seconds until the rate limit resets
4. THE System SHALL emit Legacy_Headers (X-RateLimit-*) alongside IETF_Headers for backward compatibility

### Requirement 2: Consistent Header Values Across Limiter Layers

**User Story:** As an API consumer, I want rate limit headers to reflect the actual limiter that constrains my requests, so that I can accurately predict when I will be throttled and avoid contradictory quota information.

#### Acceptance Criteria

1. WHEN multiple Limiter_Layers apply to a single endpoint, THE System SHALL emit headers reflecting the Active_Limiter with the most restrictive remaining quota
2. WHEN a request passes through multiple rate limiters, THE System SHALL NOT emit duplicate or contradictory rate limit header values
3. THE System SHALL ensure rate limit header values accurately reflect the limiter state that determined whether the request was allowed or throttled

### Requirement 3: Centralized Header Emission Logic

**User Story:** As a developer, I want all rate limiters to route through a single header-emission function, so that header format and values remain consistent as new limiters are added.

#### Acceptance Criteria

1. THE System SHALL use a single buildRateLimitHeaders function for all rate limiter implementations
2. WHEN a Rate_Limiter needs to emit headers, THE System SHALL call the shared buildRateLimitHeaders function with limit, remaining, and resetTime parameters
3. THE System SHALL ensure all express-rate-limit based limiters and custom per-key limiters use the same header-emission logic

### Requirement 4: Correct Retry-After Calculation

**User Story:** As an API consumer, I want the Retry-After header to accurately reflect when my rate limit will reset, so that I can schedule my retry attempts efficiently without wasting time or hitting the limit again.

#### Acceptance Criteria

1. WHEN a 429 response is returned, THE System SHALL calculate Retry-After as the ceiling of seconds remaining until the rate limit window resets
2. THE System SHALL ensure Retry-After values match the RateLimit-Reset timestamp
3. THE System SHALL emit Retry-After as a string containing a positive integer number of seconds

### Requirement 5: Preserve Existing Limiter Behavior

**User Story:** As a system operator, I want rate limit header improvements to maintain existing rate limiting behavior, so that API consumers experience no disruption in rate limit enforcement.

#### Acceptance Criteria

1. THE System SHALL maintain all existing rate limit thresholds (max requests per window) without modification
2. THE System SHALL maintain all existing rate limit window durations without modification
3. THE System SHALL maintain all existing key generation logic (IP-based, API-key-based) without modification
4. THE System SHALL maintain all existing skip logic (test environment, idempotency bypass) without modification

### Requirement 6: Test Coverage for Header Emission

**User Story:** As a developer, I want comprehensive tests asserting rate limit headers appear correctly, so that I can be confident headers remain consistent as the codebase evolves.

#### Acceptance Criteria

1. THE Test_Suite SHALL verify RateLimit-Limit, RateLimit-Remaining, and RateLimit-Reset headers appear on successful responses from each Limiter_Layer
2. THE Test_Suite SHALL verify RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, and Retry-After headers appear on 429 responses from each Limiter_Layer
3. THE Test_Suite SHALL verify header values match the expected limiter state (limit, remaining quota, reset time)
4. THE Test_Suite SHALL verify Legacy_Headers (X-RateLimit-*) match IETF_Headers values
