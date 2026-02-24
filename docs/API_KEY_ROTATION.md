# API Key Rotation Guide

This guide explains how to rotate API keys without service disruption, improving long-term security for the Stellar Micro-Donation API.

## Overview

The API key rotation system supports:
- **Key versioning**: Multiple active keys can coexist
- **Graceful deprecation**: Old keys can be marked deprecated before revocation
- **Zero downtime**: Rotate keys without service interruption
- **Expiration**: Automatic key expiration based on configured lifetime
- **Role-based access**: Keys can have different permission levels (admin, user, guest)
- **Audit trail**: Track key creation, usage, and lifecycle events

## Key Lifecycle States

1. **Active**: Key is valid and can be used for authentication
2. **Deprecated**: Key still works but clients receive warnings to migrate
3. **Revoked**: Key is immediately invalidated and cannot be used

## Rotation Process

### Step 1: Create a New Key

Using the CLI:
```bash
node src/scripts/manageApiKeys.js create \
  --name "Production API v2" \
  --role user \
  --expires 365
```

Using the API (requires admin key):
```bash
curl -X POST http://localhost:3000/api-keys \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Production API v2",
    "role": "user",
    "expiresInDays": 365
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "key": "a1b2c3d4e5f6...full-key-here",
    "keyPrefix": "a1b2c3d4",
    "name": "Production API v2",
    "role": "user",
    "status": "active",
    "createdAt": 1708819200000,
    "expiresAt": 1740355200000,
    "warning": "Store this key securely. It will not be shown again."
  }
}
```

**Important**: Save the key immediately. It will never be displayed again.

### Step 2: Deploy New Key to Clients

Update your client applications to use the new key:

```javascript
// Before
const apiKey = 'old-key-123';

// After
const apiKey = 'a1b2c3d4e5f6...new-key';
```

Deploy the updated clients gradually (canary deployment, rolling update, etc.).

### Step 3: Monitor Usage

List all keys to check usage:
```bash
node src/scripts/manageApiKeys.js list
```

Output shows last usage timestamp:
```
ID: 1
  Prefix: a1b2c3d4
  Name: Production API v2
  Role: user
  Status: active
  Created: 2024-02-25T00:00:00.000Z
  Last Used: 2024-02-25T12:30:45.000Z

ID: 2
  Prefix: old-key-
  Name: Production API v1
  Role: user
  Status: active
  Created: 2023-02-25T00:00:00.000Z
  Last Used: 2024-02-25T12:25:10.000Z
```

### Step 4: Deprecate Old Key

Once most clients have migrated, deprecate the old key:

```bash
node src/scripts/manageApiKeys.js deprecate --id 2
```

Or via API:
```bash
curl -X POST http://localhost:3000/api-keys/2/deprecate \
  -H "x-api-key: YOUR_ADMIN_KEY"
```

Clients using deprecated keys will receive:
- HTTP 200 (request still succeeds)
- Response header: `X-API-Key-Deprecated: true`
- Response header: `Warning: 299 - "API key is deprecated and will be revoked soon"`

This allows clients to detect they need to update without breaking functionality.

### Step 5: Revoke Old Key

After a grace period (e.g., 30 days), revoke the old key:

```bash
node src/scripts/manageApiKeys.js revoke --id 2
```

Or via API:
```bash
curl -X DELETE http://localhost:3000/api-keys/2 \
  -H "x-api-key: YOUR_ADMIN_KEY"
```

Revoked keys immediately return HTTP 401 Unauthorized.

### Step 6: Clean Up Old Keys

Periodically remove old revoked keys from the database:

```bash
# Remove keys revoked more than 90 days ago
node src/scripts/manageApiKeys.js cleanup --retention 90
```

## Best Practices

### Rotation Schedule

- **Regular rotation**: Rotate keys every 90-180 days
- **Incident response**: Rotate immediately if a key is compromised
- **Employee changes**: Rotate when team members with key access leave

### Key Expiration

Set expiration when creating keys:
```bash
node src/scripts/manageApiKeys.js create \
  --name "Temporary Integration" \
  --role user \
  --expires 30
```

Keys automatically become invalid after expiration.

### Grace Period

Recommended deprecation-to-revocation timeline:
- **High-traffic APIs**: 30-60 days
- **Internal services**: 7-14 days
- **Emergency rotation**: Immediate revocation (skip deprecation)

### Monitoring

Monitor these metrics:
- Number of active keys per role
- Deprecated key usage (should decrease over time)
- Failed authentication attempts (may indicate revoked key usage)
- Key age (flag keys older than rotation policy)

### Security

- **Store keys securely**: Use environment variables or secret management systems
- **Never commit keys**: Add to .gitignore
- **Limit admin keys**: Only create admin keys when necessary
- **Audit regularly**: Review key list monthly
- **Use descriptive names**: Include purpose and owner in key name

## API Endpoints

All endpoints require admin authentication.

### Create Key
```
POST /api-keys
Content-Type: application/json

{
  "name": "Key name",
  "role": "user|admin|guest",
  "expiresInDays": 365,
  "metadata": {}
}
```

### List Keys
```
GET /api-keys?status=active&role=user
```

### Deprecate Key
```
POST /api-keys/:id/deprecate
```

### Revoke Key
```
DELETE /api-keys/:id
```

### Cleanup Old Keys
```
POST /api-keys/cleanup
Content-Type: application/json

{
  "retentionDays": 90
}
```

## CLI Commands

### Create
```bash
node src/scripts/manageApiKeys.js create \
  --name "Key name" \
  --role user \
  --expires 365
```

### List
```bash
node src/scripts/manageApiKeys.js list \
  --status active \
  --role user
```

### Deprecate
```bash
node src/scripts/manageApiKeys.js deprecate --id 1
```

### Revoke
```bash
node src/scripts/manageApiKeys.js revoke --id 1
```

### Cleanup
```bash
node src/scripts/manageApiKeys.js cleanup --retention 90
```

## Migration from Legacy Keys

If you're currently using environment-based keys (`API_KEYS` in .env):

1. **Create database-backed keys** for all clients
2. **Deploy new keys** to clients
3. **Keep legacy keys** in environment for backward compatibility
4. **Monitor usage** to ensure all clients migrated
5. **Remove legacy keys** from environment once migration complete

The system supports both simultaneously, so there's no service disruption.

## Troubleshooting

### Key Not Working After Creation

- Verify key was copied correctly (no extra spaces)
- Check key hasn't expired
- Confirm key status is "active"
- Verify role has required permissions

### Deprecated Key Warnings Not Showing

- Check client is reading response headers
- Verify key status is "deprecated" not "active"
- Ensure middleware is properly configured

### Unable to Revoke Key

- Verify key ID exists
- Check you have admin permissions
- Ensure database is writable

## Database Schema

```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  deprecated_at INTEGER,
  revoked_at INTEGER,
  last_used_at INTEGER,
  created_by TEXT,
  metadata TEXT
);
```

Keys are stored as SHA-256 hashes for security. Only the prefix (first 8 characters) is stored in plain text for identification.

## Security Considerations

- **Hash storage**: Keys are hashed with SHA-256 before storage
- **One-time display**: Plain text keys shown only at creation
- **Audit logging**: All key operations are logged
- **Rate limiting**: API endpoints are rate-limited
- **Admin-only**: Key management requires admin role
- **Automatic cleanup**: Expired keys can be automatically removed

## Support

For issues or questions about API key rotation:
1. Check this documentation
2. Review logs for error messages
3. Verify database connectivity
4. Contact the API team
