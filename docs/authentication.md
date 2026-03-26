# Authentication Guide

## Overview

All API endpoints require an API key passed in the `X-API-Key` request header.

```bash
curl http://localhost:3000/api/v1/donations \
  -H "X-API-Key: your-api-key-here"
```

Requests without a valid key receive `401 Unauthorized`.

## API Key Roles

| Role | Permissions | Use Case |
|------|-------------|----------|
| `admin` | All (`*`) | System administration, key management |
| `user` | donations:*, wallets:*, stream:*, stats:read, transactions:* | Standard API operations |
| `guest` | donations:read, stats:read | Read-only public access |

## Creating API Keys (Database-Backed — Recommended)

```bash
# Create a user key valid for 365 days
npm run keys:create -- --name "My App" --role user --expires 365

# Create an admin key
npm run keys:create -- --name "Admin" --role admin --expires 90

# List all keys
npm run keys:list
```

The key value is shown once at creation time. Store it securely.

## Legacy Environment-Based Keys (Deprecated)

Set `API_KEYS` in `.env` as a comma-separated list:

```env
API_KEYS=key1,key2,key3
```

Legacy keys have `user` role by default. Migrate to database-backed keys when possible.

## Key Rotation (Zero Downtime)

```bash
# 1. Create a new key
npm run keys:create -- --name "New Key" --role user --expires 365

# 2. Deprecate the old key (still works, logs warnings)
npm run keys -- deprecate --id 1

# 3. After clients migrate, revoke the old key
npm run keys -- revoke --id 1
```

See [API Key Rotation Guide](./API_KEY_ROTATION.md) for full details.

## Permission Errors

A `403 Forbidden` response means the key is valid but lacks the required permission:

```json
{
  "success": false,
  "error": "Insufficient permissions",
  "required": "donations:write"
}
```

Upgrade the key's role or create a new key with the appropriate role.

## SEP-0010 (Stellar Web Authentication)

SEP-0010 is the Stellar standard for web authentication using challenge/response with a Stellar keypair. This project uses API keys for authentication rather than SEP-0010. If you need SEP-0010 support, it can be layered on top by:

1. Implementing the challenge endpoint (`GET /auth`)
2. Verifying the signed transaction from the client
3. Issuing an API key (JWT or database-backed) upon successful verification

This is not currently implemented but is compatible with the existing auth middleware.
