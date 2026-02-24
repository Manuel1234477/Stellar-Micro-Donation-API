# API Key Rotation Implementation Summary

## Issue #121: Add API Key Rotation Support

### Overview
Implemented a comprehensive API key rotation system that allows zero-downtime key rotation with versioning, graceful deprecation, and role-based access control.

### Implementation Details

#### 1. Database Schema
Created `api_keys` table with the following features:
- **Key storage**: SHA-256 hashed keys with prefix for identification
- **Lifecycle management**: Active, deprecated, and revoked states
- **Expiration**: Optional automatic expiration
- **Audit trail**: Creation, deprecation, revocation, and last usage timestamps
- **Role-based access**: Admin, user, and guest roles
- **Metadata**: Extensible JSON metadata field

#### 2. Core Components

**Models** (`src/models/apiKeys.js`):
- `createApiKey()` - Generate and store new keys
- `validateApiKey()` - Validate keys and check expiration/status
- `listApiKeys()` - List keys with filtering
- `deprecateApiKey()` - Mark keys for future removal
- `revokeApiKey()` - Immediately invalidate keys
- `cleanupOldKeys()` - Remove old revoked keys

**Middleware** (`src/middleware/apiKeyMiddleware.js`):
- Updated to support both database-backed and legacy environment keys
- Adds deprecation warnings to response headers
- Attaches key info to request for downstream use
- Backward compatible with existing `API_KEYS` environment variable

**RBAC Integration** (`src/middleware/rbacMiddleware.js`):
- Updated `attachUserRole()` to use database key roles
- Supports admin, user, and guest roles from database
- Maintains backward compatibility

**API Routes** (`src/routes/apiKeys.js`):
- `POST /api-keys` - Create new key (admin only)
- `GET /api-keys` - List keys with filtering (admin only)
- `POST /api-keys/:id/deprecate` - Deprecate key (admin only)
- `DELETE /api-keys/:id` - Revoke key (admin only)
- `POST /api-keys/cleanup` - Clean up old keys (admin only)

**CLI Tool** (`src/scripts/manageApiKeys.js`):
- Command-line interface for key management
- Commands: create, list, deprecate, revoke, cleanup
- Integrated with npm scripts for easy access

#### 3. Key Features

**Zero-Downtime Rotation**:
1. Create new key while old key is still active
2. Deploy new key to clients gradually
3. Deprecate old key (still works, but warns clients)
4. Monitor usage during grace period
5. Revoke old key after clients migrate
6. Clean up old keys after retention period

**Graceful Deprecation**:
- Deprecated keys continue to work
- Response headers warn clients: `X-API-Key-Deprecated: true`
- Warning header: `299 - "API key is deprecated and will be revoked soon"`
- Allows clients to detect and update without breaking

**Security**:
- Keys hashed with SHA-256 before storage
- Plain text keys shown only once at creation
- Only key prefix (8 chars) stored for identification
- All operations logged for audit trail
- Admin-only key management endpoints

**Monitoring**:
- Last usage timestamp tracked
- Key age and expiration visible
- Filter keys by status and role
- Usage patterns help identify migration progress

#### 4. Documentation

Created comprehensive documentation:
- **API_KEY_ROTATION.md**: Complete guide with best practices
- **API_KEY_ROTATION_QUICK_START.md**: Quick reference for common tasks
- Updated **README.md**: Added feature description and links
- Updated **.env.example**: Documented new system vs legacy

#### 5. Testing

Created test suite (`tests/apiKeys.test.js`):
- Key creation and validation
- Deprecation and revocation
- Authentication middleware
- Role-based access control
- Cleanup functionality
- Edge cases (expired keys, invalid keys, etc.)

#### 6. Backward Compatibility

The implementation maintains full backward compatibility:
- Legacy `API_KEYS` environment variable still works
- Middleware checks database first, then falls back to environment
- No breaking changes to existing API
- Migration can happen gradually

### Acceptance Criteria

✅ **Old keys can be deprecated safely**
- Keys can be marked deprecated while still functioning
- Clients receive warnings via response headers
- Grace period allows gradual migration

✅ **No service disruption**
- Multiple keys can be active simultaneously
- New keys created while old keys still work
- Gradual rollout prevents downtime
- Backward compatible with legacy keys

✅ **Design key versioning or expiry**
- Database schema supports key versioning
- Optional expiration dates
- Lifecycle states (active, deprecated, revoked)
- Automatic expiration checking

✅ **Update authentication logic**
- Middleware updated to support database keys
- Role-based access from database
- Last usage tracking
- Deprecation warnings

✅ **Document rotation process**
- Complete rotation guide created
- Quick start reference
- CLI tool with help
- Best practices documented

### Usage Examples

#### Create a new key:
```bash
npm run keys:create -- --name "Production API" --role user --expires 365
```

#### List all keys:
```bash
npm run keys:list
```

#### Deprecate a key:
```bash
npm run keys -- deprecate --id 1
```

#### Revoke a key:
```bash
npm run keys -- revoke --id 1
```

#### Via API:
```bash
curl -X POST http://localhost:3000/api-keys \
  -H "x-api-key: ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Key","role":"user","expiresInDays":365}'
```

### Files Created/Modified

**Created**:
- `src/models/apiKeys.js` - Core key management model
- `src/routes/apiKeys.js` - API endpoints for key management
- `src/scripts/manageApiKeys.js` - CLI tool
- `docs/API_KEY_ROTATION.md` - Complete documentation
- `docs/API_KEY_ROTATION_QUICK_START.md` - Quick reference
- `tests/apiKeys.test.js` - Test suite
- `API_KEY_ROTATION_IMPLEMENTATION.md` - This file

**Modified**:
- `src/middleware/apiKeyMiddleware.js` - Updated authentication
- `src/middleware/rbacMiddleware.js` - Updated role attachment
- `src/routes/app.js` - Added initialization and routes
- `package.json` - Added npm scripts
- `.env.example` - Documented new system
- `README.md` - Added feature and documentation links

### Next Steps

1. **Initialize the database table**: Automatically done on server start
2. **Create first admin key**: Use CLI to create initial admin key
3. **Migrate from legacy keys**: Gradually move clients to database keys
4. **Set up monitoring**: Track key usage and age
5. **Establish rotation policy**: Define rotation schedule (e.g., every 90 days)
6. **Automate cleanup**: Schedule periodic cleanup of old keys

### Security Recommendations

1. **Rotate keys regularly**: Every 90-180 days
2. **Use expiration**: Set expiration dates on all keys
3. **Monitor usage**: Review key list monthly
4. **Limit admin keys**: Create admin keys only when necessary
5. **Audit trail**: Review logs for suspicious activity
6. **Secure storage**: Store keys in environment variables or secret managers
7. **Grace period**: Allow 30-60 days between deprecation and revocation

### Conclusion

The API key rotation system is fully implemented and ready for use. It provides enterprise-grade key management with zero-downtime rotation, graceful deprecation, and comprehensive audit trails. The system is backward compatible and can be adopted gradually without disrupting existing services.
