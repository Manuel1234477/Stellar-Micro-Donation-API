# CORS Allowlist Management

Runtime per-origin CORS allowlist backed by the database, with 60-second TTL caching and wildcard subdomain support.

## Overview

The CORS middleware merges two origin sources on every request:

1. **Static** — `CORS_ALLOWED_ORIGINS` environment variable (comma-separated)
2. **Dynamic** — `cors_origins` database table (cached 60 s TTL)

Admins can add or remove origins at runtime without restarting the server.

## Database Table

```sql
CREATE TABLE cors_origins (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  origin           TEXT NOT NULL UNIQUE,
  allowCredentials INTEGER NOT NULL DEFAULT 1,
  createdAt        DATETIME DEFAULT CURRENT_TIMESTAMP,
  createdBy        TEXT
);
```

## API Endpoints

All endpoints require an **admin** API key (`X-API-Key` header).

### List origins

```
GET /admin/cors/origins
```

Response `200`:
```json
{ "success": true, "data": [{ "id": 1, "origin": "https://app.example.com", "allowCredentials": 1, "createdAt": "..." }], "count": 1 }
```

### Add an origin

```
POST /admin/cors/origins
Content-Type: application/json

{ "origin": "https://app.example.com", "allowCredentials": true }
```

- `origin` — exact URL (`https://example.com`) or wildcard subdomain pattern (`*.example.com`)
- `allowCredentials` — optional, defaults to `true`

Response `201`:
```json
{ "success": true, "data": { "id": 2, "origin": "*.example.com", ... } }
```

Errors:
- `400` — missing or invalid origin format
- `409` — origin already exists

### Remove an origin

```
DELETE /admin/cors/origins/:id
```

Response `200`:
```json
{ "success": true, "message": "Origin removed from allowlist" }
```

## Wildcard Subdomain Patterns

Patterns starting with `*.` match any single subdomain:

| Pattern | Matches | Does not match |
|---------|---------|----------------|
| `*.example.com` | `https://app.example.com` | `https://example.com` |
| `*.example.com` | `http://api.example.com` | `https://evil.com` |

## Caching

The DB allowlist is cached in memory with a **60-second TTL**. The cache is invalidated immediately after any `POST` or `DELETE` to `/admin/cors/origins`.

To force a reload without an API call, restart the server or wait for the TTL to expire.

## Credential-Bearing Requests

All allowed origins receive `Access-Control-Allow-Credentials: true`. The `allowCredentials` column is stored for future per-origin credential control.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CORS_ALLOWED_ORIGINS` | Comma-separated static origins (supplement to DB list) |
| `CORS_ALLOWED_METHODS` | Override default allowed HTTP methods |
| `CORS_ALLOWED_HEADERS` | Override default allowed request headers |
| `CORS_MAX_AGE` | Preflight cache duration in seconds (default: 86400) |
