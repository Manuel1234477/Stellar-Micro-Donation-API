# Body Hash Deduplication

This feature adds a second layer of request deduplication using a hash of the API key, endpoint, and sorted request body. It complements the existing idempotency-key system.

## How It Works
- For POST and PATCH requests (not GET), the middleware computes a SHA-256 hash of:
  - API key (x-api-key)
  - Endpoint (URL)
  - Sorted JSON body
- If an identical request is received within the deduplication window (default 30s, configurable via DEDUP_WINDOW_MS), the cached response is returned with `X-Deduplicated: true`.
- GET requests are never deduplicated.
- Requests with different API keys are not deduplicated against each other.

## Configuration
- Deduplication window: set via `DEDUP_WINDOW_MS` environment variable (default: 30000 ms)

## API Reference
- Middleware: `createDeduplicationMiddleware`
- Header: `X-Deduplicated: true` on deduplicated responses

## Test Coverage
- Deduplication hit (identical POST/PATCH)
- Deduplication miss (different API key)
- Window expiry
- GET exclusion
- PATCH support

## JSDoc
All new functions are documented in the codebase.
