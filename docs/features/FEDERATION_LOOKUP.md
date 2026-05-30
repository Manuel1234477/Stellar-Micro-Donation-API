# Federation Lookup

## Overview

Full Stellar federation protocol lookup with TTL caching. Resolves `user*domain.org` addresses to Stellar public keys and supports reverse lookups.

## Endpoints (No Auth Required)

### Resolve Federation Address

```
GET /federation/resolve?address=user*domain.org
```

Resolves a federation address to a Stellar public key.

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `address` | Yes | Federation address in `name*domain.tld` format |

**Responses:**
- `200` – Resolved successfully
- `400` – Missing parameter or invalid format
- `404` – Address not found on federation server
- `504` – Federation server timed out
- `502` – Other federation server error

**Example:**
```
GET /federation/resolve?address=alice*example.com
```
```json
{
  "success": true,
  "data": {
    "address": "alice*example.com",
    "account_id": "GDKV6OAXXQZ6HSBNB62P2BQAJWVKBX2LLCJAEEZHL7OYGKXGRPPR6OBM",
    "memo_type": "text",
    "memo": "donation"
  },
  "cached": false
}
```

---

### Reverse Federation Lookup

```
GET /federation/reverse?publicKey=G...
```

Resolves a Stellar public key to a federation address (best-effort).

**Query Parameters:**
| Param | Required | Description |
|-------|----------|-------------|
| `publicKey` | Yes | Stellar public key (56-char G... format) |

**Responses:**
- `200` – Resolved successfully
- `400` – Missing parameter or invalid key format
- `404` – No federation address found for this key
- `504` – Federation server timed out

**Example:**
```json
{
  "success": true,
  "data": {
    "publicKey": "GDKV6OAXXQZ6HSBNB62P2BQAJWVKBX2LLCJAEEZHL7OYGKXGRPPR6OBM",
    "federationAddress": "alice*example.com",
    "memoType": null,
    "memo": null
  },
  "cached": true
}
```

---

## TTL Caching

Resolved addresses are cached in-memory with a configurable TTL.

**Environment variable:**
```env
FEDERATION_CACHE_TTL=300   # seconds (default: 300)
```

Both forward (`address → key`) and reverse (`key → address`) lookups are cached independently.

---

## Error Handling

| HTTP | Code | Condition |
|------|------|-----------|
| 400 | `MISSING_PARAMETER` | Required query param absent |
| 400 | `INVALID_FORMAT` | Malformed address or public key |
| 404 | `NOT_FOUND` | Address/key not found |
| 504 | `FEDERATION_TIMEOUT` | Server timeout (ETIMEDOUT, ECONNREFUSED, etc.) |
| 502 | `FEDERATION_ERROR` | Other server error |
