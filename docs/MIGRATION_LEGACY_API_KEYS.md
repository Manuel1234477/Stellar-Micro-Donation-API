# Migration Guide: Legacy API Keys → Database-Backed Keys

**Issue:** #702  
**Sunset date: 2026-12-31** — `API_KEYS` environment variable support will be removed.

---

## What Changed

Legacy API keys (set via the `API_KEYS` environment variable) now have the same security controls as database-backed keys:

| Control | Before | After |
|---|---|---|
| Rate limiting | ❌ Bypassed | ✅ 100 req/60 s (default) |
| Audit logging | ❌ None | ✅ `LEGACY_KEY_USED` logged on every request |
| Deprecation warning | ❌ None | ✅ `Warning` + `X-API-Key-Legacy: true` response headers |
| Startup warning (production) | ❌ None | ✅ Emitted at server start |
| Revocation without restart | ❌ Impossible | ❌ Still impossible — migrate to DB keys |

---

## Why You Should Migrate

- Legacy keys **cannot be revoked** without restarting the server.
- Legacy keys have **no expiration** and no per-key quota tracking.
- Legacy keys are **incompatible** with key rotation, TOTP second-factor, and fine-grained scopes.
- Support will be **removed on 2026-12-31**.

---

## Migration Steps

### 1. Create a database-backed key

```bash
npm run keys:create -- --name "My Service Key" --role user --expires 365
```

This prints the new key value once. Store it securely.

### 2. Update your client

Replace the old key in your `X-API-Key` header with the new one.

### 3. Verify the new key works

```bash
curl -H "X-API-Key: <new-key>" http://localhost:3000/health
```

### 4. Remove `API_KEYS` from your environment

```bash
# .env — remove or comment out:
# API_KEYS=old-key-1,old-key-2
```

Restart the server. The startup warning will no longer appear.

---

## Available Key Management Commands

```bash
npm run keys:create -- --name "Name" --role user --expires 365   # create
npm run keys:list                                                  # list all keys
npm run keys -- deprecate --id <id>                               # deprecate (grace period)
npm run keys -- revoke --id <id>                                   # hard revoke
```

For full documentation see [API Key Rotation Guide](./API_KEY_ROTATION.md).
