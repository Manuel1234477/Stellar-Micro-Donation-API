# API Key Fine-Grained Permission Scoping

## Overview

Fine-grained permission scoping enables creating API keys with specific permission scopes, supporting **least-privilege access** for third-party integrations and internal services. Each API key can be restricted to perform only specific operations.

## Architecture

### Scope Enforcement Layers

1. **Role-Based Access Control (RBAC)**
   - Coarse-grained: `admin`, `user`, `guest`
   - Each role has default permissions

2. **Scope-Based Access Control (SBAC)**
   - Fine-grained: Specific operations (e.g., `donations:read`, `stats:read`)
   - Assigned to individual API keys
   - Acts as an additional constraint on top of role permissions

### Authorization Flow

```
┌─────────────────────────────────┐
│  Incoming API Request           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  API Key Validation             │
│  • Verify key exists            │
│  • Check expiration             │
│  • Verify not revoked           │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Extract Role & Scopes          │
│  • Load role from API key       │
│  • Load scopes from API key     │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Check Role Permission          │
│  • Does role have permission?   │
└────────────┬────────────────────┘
             │
    Role Check Failed?
             │
       YES   │   NO
    ────────┼────────
             │
             ▼
         DENY         ┌──────────────────────────┐
                      │  Check Scope Permission  │
                      │  • Does scope have perm? │
                      └────────────┬─────────────┘
                                   │
                          Scope Check Failed?
                                   │
                            YES   │   NO
                         ────────┼────────
                                  │
                              DENY         ALLOW
```

## Available Scopes

### Scope Naming Convention

Scopes follow the pattern: `resource:action`

- **resource**: The API resource (donations, wallets, stats, etc.)
- **action**: The operation (create, read, update, delete, verify, export, etc.)

### Complete Scope List

#### Donations
- `donations:create` - Create new donations
- `donations:read` - Read/view donation data
- `donations:update` - Update donation details
- `donations:delete` - Delete donations
- `donations:verify` - Verify donation status on blockchain

#### Wallets
- `wallets:create` - Create wallet accounts
- `wallets:read` - Read wallet information
- `wallets:update` - Update wallet settings
- `wallets:delete` - Delete wallets
- `wallets:export` - Export wallet data

#### Streaming/Recurring
- `stream:create` - Create recurring donation streams
- `stream:read` - View stream details
- `stream:update` - Modify streams
- `stream:delete` - Cancel streams

#### Statistics & Analytics
- `stats:read` - Access statistics and analytics data
- `stats:export` - Export statistics reports

#### Transactions
- `transactions:read` - View transaction history
- `transactions:sync` - Sync transactions with Stellar network
- `transactions:export` - Export transaction data

#### API Key Management
- `apikeys:create` - Create new API keys
- `apikeys:read` - View API keys
- `apikeys:update` - Modify API keys
- `apikeys:rotate` - Rotate API keys
- `apikeys:revoke` - Revoke API keys

#### Webhooks
- `webhooks:create` - Create webhook endpoints
- `webhooks:read` - View webhook configurations
- `webhooks:update` - Modify webhooks
- `webhooks:delete` - Remove webhooks

#### Admin
- `admin:*` - Full administrative access (overrides all other scopes)

## Usage Examples

### Creating a Read-Only Stats Key

```bash
curl -X POST https://api.example.com/api/v1/api-keys \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Analytics Dashboard",
    "role": "user",
    "scopes": ["stats:read", "stats:export"],
    "expiresInDays": 365
  }'
```

### Creating a Donation Creator Key

```bash
curl -X POST https://api.example.com/api/v1/api-keys \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Third Party Donation Service",
    "role": "user",
    "scopes": [
      "donations:create",
      "donations:read",
      "donations:verify",
      "transactions:read"
    ],
    "expiresInDays": 90
  }'
```

### Creating an Unrestricted Key (Legacy Behavior)

```bash
curl -X POST https://api.example.com/api/v1/api-keys \
  -H "x-api-key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Full Access Service",
    "role": "user",
    "scopes": [],
    "expiresInDays": 365
  }'
```

**Note**: Keys without scopes have no additional restrictions beyond their role permissions.

## Security Considerations

### Least Privilege Principle

1. **Create the most restrictive key possible** for each use case
2. **Limit scopes** to only what's needed
3. **Rotate frequently** (30-90 days recommended)
4. **Audit scope usage** regularly

### Scope Validation

- Scopes are validated when creating or updating keys
- Invalid or unknown scopes are rejected
- Duplicate scopes are automatically deduplicated
- Empty scope arrays are allowed (applies role-based permissions only)

### Authorization Logic

**Both conditions must be satisfied:**

1. User's role must have the permission
2. API key's scopes must include the permission (if scopes are specified)

This **AND logic** ensures defense-in-depth authorization.

## API Reference

### Create API Key with Scopes

**Endpoint**: `POST /api/v1/api-keys`

**Authentication**: Admin API key required

**Request Body**:

```json
{
  "name": "string (required)",
  "role": "string (optional, default: 'user')",
  "scopes": ["string"] (optional),
  "expiresInDays": "number (optional)",
  "metadata": "object (optional)",
  "rateLimit": "number (optional)",
  "rateLimitWindowSeconds": "number (optional)"
}
```

**Response** (201 Created):

```json
{
  "success": true,
  "data": {
    "id": 42,
    "key": "your_new_api_key_hex_string",
    "keyPrefix": "abc12def",
    "name": "Analytics Dashboard",
    "role": "user",
    "scopes": ["stats:read", "stats:export"],
    "status": "active",
    "createdAt": "2026-03-25T10:30:00Z",
    "expiresAt": "2027-03-25T10:30:00Z",
    "warning": "Store this key securely. It will not be shown again."
  }
}
```

