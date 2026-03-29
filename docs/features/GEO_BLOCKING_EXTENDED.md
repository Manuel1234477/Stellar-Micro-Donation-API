# Geo Blocking Extended

## Overview

The geo-blocking middleware now supports database-backed country allow and block rules in addition to the existing static environment configuration.

Key additions:

- Runtime-managed country allowlist and blocklist rules stored in `geo_rules`
- Admin endpoints for adding, deleting, and listing geo rules without a restart
- Audit log entries for every blocked request with the detected IP, country, and matched rule
- In-memory geo rule cache with a 60-second TTL and explicit cache invalidation on writes

## Data Model

Runtime-managed geo rules are stored in the `geo_rules` table.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | integer | Primary key |
| `countryCode` | text | ISO 3166-1 alpha-2 country code |
| `ruleType` | text | `allow` or `block` |
| `createdAt` | datetime | Creation timestamp |
| `createdBy` | text | Admin identifier when available |

## Rule Evaluation Order

`src/middleware/geoBlock.js` evaluates rules in this order:

1. IP allowlist from static config
2. Country allow rules from static config and database
3. Country block rules from static config and database
4. Allow the request when no matching rule exists

Allow rules always win over block rules for the same country.

## Cache Behavior

Database-backed geo rules are cached in memory for 60 seconds inside `src/services/GeoRuleService.js`.

- Cache TTL: `60000ms`
- Read path: middleware loads cached DB rules instead of querying SQLite for every request
- Write path: `POST` and `DELETE` admin operations invalidate the cache immediately

## Admin Endpoints

### `GET /admin/geo/rules`

Returns config-backed, database-backed, and effective rule sets.

### `POST /admin/geo/block`

Adds a runtime block rule.

Request body:

```json
{
  "countryCode": "RU"
}
```

### `DELETE /admin/geo/block/:countryCode`

Removes a runtime block rule.

### `POST /admin/geo/allow`

Adds a runtime allow rule.

Request body:

```json
{
  "countryCode": "US"
}
```

### `DELETE /admin/geo/allow/:countryCode`

Removes a runtime allow rule.

## Legacy Compatibility

The existing `/admin/geo-blocking` routes remain available for compatibility:

- `GET /admin/geo-blocking`
- `PUT /admin/geo-blocking`
- `POST /admin/geo-blocking/reload-db`

## Blocked Request Response

Blocked requests return:

- HTTP `403`
- Header: `X-Blocked-Reason: geo`

Response body:

```json
{
  "success": false,
  "error": {
    "code": "GEO_BLOCKED",
    "message": "Access denied from your location"
  }
}
```

## Audit Logging

Every blocked request writes an audit log entry with:

- `action: GEO_REQUEST_BLOCKED`
- `ipAddress`
- `details.detectedCountry`
- `details.matchedRule`
- request path, method, and user agent

Example `details` payload:

```json
{
  "detectedCountry": "BR",
  "matchedRule": {
    "type": "block",
    "countryCode": "BR",
    "source": "database"
  },
  "method": "GET",
  "path": "/protected",
  "userAgent": "..."
}
```

## Testing

Primary coverage lives in [tests/geo-blocking-extended.test.js](/c:/Users/pc/stellar-micro-donation-api/tests/geo-blocking-extended.test.js).

Covered scenarios:

- adding runtime block rules
- adding runtime allow rules
- listing effective rules
- cache invalidation after admin writes
- blocked-request audit entries
- legacy admin route compatibility
