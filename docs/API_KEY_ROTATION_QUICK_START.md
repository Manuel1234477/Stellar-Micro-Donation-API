# API Key Rotation - Quick Start

Quick reference for rotating API keys without downtime.

## TL;DR

```bash
# 1. Create new key
npm run keys:create -- --name "Production v2" --role user --expires 365

# 2. Update clients with new key
# (Deploy gradually)

# 3. Deprecate old key (after most clients migrated)
npm run keys -- deprecate --id 1

# 4. Wait 30 days (grace period)

# 5. Revoke old key
npm run keys -- revoke --id 1
```

## Common Commands

### Create a Key
```bash
npm run keys:create -- --name "My API Key" --role user --expires 365
```

### List All Keys
```bash
npm run keys:list
```

### List Active Keys Only
```bash
npm run keys -- list --status active
```

### Deprecate a Key
```bash
npm run keys -- deprecate --id 1
```

### Revoke a Key
```bash
npm run keys -- revoke --id 2
```

### Clean Up Old Keys
```bash
npm run keys -- cleanup --retention 90
```

## Key States

- **Active** ✅ - Works normally
- **Deprecated** ⚠️ - Works but shows warnings
- **Revoked** ❌ - Immediately rejected

## Rotation Timeline

```
Day 0:  Create new key
Day 1:  Start deploying to clients
Day 7:  Deprecate old key (most clients migrated)
Day 37: Revoke old key (30-day grace period)
Day 127: Clean up revoked key (90-day retention)
```

## API Endpoints

All require admin authentication via `x-api-key` header.

### Create Key
```bash
curl -X POST http://localhost:3000/api-keys \
  -H "x-api-key: ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Key","role":"user","expiresInDays":365}'
```

### List Keys
```bash
curl http://localhost:3000/api-keys \
  -H "x-api-key: ADMIN_KEY"
```

### Deprecate Key
```bash
curl -X POST http://localhost:3000/api-keys/1/deprecate \
  -H "x-api-key: ADMIN_KEY"
```

### Revoke Key
```bash
curl -X DELETE http://localhost:3000/api-keys/1 \
  -H "x-api-key: ADMIN_KEY"
```

## Roles

- **admin** - Full access to all endpoints including key management
- **user** - Standard API access
- **guest** - Read-only access

## Emergency Rotation

If a key is compromised:

```bash
# 1. Immediately revoke (skip deprecation)
npm run keys -- revoke --id COMPROMISED_KEY_ID

# 2. Create replacement
npm run keys:create -- --name "Emergency Replacement" --role user

# 3. Deploy new key ASAP
```

## Monitoring

Check for deprecated key usage:
```bash
# Keys with recent usage
npm run keys:list

# Look for deprecated keys with recent last_used_at
```

## Full Documentation

See [API_KEY_ROTATION.md](./API_KEY_ROTATION.md) for complete guide.
