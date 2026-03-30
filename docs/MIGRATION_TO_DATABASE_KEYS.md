# Migration Guide: Legacy to Database-Backed API Keys

This guide helps you migrate from environment-based API keys (`API_KEYS` in .env) to the new database-backed key rotation system.

## Why Migrate?

The new system provides:
- **Zero-downtime rotation**: Rotate keys without service interruption
- **Key versioning**: Multiple active keys with different roles
- **Graceful deprecation**: Warn clients before revoking keys
- **Expiration**: Automatic key expiration
- **Audit trail**: Track key creation, usage, and lifecycle
- **Better security**: Hashed storage, role-based access

## Migration Strategy

### Option 1: Gradual Migration (Recommended)

This approach maintains both systems during migration for zero downtime.

#### Step 1: Keep Legacy Keys Active
Leave your current `API_KEYS` in `.env`:
```env
API_KEYS=legacy-key-1,legacy-key-2
```

The system will continue to work with these keys.

#### Step 2: Create Database Keys
Create new database-backed keys for each client:

```bash
# For each client/service
npm run keys:create -- --name "Client A Production" --role user --expires 365
npm run keys:create -- --name "Client B Production" --role user --expires 365
npm run keys:create -- --name "Admin Dashboard" --role admin --expires 365
```

Save each key securely and note which client it's for.

#### Step 3: Deploy New Keys to Clients
Update each client application with its new key:

```javascript
// Before
const API_KEY = 'legacy-key-1';

// After
const API_KEY = 'a1b2c3d4e5f6...new-database-key';
```

Deploy gradually:
1. Start with development/staging environments
2. Deploy to production using canary or rolling deployment
3. Monitor for issues

#### Step 4: Monitor Migration Progress
Check which keys are being used:

```bash
npm run keys:list
```

Look at `last_used_at` timestamps. Once a database key is being used regularly, the corresponding legacy key can be removed.

#### Step 5: Remove Legacy Keys
Once all clients have migrated:

1. Remove legacy keys from `.env`:
```env
# API_KEYS=legacy-key-1,legacy-key-2  # Removed
```

2. Restart the server
3. Verify all clients still work with database keys

### Option 2: Quick Migration (Downtime Required)

If you can afford brief downtime:

#### Step 1: Create All Database Keys
```bash
npm run keys:create -- --name "Production Key 1" --role user --expires 365
npm run keys:create -- --name "Production Key 2" --role user --expires 365
npm run keys:create -- --name "Admin Key" --role admin --expires 365
```

#### Step 2: Update All Clients
Deploy new keys to all clients simultaneously.

#### Step 3: Remove Legacy Keys
Remove `API_KEYS` from `.env` and restart.

## Mapping Legacy Keys to Database Keys

### Identify Current Keys
List your current keys:
```bash
echo $API_KEYS
# Output: key1,key2,key3
```

### Create Equivalent Database Keys
For each legacy key, create a database key with appropriate metadata:

```bash
# Legacy key was for "Mobile App"
npm run keys:create -- --name "Mobile App (migrated from legacy)" --role user --expires 365

# Legacy key was for "Admin Panel"
npm run keys:create -- --name "Admin Panel (migrated from legacy)" --role admin --expires 365
```

### Track Migration
Use metadata to track migration:

```bash
curl -X POST http://localhost:3000/api-keys \
  -H "x-api-key: ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mobile App",
    "role": "user",
    "expiresInDays": 365,
    "metadata": {
      "migratedFrom": "legacy",
      "legacyKeyPrefix": "abc123",
      "migrationDate": "2024-02-25"
    }
  }'
```

## Role Assignment

Map your legacy keys to appropriate roles:

### Admin Keys
Keys that need full access:
```bash
npm run keys:create -- --name "Admin Dashboard" --role admin --expires 365
```

### User Keys
Standard API access:
```bash
npm run keys:create -- --name "Production Service" --role user --expires 365
```