**Error Responses**:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid scopes: Invalid scope: \"invalid:scope\". See documentation for valid scopes."
  }
}
```

### List API Keys

**Endpoint**: `GET /api/v1/api-keys`

**Authentication**: Admin API key required

**Query Parameters**:
- `status`: Filter by key status (active, deprecated, revoked)
- `role`: Filter by role (admin, user, guest)

**Response** (200 OK):

```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "keyPrefix": "abc12def",
      "name": "Analytics Dashboard",
      "role": "user",
      "scopes": ["stats:read", "stats:export"],
      "status": "active",
      "created_at": 1711353000000,
      "expires_at": 1742889000000
    }
  ]
}
```

## Implementation Details

### Scope Storage

- Scopes are stored as a JSON array in the `scopes` column of `api_keys` table
- Empty array `[]` means no additional scope restrictions
- Scopes are validated against the predefined scope list

### Scope Checking

The `scopeValidator` utility provides:

```javascript
// Check if key has a specific scope
hasScope(keyScopes, 'donations:read')

// Check if key has ALL required scopes (AND logic)
hasAllScopes(keyScopes, ['donations:create', 'donations:read'])

// Check if key has ANY required scope (OR logic)
hasAnyScope(keyScopes, ['stats:read', 'stats:export'])
```

### Middleware Integration

The RBAC middleware (`rbac.js`) automatically checks scopes in addition to role permissions:

```javascript
// Checks: role has permission AND key scope includes permission
exports.checkPermission = (permission) => { ... }

// Checks: role has at least one permission AND key scope has at least one
exports.checkAnyPermission = (permissions) => { ... }

// Checks: role has all permissions AND key scope has all
exports.checkAllPermissions = (permissions) => { ... }
```

## Audit Logging

All scope-related operations are logged:

### Scope Creation

```javascript
{
  "category": "API_KEY_MANAGEMENT",
  "action": "API_KEY_CREATED",
  "details": {
    "keyId": 42,
    "scopesCount": 2,
    "scopes": ["stats:read", "stats:export"]
  }
}
```

### Scope Permission Denied

```javascript
{
  "category": "AUTHORIZATION",
  "action": "PERMISSION_DENIED",
  "severity": "HIGH",
  "reason": "Missing scope: donations:create",
  "details": {
    "apiKeyId": 42,
    "hasScope": false
  }
}
```

## Migration Notes

### Backward Compatibility

- Existing API keys created before this feature have empty scopes (`[]`)
- Empty scopes means no additional restrictions beyond role permissions
- Behavior is unchanged for existing keys

### Database Migration

If adding scopes to existing database:

```javascript
// The schema automatically adds the scopes column if it doesn't exist
const CREATE_TABLE_SQL = `
  ...
  scopes TEXT
`;
```

## Best Practices

### For Administrators

1. **Document scope assignments** for each integration
2. **Review scope usage** quarterly
3. **Remove unused scopes** immediately
4. **Use appropriate expiration** dates (shorter for sensitive integrations)
5. **Rotate keys regularly** (every 30-90 days)

### For Integrations

1. **Request minimum required scopes** only
2. **Implement graceful degradation** for scope limitations
3. **Monitor for 403 Forbidden errors** (permission denied)
4. **Renew keys before expiration** (watch for X-API-Key-Deprecated header)
5. **Log all scope-related rejections** for debugging

### For Security Review

1. Check scopes match documented requirements
2. Verify no over-privileged keys exist
3. Audit scope changes in audit logs
4. Test scope enforcement at permission boundaries

## Testing

### Scope Validation Tests

```javascript
const { validateScopes } = require('../utils/scopeValidator');

// Valid scopes
validateScopes(['stats:read', 'donations:create']).valid === true

// Invalid scope
validateScopes(['invalid:scope']).valid === false

// Duplicate detection
validateScopes(['stats:read', 'stats:read']).errors // Contains duplicate error
```

### Permission Check Tests

```javascript
const { hasScope } = require('../utils/scopeValidator');

// Single scope check
hasScope(['stats:read'], 'stats:read') === true
hasScope(['stats:read'], 'donations:create') === false

// Wildcard matching
hasScope(['stats:*'], 'stats:read') === true
hasScope(['admin:*'], 'donations:create') === true
```

## Troubleshooting

### "Missing scope" Error

**Issue**: Request returns 403 Forbidden with "Missing scope" error

**Solution**:
1. Verify API key has required scope
2. Check scope list in key details: `GET /api/v1/api-keys/:id`
3. Rotate to new key with broader scopes if needed
4. Review audit log for scope history

### Scope Not Recognized

**Issue**: Creating key with scope fails validation

**Solution**:
1. Check scope spelling and format (resource:action)
2. Review complete scope list in documentation
3. Verify scope is in predefined scope list
4. Contact admin for custom scope requirements

### Wildcard Scopes Not Working

**Issue**: Wildcard scope (e.g., `donations:*`) not matching operations

**Solution**:
1. Wildcard matches are automatic in permission checks
2. Verify scope uses exact format: `resource:*`
3. Check role ALSO has permission (both must pass)
4. Review authorization flow diagram above

## Future Enhancements

- Custom scope definitions per organization
- Scope templates for common use cases
- Scope usage analytics dashboard
- Conditional scope activation (time-based, IP-based)
- Scope delegation for sub-keys

---

**Last Updated**: March 25, 2026
**Version**: 1.0
**Status**: Production Ready
