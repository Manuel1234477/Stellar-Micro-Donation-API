# Request Deduplication Beyond Idempotency Keys

## Overview

Content-based request deduplication detects duplicate requests that arrive without an idempotency key. It fingerprints requests using SHA-256 of method + path + body + API key and caches successful responses for 30 seconds. Duplicate requests within that window receive the cached response with an `X-Deduplicated: true` header.

## How It Works

1. A mutation request (POST, PUT, PATCH) arrives without an idempotency key header.
2. The middleware computes a SHA-256 fingerprint from the request method, path, JSON body, and API key.
3. If a matching fingerprint exists in cache, the cached response is returned immediately with `X-Deduplicated: true`.
4. If no match, the request proceeds normally. On a 2xx response, the result is cached for 30 seconds.

## Relationship to Idempotency Keys

This middleware complements the existing idempotency key system:

| Scenario | Handler |
|----------|---------|
| Request has `Idempotency-Key` header | Idempotency middleware (per-route) |
| Request has no idempotency header | Deduplication middleware (global) |

When an idempotency key header is present, deduplication is skipped entirely.

## Configuration

The middleware accepts optional configuration:

| Option | Default | Description |
|--------|---------|-------------|
| `ttlMs` | `30000` | Cache TTL in milliseconds |
| `methods` | `['POST', 'PUT', 'PATCH']` | HTTP methods to deduplicate |

## Response Headers

| Header | Value | When |
|--------|-------|------|
| `X-Deduplicated` | `true` | Response was served from deduplication cache |

## Limitations

- **Best-effort**: Two simultaneous identical requests before either completes will both be processed. Database constraints and the idempotency system are the true correctness guarantees.
- **In-memory only**: Cache is lost on server restart. This is acceptable given the 30-second TTL.
- **JSON responses only**: Only `res.json()` responses are cached. All mutation endpoints in this API use `res.json()`.
