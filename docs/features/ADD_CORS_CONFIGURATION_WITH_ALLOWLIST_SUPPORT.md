# CORS Configuration with Allowlist Support

## Overview

This feature adds a strict, configurable CORS policy to the Stellar Micro-Donation API.
Only origins explicitly listed in `CORS_ALLOWED_ORIGINS` receive CORS response headers.
All other cross-origin requests are rejected with HTTP 403.

Wildcard subdomain patterns (e.g. `*.example.com`) are supported for multi-tenant deployments.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CORS_ALLOWED_ORIGINS` | No | _(empty — all origins rejected)_ | Comma-separated list of allowed origins or wildcard patterns |
| `CORS_ALLOWED_METHODS` | No | `GET,POST,PUT,PATCH,DELETE,OPTIONS` | Allowed HTTP methods |
| `CORS_ALLOWED_HEADERS` | No | `Content-Type,Authorization,X-API-Key,X-Request-ID,X-Idempotency-Key` | Allowed request headers |
| `CORS_MAX_AGE` | No | `86400` (24 h) | Preflight cache duration in seconds |

### Example `.env`

```dotenv
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com,*.tenant.io
CORS_ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE,OPTIONS
CORS_ALLOWED_HEADERS=Content-Type,Authorization,X-API-Key,X-Request-ID,X-Idempotency-Key
CORS_MAX_AGE=86400
```

---

## Origin Matching Rules

1. **Exact match** — `https://app.example.com` matches only that origin.
2. **Wildcard subdomain** — `*.example.com` matches `https://sub.example.com` but NOT `https://example.com` or `https://deep.sub.example.com`.

Matching is case-sensitive.

---

## Request Flow

```
Browser request with Origin header
        │
        ▼
  Is origin in allowlist?
   ├── No  → 403 CORS_ORIGIN_NOT_ALLOWED
   └── Yes → Set CORS headers
               │
               ├── OPTIONS (preflight) → 204 + Access-Control-Max-Age
               └── Other methods       → pass to next middleware
```

---

## Response Headers (allowed origin)

| Header | Value |
|---|---|
| `Access-Control-Allow-Origin` | Reflected request `Origin` |
| `Vary` | `Origin` |
| `Access-Control-Allow-Methods` | Configured methods |
| `Access-Control-Allow-Headers` | Configured headers |
| `Access-Control-Allow-Credentials` | `true` |
| `Access-Control-Max-Age` | Configured max-age (preflight only) |

---

## Security Assumptions

- The allowlist is the single source of truth. No wildcard `*` is ever set.
- `Access-Control-Allow-Credentials: true` is only sent when the origin is explicitly allowed, preventing credential leakage.
- `Vary: Origin` is always set to prevent caching of CORS responses across origins.
- Requests without an `Origin` header (same-origin, server-to-server) pass through without CORS headers.
- A warning is logged at startup when `CORS_ALLOWED_ORIGINS` is unset in production.

---

## Implementation

- Middleware: `src/middleware/cors.js`
- Applied in: `src/routes/app.js` (before body parsers and route handlers)
- Tests: `tests/add-cors-configuration-with-allowlist-support.test.js`

---

## Testing

```bash
npm test tests/add-cors-configuration-with-allowlist-support.test.js
```