### Guest Keys
Read-only access:
```bash
npm run keys:create -- --name "Public Widget" --role guest --expires 365
```

## Testing Migration

### 1. Test in Development
```bash
# Set up test environment
export NODE_ENV=development
npm start

# Test legacy key
curl http://localhost:3000/health -H "x-api-key: legacy-key-1"

# Test database key
curl http://localhost:3000/health -H "x-api-key: new-database-key"
```

### 2. Verify Both Work
Both legacy and database keys should work during migration.

### 3. Check Logs
Monitor logs for key usage:
```bash
tail -f logs/app.log | grep API_KEY
```

## Rollback Plan

If issues occur during migration:

### Keep Legacy Keys
Don't remove `API_KEYS` from `.env` until migration is complete.

### Revert Client Changes
If a client has issues with the new key, revert to the legacy key temporarily.

### Database Keys Remain
Database keys don't interfere with legacy keys, so they can coexist indefinitely.

## Post-Migration

### 1. Establish Rotation Policy
```bash
# Rotate keys every 90 days
# Set calendar reminders
```

### 2. Set Up Monitoring
Monitor key age and usage:
```bash
npm run keys:list
```

### 3. Document Keys
Maintain a secure document mapping keys to clients:
```
Key ID | Name              | Client        | Created    | Expires
-------|-------------------|---------------|------------|----------
1      | Mobile App        | iOS App       | 2024-02-25 | 2025-02-25
2      | Web Dashboard     | React App     | 2024-02-25 | 2025-02-25
3      | Admin Panel       | Admin UI      | 2024-02-25 | 2025-02-25
```

### 4. Schedule First Rotation
Plan your first key rotation:
```bash
# 90 days after migration
# Create new keys
# Deploy to clients
# Deprecate old keys
# Wait 30 days
# Revoke old keys
```

## Troubleshooting

### Legacy Key Not Working
- Check `API_KEYS` is still in `.env`
- Verify no extra spaces in key
- Restart server after `.env` changes

### Database Key Not Working
- Verify key was copied correctly
- Check key status: `npm run keys:list`
- Ensure key hasn't expired
- Verify role has required permissions

### Both Keys Not Working
- Check server is running
- Verify database is accessible
- Check logs for errors
- Ensure middleware is properly configured

### Client Can't Connect
- Verify client is using correct key
- Check network connectivity
- Verify API endpoint URL
- Check rate limiting isn't blocking requests

## FAQ

**Q: Can I use both systems indefinitely?**
A: Yes, but it's recommended to migrate fully to benefit from rotation features.

**Q: Will legacy keys be removed in a future version?**
A: No immediate plans, but database keys are the recommended approach.

**Q: Do I need to migrate all keys at once?**
A: No, migrate gradually. Both systems work simultaneously.

**Q: What happens if I forget to save a database key?**
A: Keys are shown only once. You'll need to create a new key.

**Q: Can I import legacy keys into the database?**
A: No, for security reasons. Create new keys and migrate clients.

**Q: How do I know when migration is complete?**
A: When all clients use database keys and legacy keys show no recent usage.

## Support

For migration assistance:
1. Review [API Key Rotation Guide](./API_KEY_ROTATION.md)
2. Check [Quick Start Guide](./API_KEY_ROTATION_QUICK_START.md)
3. Review server logs for errors
4. Contact the API team

## Checklist

- [ ] Identify all current legacy keys
- [ ] Document which client uses which key
- [ ] Create database keys for each client
- [ ] Test database keys in development
- [ ] Deploy new keys to staging
- [ ] Deploy new keys to production (gradually)
- [ ] Monitor usage for 1-2 weeks
- [ ] Verify all clients migrated
- [ ] Remove legacy keys from `.env`
- [ ] Restart server
- [ ] Verify all clients still work
- [ ] Document new keys securely
- [ ] Schedule first rotation
- [ ] Set up monitoring alerts
