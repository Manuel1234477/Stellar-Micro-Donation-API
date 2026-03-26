# JWT Refresh Token Rotation

## Overview

Short-lived access tokens (15 min) paired with rotating refresh tokens (7 days). Each refresh token is single-use; reusing a consumed token revokes the entire token family to detect theft.

## Endpoints

### POST /auth/token
Exchange a valid API key for a token pair.

**Request:**
```
X-API-Key: your-api-key
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<hex64>",
    "tokenType": "Bearer",
    "expiresIn": 900
  }
}
```

### POST /auth/refresh
Rotate a refresh token. Returns a new access + refresh token pair.

**Request body:**
```json
{ "refreshToken": "<hex64>" }
```

**Response 200:** Same shape as `/auth/token`.

**Response 401 — invalid/expired:**
```json
{ "success": false, "error": { "code": "INVALID_REFRESH_TOKEN" } }
```

**Response 401 — token reuse detected:**
```json
{ "success": false, "error": { "code": "TOKEN_FAMILY_REVOKED" } }
```

## Token Lifetimes

| Token | TTL | Storage |
|-------|-----|---------|
| Access token | 15 minutes | Client only (stateless JWT) |
| Refresh token | 7 days | SHA-256 hash in `refresh_tokens` table |

## Security Model

### Access Tokens
- HMAC-SHA256 signed (HS256), verified without DB lookup
- Signed with `ENCRYPTION_KEY` (falls back to dev secret outside production)
- Claims: `sub` (api_key_id), `role`, `iat`, `exp`

### Refresh Tokens
- 32 random bytes, stored as SHA-256 hash — raw value never persisted
- Single-use: marked `used_at` on first consumption
- Belong to a **token family** (UUID shared across rotations)

### Token Family Revocation (Theft Detection)
If a refresh token that has already been used is presented again:
1. The entire family is revoked (all tokens with the same `family_id`)
2. `TOKEN_FAMILY_REVOKED` error is returned
3. The attacker's stolen token and the legitimate user's new token are both invalidated

### Key Rotation
Call `revokeAllForApiKey(apiKeyId)` when an API key is rotated to invalidate all associated refresh tokens.

## Database Schema

```sql
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,   -- SHA-256 of raw token
  api_key_id INTEGER NOT NULL,
  family_id TEXT NOT NULL,           -- UUID shared across rotations
  expires_at INTEGER NOT NULL,       -- Unix ms
  used_at INTEGER,                   -- Set on first use; NULL = unused
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

## Implementation

- `src/services/JwtService.js` — all token logic
- `src/routes/auth.js` — HTTP endpoints
- Table auto-created on first use via `initializeRefreshTokensTable()`

## Clock Skew

Access token expiry uses server time only. For distributed deployments, ensure NTP sync across nodes. A small clock skew tolerance (e.g. 30s) can be added to `verifyAccessToken` if needed.
