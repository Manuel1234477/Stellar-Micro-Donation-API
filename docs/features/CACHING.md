# HTTP Response Caching

ETag-based and Last-Modified conditional request handling for wallet, campaign, and stats endpoints. Clients can avoid re-downloading unchanged data by sending `If-None-Match` or `If-Modified-Since` headers.

## How It Works

```
Client                          Server
  │                               │
  │── GET /wallets/1 ────────────►│
  │◄── 200 + ETag: "abc123" ──────│
  │                               │
  │── GET /wallets/1              │
  │   If-None-Match: "abc123" ───►│
  │◄── 304 Not Modified ──────────│  (no body transferred)
  │                               │
  │── PATCH /wallets/1 ──────────►│  (resource updated)
  │◄── 200 ───────────────────────│
  │                               │
  │── GET /wallets/1              │
  │   If-None-Match: "abc123" ───►│
  │◄── 200 + ETag: "def456" ──────│  (new ETag, full body)
```

## Middleware

**`src/middleware/caching.js`** — `cacheMiddleware(resourceType, visibility)`

Wraps `res.json()` to:
1. Generate a SHA-256 ETag from the response body
2. Set `ETag`, `Last-Modified`, and `Cache-Control` headers
3. Return `304 Not Modified` if `If-None-Match` matches or `If-Modified-Since` is not stale

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `resourceType` | string | `'default'` | Key into `MAX_AGE` map |
| `visibility` | string | `'private'` | `'public'` or `'private'` |

### Cache-Control max-age values

| Resource type | max-age (seconds) |
|---------------|-------------------|
| `wallet` | 30 |
| `campaign` | 60 |
| `stats` | 120 |
| `exchange-rate` | 300 |
| `default` | 60 |

## Applied Endpoints

| Route | Resource type | Visibility |
|-------|--------------|------------|
| `GET /wallets` | `wallet` | `private` |
| `GET /wallets/:id` | `wallet` | `private` |
| `GET /campaigns` | `campaign` | `public` |
| `GET /campaigns/:id` | `campaign` | `public` |
| `GET /stats/daily` | `stats` | `private` |
| `GET /stats/weekly` | `stats` | `private` |
| `GET /stats/summary` | `stats` | `private` |

## Security Assumptions

- **ETags are opaque**: generated via SHA-256 hash — no resource fields, IDs, or sensitive values appear in the tag.
- **Private resources use `private` Cache-Control**: wallet and stats responses are user-specific and must not be stored by shared caches (CDNs, proxies).
- **Only safe methods are cached**: `POST`, `PATCH`, `PUT`, `DELETE` bypass the middleware entirely — no ETag is set.
- **Error responses are not cached**: only `2xx` status codes receive caching headers.
- **`If-None-Match` takes precedence over `If-Modified-Since`** per RFC 7232 §6.

## Usage

```js
const { cacheMiddleware } = require('../middleware/caching');

// Apply to a route
router.get('/:id', requireApiKey, cacheMiddleware('wallet', 'private'), async (req, res) => {
  const wallet = await WalletService.getById(req.params.id);
  res.json({ success: true, data: wallet }); // ETag set automatically
});
```

## Exported API

```js
const { cacheMiddleware, generateETag, buildCacheControl, MAX_AGE } = require('./caching');
```

- **`cacheMiddleware(resourceType, visibility)`** — Express middleware factory
- **`generateETag(data)`** — Returns a quoted SHA-256 ETag string
- **`buildCacheControl(visibility, maxAge)`** — Returns a `Cache-Control` header value
- **`MAX_AGE`** — Map of resource type → max-age seconds
